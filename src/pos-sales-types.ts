// Shapes for Phase 5 Offline (POS) reporting. An order plus its line items,
// with product names resolved from pos_products.

export type SalesRange = 'today' | '7d' | '30d' | 'all';

export interface PosOrderLine {
  product_id: string | null; // SKU; null for a bundle line
  name: string; // resolved product name, or the raw id if unknown
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface PosOrder {
  id: string;
  subtotal: number;
  discount: number | null;
  total: number;
  oversold: boolean;
  device_id: string | null;
  payment_method: string | null; // 'cash' | 'gcash' | 'card' | ...; null = legacy/cash
  created_at: string; // ISO
  items: PosOrderLine[];
}

/** Active filters for the transactions list. Empty/`all` values mean no filter. */
export interface PosOrdersFilter {
  method: string; // 'all' | 'cash' | 'gcash' | 'maya' | 'card' | ...
  range: SalesRange; // 'all' | 'today' | '7d' | '30d'
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
  revenue: number;
  units: number;
}
