import 'server-only';
import {cache} from 'react';
import {unstable_cache} from 'next/cache';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {manilaDayKey} from './pos-sales-compute';
import {POS_TAGS, POS_CACHE_REVALIDATE} from './pos-cache';
import {MOCK_POS_PRODUCTS} from './pos-mock';
import {getStockConfig, getNextEventPlan} from './pos-stock-settings';
import {
  FORECAST_WINDOW_DAYS,
  EVENT_WEEKDAYS,
  computeForecast,
  computeSurge,
  type SaleMovement,
  type ForecastRow,
  type ForecastSummary,
  type ForecastConfig,
  type NextEventPlan,
  type SurgeRow,
  type SurgeSummary,
} from './pos-forecast-compute';

// SERVER-ONLY. Reads the sale-decrement ledger (pos_stock_movements, reason='sale')
// over a trailing window and turns it into the demand signal the forecast needs.
// Mirrors pos-data.ts: service-role env, or a deterministic mock when unset.

/** Sale movements over the trailing window, resolved to units + Manila day. */
export const getSaleMovements = cache((): Promise<SaleMovement[]> =>
  usingPosMock() ? Promise.resolve(mockSaleMovements()) : saleMovementsCached(),
);

// Sale ledger drives the forecast velocity; a new sale (order write) revalidates
// POS_TAGS.orders, so this stays in step with getPosOrders.
const saleMovementsCached = unstable_cache(async (): Promise<SaleMovement[]> => {
  const supabase = posClient();
  const since = new Date(Date.now() - FORECAST_WINDOW_DAYS * 86_400_000).toISOString();
  const {data, error} = await supabase
    .from('pos_stock_movements')
    .select('product_id,delta,reason,created_at')
    .eq('reason', 'sale')
    .gte('created_at', since);
  if (error) throw new Error(`pos_stock_movements read failed: ${error.message}`);

  return (data ?? []).map((m) => ({
    product_id: m.product_id as string,
    qty: Math.abs(Number(m.delta ?? 0)),
    day: manilaDayKey(m.created_at as string),
  }));
}, ['pos-sale-movements'], {tags: [POS_TAGS.orders], revalidate: POS_CACHE_REVALIDATE});

export interface StockForecast {
  rows: ForecastRow[];
  summary: ForecastSummary;
  config: ForecastConfig;
  plan: NextEventPlan;
  surge: Map<string, SurgeRow>;
  surgeSummary: SurgeSummary;
}

/**
 * Products + sale movements + settings → forecast with the next-event surge.
 * Fail-soft: any read error returns null so the Inventory page renders an empty
 * Offline state instead of 500-ing (config/plan are individually fail-soft to
 * defaults inside their readers).
 */
export async function getStockForecast(now: Date = new Date()): Promise<StockForecast | null> {
  try {
    const [products, movements, config, plan] = await Promise.all([
      getPosProducts(),
      getSaleMovements(),
      getStockConfig(),
      getNextEventPlan(),
    ]);
    const {rows, summary} = computeForecast(products, movements, now, config);
    const {rows: surge, summary: surgeSummary} = computeSurge(rows, plan, config, now);
    return {rows, summary, config, plan, surge, surgeSummary};
  } catch {
    return null;
  }
}

// ── Mock demand ──────────────────────────────────────────────────────────────
// Deterministic per-SKU velocity (hash of product_id) spread across the last few
// event-days, so the mock forecast has a realistic mix of healthy/low/out rows
// without any DB. Relative to "now" so run-out dates stay live.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function recentEventDays(count: number, now = new Date()): string[] {
  const days: string[] = [];
  let key = manilaDayKey(now.toISOString());
  for (let guard = 0; guard < 200 && days.length < count; guard++) {
    const wd = new Date(key + 'T00:00:00Z').getUTCDay();
    if (EVENT_WEEKDAYS.includes(wd as (typeof EVENT_WEEKDAYS)[number])) days.push(key);
    const d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    key = d.toISOString().slice(0, 10);
  }
  return days;
}
function mockSaleMovements(now = new Date()): SaleMovement[] {
  const eventDays = recentEventDays(4, now); // last ~4 selling days
  const out: SaleMovement[] = [];
  for (const p of MOCK_POS_PRODUCTS) {
    const perDay = 1 + (hash(p.product_id) % 5); // 1..5 units per event-day
    const activeDays = 1 + (hash(p.product_id + 'd') % eventDays.length); // sold on 1..N of them
    for (const day of eventDays.slice(0, activeDays)) {
      out.push({product_id: p.product_id, qty: perDay, day});
    }
  }
  return out;
}
