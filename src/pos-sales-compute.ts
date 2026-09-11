import type {PosProductRow} from './pos-types';
import type {ChannelFacts} from './health-types';
import type {BundleSalesSummary, DailySales, DayMethodRevenue, PosOrder, PosOrdersFilter, PriceBounds, SalesKpis, SalesRange, TopBundle, TopProduct} from './pos-sales-types';

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

// Asia/Manila is UTC+8 year-round (no DST). Sales are reported on the Manila
// calendar day so "Today" and the daily chart match how an owner thinks about a
// bazaar day (and match the Daily target bar). A Manila day begins at 16:00 UTC
// the previous day.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The UTC instant at which the current Asia/Manila calendar day began. */
export function manilaDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + MANILA_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MANILA_OFFSET_MS);
}

/** The Manila calendar day (YYYY-MM-DD) an instant falls on. */
export function manilaDayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Inclusive lower bound (ISO) for a range, or null for 'all'. 'today' is the
 *  Manila calendar day; 7d/30d are rolling 7x/30x-24h windows. */
export function rangeStart(range: SalesRange, now: Date = new Date()): string | null {
  if (range === 'all') return null;
  if (range === 'today') return manilaDayStart(now).toISOString();
  const d = new Date(now);
  if (range === '7d') {
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

/** Group orders by Manila calendar day, ascending. Days with no sales omitted. */
export function salesByDay(orders: PosOrder[]): DailySales[] {
  const byDay = new Map<string, {revenue: number; orders: number}>();
  for (const o of orders) {
    if (isVoided(o)) continue;
    const day = manilaDayKey(o.created_at); // YYYY-MM-DD (Asia/Manila)
    const cur = byDay.get(day) ?? {revenue: 0, orders: 0};
    cur.revenue += o.total;
    cur.orders += 1;
    byDay.set(day, cur);
  }
  return Array.from(byDay.entries())
    .map(([day, v]) => ({day, revenue: v.revenue, orders: v.orders}))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ── Payment-method breakdown ──────────────────────────────────────────────
// Canonical display order for methods (matches the POS pay control + badges).
// A null/legacy payment_method reads as cash, consistent with the label helper.
const PAYMENT_METHOD_ORDER = ['cash', 'qrph', 'gcash', 'maya', 'card', 'bpi', 'bank_transfer'];

/** An order's payment method, with null/legacy normalized to 'cash'. */
export function orderMethod(o: PosOrder): string {
  return o.payment_method ?? 'cash';
}

/** Distinct payment methods present in these orders (voided excluded), in
 *  canonical order, with any unknown method appended alphabetically. */
export function presentMethods(orders: PosOrder[]): string[] {
  const set = new Set<string>();
  for (const o of orders) if (!isVoided(o)) set.add(orderMethod(o));
  return Array.from(set).sort((a, b) => {
    const ia = PAYMENT_METHOD_ORDER.indexOf(a);
    const ib = PAYMENT_METHOD_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/** Revenue per Manila day split by payment method, ascending by day. Days with
 *  no (non-voided) sales are omitted. Feeds the stacked sales-over-time chart. */
export function salesByDayAndMethod(orders: PosOrder[]): DayMethodRevenue[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const o of orders) {
    if (isVoided(o)) continue;
    const day = manilaDayKey(o.created_at);
    const method = orderMethod(o);
    const rec = byDay.get(day) ?? {};
    rec[method] = (rec[method] ?? 0) + o.total;
    byDay.set(day, rec);
  }
  return Array.from(byDay.entries())
    .map(([day, byMethod]) => ({day, byMethod}))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** How the Top products list is ranked: by itemized revenue or by units sold. */
export type TopProductSort = 'revenue' | 'units';

/** Top products from order line items, ranked by revenue (default) or units,
 *  each with the other as tiebreak. */
export function topProducts(orders: PosOrder[], limit = 5, sortBy: TopProductSort = 'revenue'): TopProduct[] {
  const byProduct = new Map<string, TopProduct>();
  for (const o of orders) {
    if (isVoided(o)) continue;
    for (const it of o.items) {
      if (!it.product_id) continue; // skip bundle-only lines with no SKU
      const cur = byProduct.get(it.product_id) ?? {product_id: it.product_id, name: it.name, revenue: 0, units: 0, bundledUnits: 0};
      cur.revenue += it.line_total;
      cur.units += it.qty;
      // A ₱0 line is a bundle pick: it moved stock but its value sits on the
      // order header (see the RCA in COOP_INTEGRATION_PLAN.md), so it adds units
      // without adding revenue.
      if (it.line_total === 0) cur.bundledUnits += it.qty;
      byProduct.set(it.product_id, cur);
    }
  }
  const byRevenue = (a: TopProduct, b: TopProduct) => b.revenue - a.revenue || b.units - a.units;
  const byUnits = (a: TopProduct, b: TopProduct) => b.units - a.units || b.revenue - a.revenue;
  return Array.from(byProduct.values())
    .sort(sortBy === 'units' ? byUnits : byRevenue)
    .slice(0, limit);
}

/**
 * Reconcile itemized (per-product) revenue with the Revenue KPI. Bundle revenue
 * is everything NOT attributed to a product line, whether it sits on a bundle_id
 * line (post write-path fix) or only on the order header (pre-fix / offline
 * retries). So itemizedRevenue sums product lines only, and bundleRevenue is the
 * remainder; itemizedRevenue + bundleRevenue == totalRevenue by construction.
 */
export function bundleSalesSummary(orders: PosOrder[]): BundleSalesSummary {
  let itemizedRevenue = 0;
  let totalRevenue = 0;
  let bundleOrders = 0;
  for (const o of orders) {
    if (isVoided(o)) continue;
    totalRevenue += o.total;
    let productLineSum = 0;
    for (const it of o.items) if (it.product_id) productLineSum += it.line_total;
    itemizedRevenue += productLineSum;
    if (o.total - productLineSum > 0) bundleOrders += 1;
  }
  return {itemizedRevenue, bundleRevenue: totalRevenue - itemizedRevenue, bundleOrders, totalRevenue};
}

/**
 * Top bundles by revenue, from bundle_id lines. Only sales recorded with a real
 * bundle line appear here (online sales after the write-path fix); pre-fix and
 * offline-retried bundle sales carry no bundle_id, so they don't show by name
 * but are still counted in bundleSalesSummary's bundleRevenue. Voided excluded.
 */
export function topBundles(orders: PosOrder[], limit = 5): TopBundle[] {
  const byBundle = new Map<string, TopBundle>();
  for (const o of orders) {
    if (isVoided(o)) continue;
    for (const it of o.items) {
      if (!it.bundle_id) continue;
      const cur = byBundle.get(it.bundle_id) ?? {bundle_id: it.bundle_id, name: it.name, revenue: 0, orders: 0};
      cur.revenue += it.line_total;
      cur.orders += 1;
      byBundle.set(it.bundle_id, cur);
    }
  }
  return Array.from(byBundle.values())
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
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
