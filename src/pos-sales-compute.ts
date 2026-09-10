import type {PosProductRow} from './pos-types';
import type {ChannelFacts} from './health-types';
import type {DailySales, PosOrder, PosOrdersFilter, PriceBounds, SalesKpis, SalesRange, TopProduct} from './pos-sales-types';

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

/** A voided sale didn't happen: it's excluded from every revenue aggregation. */
function isVoided(o: PosOrder): boolean {
  return o.status === 'voided';
}

export function computeKpis(orders: PosOrder[]): SalesKpis {
  let revenue = 0;
  let count = 0;
  let units = 0;
  let oversells = 0;
  for (const o of orders) {
    if (isVoided(o)) continue;
    revenue += o.total;
    count += 1;
    if (o.oversold) oversells += 1;
    for (const it of o.items) units += it.qty;
  }
  return {revenue, orders: count, units, oversells};
}

/** Group orders by UTC calendar day, ascending. Days with no sales are omitted. */
export function salesByDay(orders: PosOrder[]): DailySales[] {
  const byDay = new Map<string, {revenue: number; orders: number}>();
  for (const o of orders) {
    if (isVoided(o)) continue;
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
    if (isVoided(o)) continue;
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

// ── Transactions filters ──────────────────────────────────────────────────
export const DEFAULT_ORDERS_FILTER: PosOrdersFilter = {
  method: 'all',
  status: 'all',
  startDate: null,
  endDate: null,
  minPrice: null,
  maxPrice: null,
};

/** Methods offered as filter chips (mirrors the POS cart Pay control order). */
export const ORDER_METHOD_FILTERS: {value: string; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'cash', label: 'Cash'},
  {value: 'qrph', label: 'QRPH'},
  {value: 'gcash', label: 'GCash'},
  {value: 'maya', label: 'Maya'},
  {value: 'card', label: 'Card'},
];

/** Status chips for the transactions filter. */
export const ORDER_STATUS_FILTERS: {value: string; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'completed', label: 'Completed'},
  {value: 'voided', label: 'Voided'},
];

/** Parse a non-negative number param; null when blank or invalid. */
function parseMoneyParam(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A valid ISO instant string, else null. */
export function parseInstantParam(raw: string | undefined): string | null {
  if (raw == null || raw === '') return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

/** Normalize raw search params into a well-formed filter (unknowns fall back). */
export function parseOrdersFilter(sp: {
  method?: string;
  status?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
}): PosOrdersFilter {
  const method = ORDER_METHOD_FILTERS.some((m) => m.value === sp.method) ? (sp.method as string) : 'all';
  const status = ORDER_STATUS_FILTERS.some((s) => s.value === sp.status) ? (sp.status as string) : 'all';
  let startDate = parseInstantParam(sp.from);
  let endDate = parseInstantParam(sp.to);
  // A reversed range is a user error; swap so it always reads earliest → latest.
  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    [startDate, endDate] = [endDate, startDate];
  }
  let minPrice = parseMoneyParam(sp.min);
  let maxPrice = parseMoneyParam(sp.max);
  // A reversed price range is a user error; swap so it always reads low → high.
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  return {method, status, startDate, endDate, minPrice, maxPrice};
}

/** True when any filter is narrowing the results (used to show a Reset). */
export function isFilterActive(f: PosOrdersFilter): boolean {
  return f.method !== 'all' || f.status !== 'all' || f.startDate != null || f.endDate != null || f.minPrice != null || f.maxPrice != null;
}

/** A null payment_method is a legacy row; the UI reads it as Cash, so match it. */
function methodMatches(orderMethod: string | null, filterMethod: string): boolean {
  if (filterMethod === 'all') return true;
  if (filterMethod === 'cash') return orderMethod === 'cash' || orderMethod == null;
  return orderMethod === filterMethod;
}

/** Apply the transactions filter in memory (mock path + unit tests). */
export function filterOrders(orders: PosOrder[], f: PosOrdersFilter): PosOrder[] {
  return orders.filter((o) => {
    if (!methodMatches(o.payment_method, f.method)) return false;
    if (f.status !== 'all' && o.status !== f.status) return false;
    if (f.startDate && o.created_at < f.startDate) return false;
    if (f.endDate && o.created_at > f.endDate) return false;
    if (f.minPrice != null && o.total < f.minPrice) return false;
    if (f.maxPrice != null && o.total > f.maxPrice) return false;
    return true;
  });
}

/** Slider bounds from the dataset's max order total, rounded up to a clean step. */
export function priceBounds(orders: PosOrder[]): PriceBounds {
  const max = orders.reduce((m, o) => Math.max(m, o.total), 0);
  return boundsFromMax(max);
}

/** Round a raw max total up to a tidy slider ceiling (nearest 100, min 100). */
export function boundsFromMax(max: number): PriceBounds {
  const ceiling = Math.max(100, Math.ceil(max / 100) * 100);
  return {min: 0, max: ceiling};
}

// ── Pagination (transactions list) ────────────────────────────────────────
export const ORDERS_PAGE_SIZE = 10;

export interface PageInfo {
  page: number; // clamped, 1-based
  pageSize: number;
  totalPages: number;
  from: number; // 0-based inclusive start index (for a range query)
  to: number; // 0-based inclusive end index
}

/** Pure page math: clamp `page` into [1, totalPages] and derive range indices. */
export function paginate(total: number, page: number, pageSize = ORDERS_PAGE_SIZE): PageInfo {
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const from = (clamped - 1) * size;
  const to = from + size - 1;
  return {page: clamped, pageSize: size, totalPages, from, to};
}

/** Parse a `?page=` param into a positive integer, defaulting to 1. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// ── Business Health channel facts (Surface D) ─────────────────────────────
/**
 * Build a synthetic "offline" ChannelFacts from POS orders so Business Health
 * can render offline as a fourth channel that pools into the Overall QRR. Shaped
 * like the Website channel: no ads (adSpend/adRevenue null → no ROAS), no
 * platform fee, and a ₱0 event-cost default so it stays OUT of the pooled QRR
 * until someone enters an event cost. buyers is 0 — the POS has no buyer
 * identity — so the card shows Repeat rate N/A. Returns null when there are no
 * orders (nothing to show).
 */
export function offlineChannelFacts(orders: PosOrder[]): ChannelFacts | null {
  if (orders.length === 0) return null;
  const {revenue, orders: count} = computeKpis(orders);
  return {
    channel: 'offline',
    orders: count,
    buyers: 0,
    revenue,
    adSpend: null,
    adRevenue: null,
    platformFeeApplies: false,
    defaults: {cogsPct: 0.35, platformFeePct: 0, promos: 0, acqCost: 0},
  };
}

/**
 * Offline metrics shaped for the Overview "Compare Channels" chart: revenue,
 * orders, aov, units — no adSpend/roas (bazaar sales have no ads, shown as N-A).
 * Returns null when there are no orders. The shape mirrors the chart's per-channel
 * metric record (keys: revenue, orders, aov, units, adSpend, roas).
 */
export function offlineCompareMetrics(orders: PosOrder[]): {
  revenue: number;
  orders: number;
  aov: number;
  units: number;
  adSpend: number | null;
  roas: number | null;
} | null {
  if (orders.length === 0) return null;
  const {revenue, orders: count, units} = computeKpis(orders);
  return {
    revenue,
    orders: count,
    aov: count ? Math.round((revenue / count) * 100) / 100 : 0,
    units,
    adSpend: null,
    roas: null,
  };
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
