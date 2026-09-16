import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {
  DEFAULT_FORECAST_CONFIG,
  DEFAULT_NEXT_EVENT_PLAN,
  type ForecastConfig,
  type NextEventPlan,
} from './pos-forecast-compute';

// SERVER-ONLY. Reads the Stock Forecast config + next-event surge plan from
// pos_settings (keys seeded in the pos_stock_forecast_settings migration). Both
// readers are FAIL-SOFT to the compiled-in defaults: a missing key, malformed
// JSON, or a read error simply yields the Phase-1 constants, so the forecast
// always renders. Mirrors src/pos-target.ts.

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function numMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

/** Parse the stored config blob into a ForecastConfig, defaulting each field. */
export function parseStockConfig(value: unknown): ForecastConfig {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const days = Array.isArray(v.event_days)
    ? (v.event_days as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : [];
  return {
    threshold: numOr(v.threshold, DEFAULT_FORECAST_CONFIG.threshold),
    thresholdOverrides: numMap(v.threshold_overrides),
    targetCoverEventDays: numOr(v.target_cover_events, DEFAULT_FORECAST_CONFIG.targetCoverEventDays),
    leadTimeDays: numOr(v.lead_time_days, DEFAULT_FORECAST_CONFIG.leadTimeDays),
    earlyWarningEvents: numOr(v.early_warning_events, DEFAULT_FORECAST_CONFIG.earlyWarningEvents),
    eventWeekdays: days.length ? days : DEFAULT_FORECAST_CONFIG.eventWeekdays,
  };
}

/** Parse the stored surge plan into a NextEventPlan, defaulting each field. */
export function parseNextEventPlan(value: unknown): NextEventPlan {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    eventThisWeekend: v.event_this_weekend !== false, // default true
    multiplier: numOr(v.multiplier, DEFAULT_NEXT_EVENT_PLAN.multiplier) || 1,
    byCategory: numMap(v.by_category),
    byProduct: numMap(v.by_product),
  };
}

/** The forecast config; defaults when unset/mock/error. */
export const getStockConfig = cache(async (): Promise<ForecastConfig> => {
  noStore();
  if (usingPosMock()) return DEFAULT_FORECAST_CONFIG;
  try {
    const {data, error} = await posClient()
      .from('pos_settings')
      .select('value')
      .eq('key', 'stock_forecast_config')
      .maybeSingle();
    if (error || !data) return DEFAULT_FORECAST_CONFIG;
    return parseStockConfig(data.value);
  } catch {
    return DEFAULT_FORECAST_CONFIG;
  }
});

/** The next-event surge plan; defaults when unset/mock/error. */
export const getNextEventPlan = cache(async (): Promise<NextEventPlan> => {
  noStore();
  if (usingPosMock()) return DEFAULT_NEXT_EVENT_PLAN;
  try {
    const {data, error} = await posClient()
      .from('pos_settings')
      .select('value')
      .eq('key', 'next_event_plan')
      .maybeSingle();
    if (error || !data) return DEFAULT_NEXT_EVENT_PLAN;
    return parseNextEventPlan(data.value);
  } catch {
    return DEFAULT_NEXT_EVENT_PLAN;
  }
});

/** Serialize a ForecastConfig back to the stored blob shape (for the RPC). */
export function configToJson(c: ForecastConfig): Record<string, unknown> {
  return {
    threshold: c.threshold,
    threshold_overrides: c.thresholdOverrides,
    target_cover_events: c.targetCoverEventDays,
    lead_time_days: c.leadTimeDays,
    early_warning_events: c.earlyWarningEvents,
    velocity_mode: 'event_aware',
    event_days: c.eventWeekdays,
  };
}

/** Serialize a NextEventPlan back to the stored blob shape (for the RPC). */
export function planToJson(p: NextEventPlan): Record<string, unknown> {
  return {
    event_this_weekend: p.eventThisWeekend,
    multiplier: p.multiplier,
    by_category: p.byCategory,
    by_product: p.byProduct,
  };
}
