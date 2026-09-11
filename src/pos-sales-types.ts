// Shapes for Phase 5 Offline (POS) reporting. An order plus its line items,
// with product names resolved from pos_products.

export type SalesRange = 'today' | '7d' | '30d' | 'all';

export interface PosOrderLine {
  product_id: string | null; // SKU; null for a bundle line
  bundle_id?: string | null; // set on a bundle line (product_id is then null)
  name: string; // resolved product or bundle name, or the raw id if unknown
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface PosOrder {
  id: string;
  client_uuid: string; // idempotency key; passed to void_pos_order when voiding here
  subtotal: number;
  discount: number | null;
  total: number;
  oversold: boolean;
  device_id: string | null;
  payment_method: string | null; // 'cash' | 'gcash' | 'card' | ...; null = legacy/cash
  customer_handle: string | null; // optional furbaby / IG handle from the POS sale
  status: string; // 'completed' | 'voided'; voided sales are excluded from revenue
  remarks: string | null; // free-text note set from the POS
  created_at: string; // ISO
  items: PosOrderLine[];
}

/** Active filters for the transactions list. `all`/null values mean no filter. */
export interface PosOrdersFilter {
  method: string; // 'all' | 'cash' | 'gcash' | 'maya' | 'card' | ...
  status: string; // 'all' | 'completed' | 'voided'
  // Inclusive from/to instants (ISO). The client converts the picked calendar
  // days into absolute instants using the viewer's timezone (start-of-day →
  // end-of-day), so the filter matches the local times shown in the list.
  startDate: string | null;
  endDate: string | null;
  minPrice: number | null;
  maxPrice: number | null;
}

/** Inclusive slider bounds for the price filter, derived from the whole dataset. */
export interface PriceBounds {
  min: number;
  max: number;
}

export interface PosSyncEntry {
  synced_at: string; // ISO
  direction: string; // push / pull
  entity: string; // order / price / catalog / inventory
  summary: Record<string, unknown> | null;
  device_id: string | null;
}

export interface SalesKpis {
  revenue: number;
  orders: number;
  units: number;
  oversells: number;
}

export interface DailySales {
  day: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  revenue: number; // itemized only: Σ line_total (bundle picks are ₱0, so excluded)
  units: number; // Σ qty, INCLUDING bundle-picked units
  bundledUnits: number; // of `units`, how many came from ₱0 (bundle-pick) lines
}

/** A bundle ranked by revenue, from bundle_id order lines (post write-path fix). */
export interface TopBundle {
  bundle_id: string;
  name: string;
  revenue: number; // Σ line_total on this bundle's lines
  orders: number; // number of bundle lines (one per bundle sold)
}

/**
 * Reconciles per-product (itemized) revenue with the Revenue KPI. Bundle deals
 * are recorded as ₱0 component lines with the bundle price only on the order
 * header, so `itemizedRevenue` (what Top products sums) is short of the KPI by
 * `bundleRevenue`. By construction: itemizedRevenue + bundleRevenue = totalRevenue.
 */
export interface BundleSalesSummary {
  itemizedRevenue: number; // Σ line_total across product lines
  bundleRevenue: number; // total - itemized: bundle money not attributed to any product
  bundleOrders: number; // orders carrying a bundle deal (order.total exceeds its line sum)
  totalRevenue: number; // = itemizedRevenue + bundleRevenue = Revenue KPI
}
