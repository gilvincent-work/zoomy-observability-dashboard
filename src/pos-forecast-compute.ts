// Pure forecast engine for the Offline (POS) Stock Forecast — event-aware
// velocity, event-day cover, weekend run-out + reorder dates, and the
// Healthy/Low/Out bands. No server/client concerns so it's unit-testable and
// shareable (the low-stock email job will reuse the same functions). See
// COOP_INTEGRATION_PLAN.md "Stock Forecast" for the decisions encoded here.
//
// Phase 1 keeps the tuning numbers as constants; Phase 2 reads them from
// pos_settings with these as the fallbacks.

import {manilaDayKey} from './pos-sales-compute';
import {LOW_STOCK_THRESHOLD} from './pos-format';

// ── Config (Phase-1 constants; Phase-2 makes these pos_settings-backed) ──────
export const FORECAST_WINDOW_DAYS = 60; // trailing window of sales used for velocity
export const TARGET_COVER_EVENT_DAYS = 6; // reorder aims to hold ~2 weekends of cover
export const LEAD_TIME_DAYS = 3; // supplier lead: reorder-by = run-out − this
export const EARLY_WARNING_EVENTS = 3; // Low fires if it runs out within N event-days
export const EVENT_WEEKDAYS = [5, 6, 0] as const; // Fri, Sat, Sun (JS getUTCDay: Sun=0…Sat=6)

export type ForecastStatus = 'healthy' | 'low' | 'out';

/** One product's decodable attributes the forecast needs. */
export interface ForecastProduct {
  product_id: string;
  name: string;
  product_line: string | null;
  category: string | null;
  subcategory: string | null;
  emoji: string | null;
  stock: number;
}

/** A single sale decrement, already resolved to units + Manila day. */
export interface SaleMovement {
  product_id: string;
  qty: number; // positive units sold
  day: string; // Manila day key YYYY-MM-DD
}

export interface ForecastRow {
  product_id: string;
  name: string;
  product_line: string | null;
  category: string | null;
  subcategory: string | null;
  emoji: string | null;
  stock: number;
  soldPerEventDay: number; // event-aware velocity (units per selling day)
  sellingDays: number; // distinct days with a sale in the window
  coverEventDays: number | null; // null = infinite (no recent sales)
  runsOut: string | null; // ISO date of projected stockout, null when n/a
  runsOutLabel: string; // 'Now' | 'No recent sales' | e.g. 'Sat, Sep 19'
  reorderQty: number | null; // units to restock to target cover, null when healthy
  reorderBy: string | null; // ISO date to order by, null when n/a
  reorderByLabel: string | null; // 'Order now' | short date | null
  status: ForecastStatus;
}

export interface ForecastSummary {
  healthy: number;
  low: number;
  out: number;
  total: number;
}

export interface ForecastConfig {
  threshold: number;
  thresholdOverrides: Record<string, number>; // per-SKU low threshold; overrides `threshold`
  targetCoverEventDays: number;
  leadTimeDays: number;
  earlyWarningEvents: number;
  eventWeekdays: readonly number[];
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
  threshold: LOW_STOCK_THRESHOLD,
  thresholdOverrides: {},
  targetCoverEventDays: TARGET_COVER_EVENT_DAYS,
  leadTimeDays: LEAD_TIME_DAYS,
  earlyWarningEvents: EARLY_WARNING_EVENTS,
  eventWeekdays: EVENT_WEEKDAYS,
};

/** The low-stock threshold for one SKU — its override, else the global default. */
export function effectiveThreshold(config: ForecastConfig, sku: string): number {
  const o = config.thresholdOverrides?.[sku];
  return typeof o === 'number' && Number.isFinite(o) && o >= 0 ? o : config.threshold;
}

// ── Next-event surge plan (Q14/Q15/Q17) ─────────────────────────────────────
export interface NextEventPlan {
  eventThisWeekend: boolean; // false → forecast the *next* weekend, not this one
  multiplier: number; // global uplift on a normal event's demand (e.g. 3 = 3x)
  byCategory: Record<string, number>; // category → multiplier override
  byProduct: Record<string, number>; // SKU → absolute expected units (wins over multipliers)
}

export const DEFAULT_NEXT_EVENT_PLAN: NextEventPlan = {
  eventThisWeekend: true,
  multiplier: 1,
  byCategory: {},
  byProduct: {},
};

// ── Date helpers (day keys are timezone-independent calendar dates) ──────────
function weekdayOf(dayKey: string): number {
  return new Date(dayKey + 'T00:00:00Z').getUTCDay();
}
function addDaysKey(dayKey: string, n: number): string {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shortDate(dayKey: string): string {
  return new Date(dayKey + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
/** The n-th upcoming event-day on/after startKey (1-based). */
function nthUpcomingEventDay(startKey: string, n: number, eventWeekdays: readonly number[]): string {
  const isEvent = (k: string) => eventWeekdays.includes(weekdayOf(k));
  let key = startKey;
  let found = 0;
  for (let guard = 0; guard < 800; guard++) {
    if (isEvent(key)) {
      found++;
      if (found === n) return key;
    }
    key = addDaysKey(key, 1);
  }
  return key; // unreachable for sane n
}

/**
 * Event-aware velocity: total units ÷ the number of distinct days that actually
 * had a sale — not calendar days — so bursty weekend demand isn't diluted by the
 * dead weekdays between bazaars.
 */
export function velocityByProduct(movements: SaleMovement[]): Map<string, {units: number; days: number}> {
  const units = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  for (const m of movements) {
    if (!(m.qty > 0)) continue;
    units.set(m.product_id, (units.get(m.product_id) ?? 0) + m.qty);
    const set = days.get(m.product_id) ?? new Set<string>();
    set.add(m.day);
    days.set(m.product_id, set);
  }
  const out = new Map<string, {units: number; days: number}>();
  for (const [pid, u] of units) out.set(pid, {units: u, days: days.get(pid)?.size ?? 0});
  return out;
}

const STATUS_RANK: Record<ForecastStatus, number> = {out: 0, low: 1, healthy: 2};

/** Build the per-product forecast + status summary. */
export function computeForecast(
  products: ForecastProduct[],
  movements: SaleMovement[],
  now: Date = new Date(),
  config: ForecastConfig = DEFAULT_FORECAST_CONFIG,
): {rows: ForecastRow[]; summary: ForecastSummary} {
  const vel = velocityByProduct(movements);
  const todayKey = manilaDayKey(now.toISOString());

  const rows: ForecastRow[] = products.map((p) => {
    const v = vel.get(p.product_id);
    const sellingDays = v?.days ?? 0;
    const soldPerEventDay = v && v.days > 0 ? v.units / v.days : 0;
    const stock = p.stock;
    const coverEventDays = soldPerEventDay > 0 ? stock / soldPerEventDay : null;

    const threshold = effectiveThreshold(config, p.product_id);
    let status: ForecastStatus;
    if (stock <= 0) status = 'out';
    else if (stock <= threshold || (coverEventDays != null && coverEventDays <= config.earlyWarningEvents)) status = 'low';
    else status = 'healthy';

    let runsOut: string | null = null;
    let runsOutLabel: string;
    if (stock <= 0) {
      runsOut = todayKey;
      runsOutLabel = 'Now';
    } else if (soldPerEventDay <= 0) {
      runsOutLabel = 'No recent sales';
    } else {
      const n = Math.max(1, Math.ceil(stock / soldPerEventDay));
      runsOut = nthUpcomingEventDay(todayKey, n, config.eventWeekdays);
      runsOutLabel = shortDate(runsOut);
    }

    let reorderQty: number | null = null;
    let reorderBy: string | null = null;
    let reorderByLabel: string | null = null;
    if (status !== 'healthy') {
      if (soldPerEventDay > 0) {
        reorderQty = Math.max(0, Math.ceil(config.targetCoverEventDays * soldPerEventDay - stock));
      }
      if (runsOut) {
        const by = addDaysKey(runsOut, -config.leadTimeDays);
        if (by <= todayKey) {
          reorderBy = todayKey;
          reorderByLabel = 'Order now';
        } else {
          reorderBy = by;
          reorderByLabel = shortDate(by);
        }
      }
    }

    return {
      product_id: p.product_id,
      name: p.name,
      product_line: p.product_line,
      category: p.category,
      subcategory: p.subcategory,
      emoji: p.emoji,
      stock,
      soldPerEventDay,
      sellingDays,
      coverEventDays,
      runsOut,
      runsOutLabel,
      reorderQty,
      reorderBy,
      reorderByLabel,
      status,
    };
  });

  // Worst-first: out → low → healthy, then soonest to run out (nulls last).
  rows.sort((a, b) => {
    if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    const ca = a.coverEventDays ?? Infinity;
    const cb = b.coverEventDays ?? Infinity;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });

  const summary: ForecastSummary = {
    healthy: rows.filter((r) => r.status === 'healthy').length,
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
    total: rows.length,
  };

  return {rows, summary};
}

/** The most-urgent rows for the Offline Sales snapshot (out → low), worst first. */
export function urgentForecastRows(rows: ForecastRow[], limit = 4): ForecastRow[] {
  return rows.filter((r) => r.status !== 'healthy').slice(0, limit);
}

// ── Next-event surge: "will current stock survive the expected event?" ───────
export interface SurgeRow {
  product_id: string;
  expected: number; // units expected at the next event
  short: number; // max(0, expected − on-hand)
  manual: boolean; // true when expected came from a per-product absolute
  sustains: boolean; // on-hand covers the expected demand
}

export interface SurgeSummary {
  shortCount: number; // products that won't sustain the event
  restockBy: string | null; // ISO order-by date (next event − lead), null if all fine
  restockByLabel: string | null; // 'Order now' | short date | null
  nextEventDate: string; // ISO of the event being planned for
  nextEventLabel: string; // e.g. 'Sat, Sep 19'
}

/**
 * The effective per-event demand multiplier for a product: its category override,
 * else the global multiplier. (A per-product absolute quantity bypasses this.)
 */
export function effectiveMultiplier(plan: NextEventPlan, category: string | null): number {
  const c = category ? plan.byCategory?.[category] : undefined;
  const m = typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : plan.multiplier;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** First upcoming event-day; when eventThisWeekend is off, skip to the next week's. */
export function nextEventDay(
  plan: NextEventPlan,
  eventWeekdays: readonly number[],
  now: Date = new Date(),
): string {
  const today = manilaDayKey(now.toISOString());
  const first = nthUpcomingEventDay(today, 1, eventWeekdays);
  if (plan.eventThisWeekend) return first;
  // Roll to the next distinct weekend: step past this event's run of days, then
  // find the next event-day.
  let key = first;
  while (eventWeekdays.includes(weekdayOf(key))) key = addDaysKey(key, 1);
  return nthUpcomingEventDay(key, 1, eventWeekdays);
}

/**
 * Per-product surge outlook + a summary. `expected` = a per-product absolute if
 * set, else base per-event demand (soldPerEventDay × event-days in a weekend) ×
 * the effective multiplier. Rows with no sales history and no manual number get 0.
 */
export function computeSurge(
  rows: ForecastRow[],
  plan: NextEventPlan,
  config: ForecastConfig = DEFAULT_FORECAST_CONFIG,
  now: Date = new Date(),
): {rows: Map<string, SurgeRow>; summary: SurgeSummary} {
  const eventDaysPerWeekend = Math.max(1, config.eventWeekdays.length);
  const byId = new Map<string, SurgeRow>();

  for (const r of rows) {
    const manualQty = plan.byProduct?.[r.product_id];
    const hasManual = typeof manualQty === 'number' && Number.isFinite(manualQty) && manualQty >= 0;
    const expected = hasManual
      ? Math.round(manualQty as number)
      : Math.round(r.soldPerEventDay * eventDaysPerWeekend * effectiveMultiplier(plan, r.category));
    const short = Math.max(0, expected - r.stock);
    byId.set(r.product_id, {product_id: r.product_id, expected, short, manual: hasManual, sustains: short === 0});
  }

  const nextDate = nextEventDay(plan, config.eventWeekdays, now);
  const shortCount = [...byId.values()].filter((s) => s.short > 0).length;
  const todayKey = manilaDayKey(now.toISOString());
  const rawBy = addDaysKey(nextDate, -config.leadTimeDays);
  const restockBy = shortCount > 0 ? (rawBy <= todayKey ? todayKey : rawBy) : null;

  return {
    rows: byId,
    summary: {
      shortCount,
      restockBy,
      restockByLabel: restockBy ? (restockBy <= todayKey ? 'Order now' : shortDate(restockBy)) : null,
      nextEventDate: nextDate,
      nextEventLabel: shortDate(nextDate),
    },
  };
}
