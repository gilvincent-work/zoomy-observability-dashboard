import 'server-only';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {getPosOrders} from './pos-sales';
import {getStockForecast} from './pos-forecast-data';
import {getStockReceipts, type StockReceipt} from './pos-stock-intake';
import {manilaMonthKey, monthKeyOffset, monthKeyLabel, yoyDeltaPct} from './pos-inventory-compute';
import type {PosProductRow} from './pos-types';
import type {ForecastRow} from './pos-forecast-compute';

// SERVER-ONLY. Everything the per-product detail page needs: the product, its
// forecast row, a six-month sold + end-of-month-stock series (stock reconstructed
// backward from the current on-hand through the movement ledger), and its
// stock-in history. Fail-soft: missing pieces degrade, the page still renders.

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // 'May'
  sold: number; // units sold that month (real)
  stockEnd: number | null; // reconstructed on-hand at month end
}

// One point on the chart: past months carry real sold + reconstructed stockEnd;
// future months carry the dashed forecast (soldForecast) and the stock running
// down if nothing is ordered (stockForecast).
export interface ChartPoint {
  label: string;
  sold: number | null;
  stockEnd: number | null;
  soldForecast: number | null;
  stockForecast: number | null;
}

export interface ProductDetail {
  product: PosProductRow;
  forecast: ForecastRow | null;
  series: MonthPoint[]; // oldest → newest, 6 real months (for the table)
  chart: ChartPoint[]; // 6 real + 3 forecast months (for the chart)
  yoy: {thisMonth: number; lastYearSold: number; deltaPct: number | null; monthLabel: string} | null; // this month vs same month last year (null if no baseline)
  runsOutLabel: string | null; // e.g. 'Runs out ~Aug' when the projection hits 0
  usingMock: boolean;
  receipts: StockReceipt[]; // this SKU's stock-in history
}

function monthLabel(key: string): string {
  return new Date(key + '-01T00:00:00Z').toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});
}
function lastSixMonths(now: Date): string[] {
  const cur = manilaMonthKey(now.toISOString());
  const [y, m] = cur.split('-').map(Number);
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
/** End-of-month UTC-ish cutoff for a YYYY-MM (first instant of the next month). */
function monthEndIso(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString();
}

export async function getProductDetail(sku: string, now: Date = new Date()): Promise<ProductDetail | null> {
  const products = await getPosProducts();
  const product = products.find((p) => p.product_id === sku);
  if (!product) return null;

  const [forecast, orders, receipts, movements] = await Promise.all([
    getStockForecast(now).catch(() => null),
    getPosOrders().catch(() => []),
    getStockReceipts(200).then((r) => r.filter((x) => x.product_id === sku)).catch(() => [] as StockReceipt[]),
    loadAllMovements(sku).catch(() => [] as {delta: number; created_at: string}[]),
  ]);

  const months = lastSixMonths(now);
  // Monthly sold for this SKU.
  const soldByMonth = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'voided') continue;
    const mk = manilaMonthKey(o.created_at);
    for (const line of o.items) {
      if (line.product_id !== sku) continue;
      soldByMonth.set(mk, (soldByMonth.get(mk) ?? 0) + Number(line.qty ?? 0));
    }
  }
  // Reconstruct end-of-month stock: stockEnd(M) = current - Σ(delta after month-end M).
  const series: MonthPoint[] = months.map((mk) => {
    const cutoff = monthEndIso(mk);
    const after = movements.filter((mv) => mv.created_at > cutoff).reduce((s, mv) => s + Number(mv.delta ?? 0), 0);
    const stockEnd = movements.length ? product.stock - after : null;
    return {month: mk, label: monthLabel(mk), sold: soldByMonth.get(mk) ?? 0, stockEnd};
  });

  // Year-over-year: this Manila month vs the same month one year back. soldByMonth
  // spans all history, so both are direct lookups. Null when there is no baseline.
  const thisMonthKey = manilaMonthKey(now.toISOString());
  const lastYearKey = monthKeyOffset(now, 12);
  const thisMonthSold = soldByMonth.get(thisMonthKey) ?? 0;
  const lastYearSold = soldByMonth.get(lastYearKey) ?? 0;
  const yoy = lastYearSold > 0
    ? {thisMonth: thisMonthSold, lastYearSold, deltaPct: yoyDeltaPct(thisMonthSold, lastYearSold), monthLabel: monthKeyLabel(lastYearKey)}
    : null;

  // Forecast the next 3 months: monthly pace = mean of the months that actually
  // sold (recent burst, not diluted by dead months); the stock runs down from the
  // current on-hand if nothing is ordered. Dashed on the chart.
  const soldMonths = series.map((m) => m.sold).filter((v) => v > 0);
  const pace = soldMonths.length ? Math.round(soldMonths.reduce((a, b) => a + b, 0) / soldMonths.length) : 0;
  const future = nextThreeMonths(now);
  let projStock = product.stock;
  let runsOutLabel: string | null = null;
  const chart: ChartPoint[] = series.map((m, i) => ({
    label: m.label, sold: m.sold, stockEnd: m.stockEnd,
    soldForecast: null,
    // seed the dashed stock line at the last real point so it connects
    stockForecast: i === series.length - 1 ? m.stockEnd : null,
  }));
  for (const mk of future) {
    const before = projStock;
    projStock = Math.max(0, projStock - pace);
    if (before > 0 && projStock === 0 && !runsOutLabel) runsOutLabel = `Runs out ~${monthLabel(mk)}`;
    chart.push({label: monthLabel(mk), sold: null, stockEnd: null, soldForecast: pace, stockForecast: projStock});
  }

  return {
    product,
    forecast: (forecast?.rows ?? []).find((r) => r.product_id === sku) ?? null,
    series,
    chart,
    yoy,
    runsOutLabel,
    usingMock: usingPosMock(),
    receipts,
  };
}

function nextThreeMonths(now: Date): string[] {
  const cur = manilaMonthKey(now.toISOString());
  const [y, m] = cur.split('-').map(Number);
  return [1, 2, 3].map((i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}

/** All stock movements for one SKU (any reason), for the stock reconstruction. */
async function loadAllMovements(sku: string): Promise<{delta: number; created_at: string}[]> {
  if (usingPosMock()) return [];
  const {data, error} = await posClient()
    .from('pos_stock_movements')
    .select('delta,created_at')
    .eq('product_id', sku)
    .order('created_at', {ascending: true});
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => ({delta: Number(m.delta ?? 0), created_at: m.created_at as string}));
}
