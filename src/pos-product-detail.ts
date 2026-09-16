import 'server-only';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {getPosOrders} from './pos-sales';
import {getStockForecast} from './pos-forecast-data';
import {getStockReceipts, type StockReceipt} from './pos-stock-intake';
import {manilaMonthKey, monthKeyOffset, monthKeyLabel, yoyDeltaPct} from './pos-inventory-compute';
import type {PosProductRow} from './pos-types';
import type {ForecastRow} from './pos-forecast-compute';

// SERVER-ONLY. Everything the per-product detail chart needs: the product, its
// forecast row, and a 3-real + 3-forecast month window with sold (real + forecast +
// same-month-last-year), reconstructed end-of-month stock, deliveries, and the
// count-reconciliation facts. Fail-soft: missing pieces degrade, the page still
// renders.

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // 'May'
  sold: number; // units sold that month (real)
  stockEnd: number | null; // reconstructed on-hand at month end
}

/** A stock delivery that landed in a month (aggregated), for the ▲ marker. */
export interface Delivery {
  qty: number; // total received that month
  dateLabel: string; // 'May 20' (the latest receipt that month)
}

// One column of the chart: the 3 real months carry sold + reconstructed stockEnd
// (+ a delivery when one landed); the 3 forecast months carry soldForecast and the
// stock running down if nothing is ordered. soldLastYear is the same calendar
// month a year earlier, for the "vs last year" overlay.
export interface ChartMonth {
  key: string; // YYYY-MM
  label: string; // 'MAR'
  isForecast: boolean;
  isCurrent: boolean; // the latest real month (boxed on the axis)
  sold: number | null;
  soldForecast: number | null;
  soldLastYear: number | null;
  stockEnd: number | null;
  stockForecast: number | null;
  delivery: Delivery | null;
  runsOut: boolean; // the forecast month the projection first hits 0
}

export interface ProductDetail {
  product: PosProductRow;
  forecast: ForecastRow | null;
  series: MonthPoint[]; // 3 real months (for the sold-by-month table)
  chart: ChartMonth[]; // 3 real + 3 forecast months (for the chart)
  latestRealLabel: string; // 'May' — the newest month with real data
  yoy: {thisMonth: number; lastYearSold: number; deltaPct: number | null; monthLabel: string} | null;
  hasLastYear: boolean; // any same-month-last-year sales in the window (gates the toggle)
  lastCountedWeeksAgo: number | null; // from the latest 'recount' movement
  countsMatched: boolean | null; // last 3 months all reconciled (recount delta 0); null if never counted
  runsOutLabel: string | null; // e.g. 'Runs out ~Aug'
  usingMock: boolean;
  receipts: StockReceipt[]; // this SKU's stock-in history
}

type Movement = {delta: number; created_at: string; reason: string};

function monthLabel(key: string): string {
  return new Date(key + '-01T00:00:00Z').toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});
}
function lastThreeMonths(now: Date): string[] {
  const cur = manilaMonthKey(now.toISOString());
  const [y, m] = cur.split('-').map(Number);
  return [2, 1, 0].map((i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}
function nextThreeMonths(now: Date): string[] {
  const cur = manilaMonthKey(now.toISOString());
  const [y, m] = cur.split('-').map(Number);
  return [1, 2, 3].map((i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}
/** The YYYY-MM one year before a given month key. */
function yearBefore(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y - 1, m - 1, 1)).toISOString().slice(0, 7);
}
/** End-of-month cutoff for a YYYY-MM (first instant of the next month). */
function monthEndIso(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString();
}
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});

export async function getProductDetail(sku: string, now: Date = new Date()): Promise<ProductDetail | null> {
  const products = await getPosProducts();
  const product = products.find((p) => p.product_id === sku);
  if (!product) return null;

  const [forecast, orders, receipts, movements] = await Promise.all([
    getStockForecast(now).catch(() => null),
    getPosOrders().catch(() => []),
    getStockReceipts(200).then((r) => r.filter((x) => x.product_id === sku)).catch(() => [] as StockReceipt[]),
    loadAllMovements(sku).catch(() => [] as Movement[]),
  ]);

  const real = lastThreeMonths(now);
  const future = nextThreeMonths(now);

  // Monthly sold for this SKU across all history (so last-year lookups are free).
  const soldByMonth = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const mk = manilaMonthKey(o.created_at);
    for (const line of o.items) {
      if (line.product_id !== sku) continue;
      soldByMonth.set(mk, (soldByMonth.get(mk) ?? 0) + Number(line.qty ?? 0));
    }
  }
  // Deliveries (receipts) aggregated per Manila month.
  const deliveryByMonth = new Map<string, {qty: number; latest: string}>();
  for (const r of receipts) {
    if (r.reason !== 'receipt' || !(r.delta > 0)) continue;
    const mk = manilaMonthKey(r.created_at);
    const cur = deliveryByMonth.get(mk) ?? {qty: 0, latest: r.created_at};
    cur.qty += r.delta;
    if (r.created_at > cur.latest) cur.latest = r.created_at;
    deliveryByMonth.set(mk, cur);
  }
  const delivery = (mk: string): Delivery | null => {
    const d = deliveryByMonth.get(mk);
    return d ? {qty: d.qty, dateLabel: dayLabel(d.latest)} : null;
  };

  // Reconstruct end-of-month stock: stockEnd(M) = current - Σ(delta after month-end M).
  const stockEndOf = (mk: string): number | null => {
    if (!movements.length) return null;
    const cutoff = monthEndIso(mk);
    const after = movements.filter((mv) => mv.created_at > cutoff).reduce((s, mv) => s + Number(mv.delta ?? 0), 0);
    return product.stock - after;
  };

  const series: MonthPoint[] = real.map((mk) => ({month: mk, label: monthLabel(mk), sold: soldByMonth.get(mk) ?? 0, stockEnd: stockEndOf(mk)}));

  // Recent pace: mean of the real months that actually sold (recent burst, not
  // diluted by dead months).
  const soldMonths = series.map((m) => m.sold).filter((v) => v > 0);
  const pace = soldMonths.length ? Math.round(soldMonths.reduce((a, b) => a + b, 0) / soldMonths.length) : 0;

  // Last year, same calendar month, for each forecast month — lets the forecast
  // follow last year's seasonality instead of a flat line, when data exists.
  const fyForecast = future.map((mk) => soldByMonth.get(yearBefore(mk)) ?? 0);
  const fyAvg = fyForecast.filter((v) => v > 0).length ? fyForecast.reduce((a, b) => a + b, 0) / fyForecast.filter((v) => v > 0).length : 0;
  const forecastSold = (i: number): number => (fyAvg > 0 ? Math.max(0, Math.round(pace * (fyForecast[i] / fyAvg))) : pace);

  // Build the 3 real columns.
  const chart: ChartMonth[] = real.map((mk, i) => ({
    key: mk,
    label: monthLabel(mk).toUpperCase(),
    isForecast: false,
    isCurrent: i === real.length - 1,
    sold: soldByMonth.get(mk) ?? 0,
    soldForecast: null,
    soldLastYear: soldByMonth.get(yearBefore(mk)) ?? null,
    stockEnd: stockEndOf(mk),
    stockForecast: i === real.length - 1 ? stockEndOf(mk) : null, // seed the dashed line
    delivery: delivery(mk),
    runsOut: false,
  }));

  // Then the 3 forecast columns, running the stock down from today's on-hand.
  let projStock = product.stock;
  let runsOutLabel: string | null = null;
  future.forEach((mk, i) => {
    const before = projStock;
    const sold = forecastSold(i);
    projStock = Math.max(0, projStock - sold);
    const runsOut = before > 0 && projStock === 0 && !runsOutLabel;
    if (runsOut) runsOutLabel = `Runs out ~${monthLabel(mk)}`;
    chart.push({
      key: mk,
      label: monthLabel(mk).toUpperCase(),
      isForecast: true,
      isCurrent: false,
      sold: null,
      soldForecast: sold,
      soldLastYear: soldByMonth.get(yearBefore(mk)) ?? null,
      stockEnd: null,
      stockForecast: projStock,
      delivery: null,
      runsOut,
    });
  });

  const hasLastYear = chart.some((c) => (c.soldLastYear ?? 0) > 0);

  // Year-over-year headline (this month vs same month last year).
  const thisMonthKey = manilaMonthKey(now.toISOString());
  const lastYearKey = monthKeyOffset(now, 12);
  const thisMonthSold = soldByMonth.get(thisMonthKey) ?? 0;
  const lastYearSold = soldByMonth.get(lastYearKey) ?? 0;
  const yoy = lastYearSold > 0
    ? {thisMonth: thisMonthSold, lastYearSold, deltaPct: yoyDeltaPct(thisMonthSold, lastYearSold), monthLabel: monthKeyLabel(lastYearKey)}
    : null;

  // Count reconciliation, from 'recount' movements.
  const recounts = movements.filter((m) => m.reason === 'recount');
  const lastCounted = recounts.length ? recounts.reduce((a, b) => (a.created_at > b.created_at ? a : b)) : null;
  const lastCountedWeeksAgo = lastCounted
    ? Math.max(0, Math.round((now.getTime() - new Date(lastCounted.created_at).getTime()) / (7 * 24 * 3600 * 1000)))
    : null;
  const recountsByMonth = new Map<string, Movement[]>();
  for (const r of recounts) {
    const mk = manilaMonthKey(r.created_at);
    recountsByMonth.set(mk, [...(recountsByMonth.get(mk) ?? []), r]);
  }
  const countsMatched: boolean | null = real.every((mk) => recountsByMonth.has(mk))
    ? real.every((mk) => (recountsByMonth.get(mk) ?? []).every((r) => Number(r.delta ?? 0) === 0))
    : null;

  return {
    product,
    forecast: (forecast?.rows ?? []).find((r) => r.product_id === sku) ?? null,
    series,
    chart,
    latestRealLabel: monthLabel(real[real.length - 1]),
    yoy,
    hasLastYear,
    lastCountedWeeksAgo,
    countsMatched,
    runsOutLabel,
    usingMock: usingPosMock(),
    receipts,
  };
}

/** All stock movements for one SKU (any reason), for reconstruction + counts. */
async function loadAllMovements(sku: string): Promise<Movement[]> {
  if (usingPosMock()) return [];
  const {data, error} = await posClient()
    .from('pos_stock_movements')
    .select('delta,created_at,reason')
    .eq('product_id', sku)
    .order('created_at', {ascending: true});
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({delta: Number(m.delta ?? 0), created_at: m.created_at as string, reason: (m.reason as string) ?? ''}));
}
