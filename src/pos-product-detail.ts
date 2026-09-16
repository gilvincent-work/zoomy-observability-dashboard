import 'server-only';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {getPosOrders} from './pos-sales';
import {getStockForecast} from './pos-forecast-data';
import {getStockReceipts, type StockReceipt} from './pos-stock-intake';
import {manilaMonthKey} from './pos-inventory-compute';
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

export interface ProductDetail {
  product: PosProductRow;
  forecast: ForecastRow | null;
  series: MonthPoint[]; // oldest → newest, 6 months
  receipts: StockReceipt[]; // this SKU's stock-in history
  usingMock: boolean;
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

  return {
    product,
    forecast: (forecast?.rows ?? []).find((r) => r.product_id === sku) ?? null,
    series,
    receipts,
    usingMock: usingPosMock(),
  };
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
