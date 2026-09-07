import type {PosProductRow} from './pos-types';
import type {DailySales, PosOrder, SalesKpis, SalesRange, TopProduct} from './pos-sales-types';

// Pure aggregation helpers for the Offline (POS) reporting surfaces. No
// server/client concerns so they're unit-testable and shared across pages.

export const SALES_RANGES: {value: SalesRange; label: string}[] = [
  {value: 'today', label: 'Today'},
  {value: '7d', label: '7 days'},
  {value: '30d', label: '30 days'},
  {value: 'all', label: 'All'},
];

export function isSalesRange(v: string | undefined): v is SalesRange {
  return v === 'today' || v === '7d' || v === '30d' || v === 'all';
}

/** Inclusive lower bound (ISO) for a range, or null for 'all'. */
export function rangeStart(range: SalesRange, now: Date = new Date()): string | null {
  if (range === 'all') return null;
  const d = new Date(now);
  if (range === 'today') {
    d.setUTCHours(0, 0, 0, 0);
  } else if (range === '7d') {
    d.setUTCDate(d.getUTCDate() - 7);
  } else if (range === '30d') {
    d.setUTCDate(d.getUTCDate() - 30);
  }
  return d.toISOString();
}

/** Keep orders whose created_at is at/after the range start. */
export function filterOrdersByRange(orders: PosOrder[], range: SalesRange, now: Date = new Date()): PosOrder[] {
  const start = rangeStart(range, now);
  if (!start) return orders;
  return orders.filter((o) => o.created_at >= start);
}

export function computeKpis(orders: PosOrder[]): SalesKpis {
  let revenue = 0;
  let units = 0;
  let oversells = 0;
  for (const o of orders) {
    revenue += o.total;
    if (o.oversold) oversells += 1;
    for (const it of o.items) units += it.qty;
  }
  return {revenue, orders: orders.length, units, oversells};
}

/** Group orders by UTC calendar day, ascending. Days with no sales are omitted. */
export function salesByDay(orders: PosOrder[]): DailySales[] {
  const byDay = new Map<string, {revenue: number; orders: number}>();
  for (const o of orders) {
    const day = o.created_at.slice(0, 10); // YYYY-MM-DD (UTC)
    const cur = byDay.get(day) ?? {revenue: 0, orders: 0};
    cur.revenue += o.total;
    cur.orders += 1;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .map(([day, v]) => ({day, revenue: v.revenue, orders: v.orders}))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Top products by revenue (units as tiebreak), from order line items. */
export function topProducts(orders: PosOrder[], limit = 5): TopProduct[] {
  const byProduct = new Map<string, TopProduct>();
  for (const o of orders) {
    for (const it of o.items) {
      if (!it.product_id) continue; // skip bundle-only lines with no SKU
      const cur = byProduct.get(it.product_id) ?? {product_id: it.product_id, name: it.name, revenue: 0, units: 0};
      cur.revenue += it.line_total;
      cur.units += it.qty;
      byProduct.set(it.product_id, cur);
    }
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    .slice(0, limit);
}

// ── Stock alerts (Surface B) ──────────────────────────────────────────────
export const LOW_STOCK_UNITS = 10;
export const NEAR_EXPIRY_DAYS = 30;

export interface StockAlerts {
  low: PosProductRow[]; // in stock but at/under the low threshold (excludes out)
  out: PosProductRow[]; // zero or negative stock
  nearExpiry: PosProductRow[]; // has stock and an expiry within the window
}

/** Split the catalog into low / out / near-expiry buckets for the alerts card. */
export function stockAlerts(
  products: PosProductRow[],
  now: Date = new Date(),
  lowUnits = LOW_STOCK_UNITS,
  expiryDays = NEAR_EXPIRY_DAYS,
): StockAlerts {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + expiryDays);
  const horizonIso = horizon.toISOString().slice(0, 10);

  const low: PosProductRow[] = [];
  const out: PosProductRow[] = [];
  const nearExpiry: PosProductRow[] = [];

  for (const p of products) {
    if (p.stock <= 0) out.push(p);
    else if (p.stock <= lowUnits) low.push(p);
    if (p.stock > 0 && p.next_expiry && p.next_expiry <= horizonIso) nearExpiry.push(p);
  }

  low.sort((a, b) => a.stock - b.stock);
  nearExpiry.sort((a, b) => (a.next_expiry ?? '').localeCompare(b.next_expiry ?? ''));
  return {low, out, nearExpiry};
}
