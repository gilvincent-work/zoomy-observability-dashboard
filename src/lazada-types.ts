/**
 * Shapes for the Lazada Seller-Center export pipeline.
 *
 * `LazadaOrderItem` is the DB row (snake_case, one per ORDER ITEM, keyed on
 * `order_item_id`); `LazadaCustomer` is the read-time rollup by phone number.
 * The rollup is deliberately not materialised — see supabase/lazada_orders.sql.
 */

/** A raw spreadsheet row, after header mapping and before normalisation. */
export type LazadaSheetRow = Partial<Record<string, unknown>>;

export type LazadaOrderItem = {
  order_item_id: string;
  order_number: string | null;
  ordered_at: string;
  status: string | null;
  customer_name: string | null;
  city: string | null;
  phone: string;
  item_name: string | null;
  // Optional, not just nullable: an install predating the money migration has
  // no such columns at all, and the readers treat them as absent rather than
  // coupling the deploy to the SQL run.
  variation?: string | null;
  paid_price?: number | null;
  shipping_fee?: number | null;
  pay_method?: string | null;
  /** Stamped by the database, so it is absent on rows being written. */
  uploaded_at?: string;
};

export type LazadaCustomer = {
  phone: string;
  name: string | null;
  city: string | null;
  lastOrderAt: string;
  firstOrderAt: string;
  lastProduct: string | null;
  payMethod: string | null;
  totalSpent: number;
  /** Average per ORDER, not per item — the figure a merchant reasons about. */
  avgOrder: number;
  orderCount: number;
  daysSince: number;
};

/** Rows the parser rejected, by reason. Counts only — never the rows. */
export type LazadaSkipped = {status: number; phone: number; date: number; id: number};

export type LazadaUpload = {
  uploaded_at: string;
  file_name: string | null;
  rows_read: number;
  items_saved: number;
  buyers: number;
  skipped_status: number;
  skipped_phone: number;
  skipped_date: number;
  skipped_id?: number;
  excluded_buyers?: number;
};

export type LazadaTotals = {
  customers: number;
  orders: number;
  repeatCustomers: number;
  cities: number;
  revenue: number;
  oldestOrderAt: string | null;
  newestOrderAt: string | null;
};

/**
 * What the browser reports about a parse, for the upload ledger.
 *
 * Values are `unknown` on purpose: this crosses the wire from the client, so
 * buildUploadSummary coerces every figure rather than trusting it (and
 * recomputes the ones it can, like buyer count, from the payload itself).
 */
export type LazadaParseStats = {
  total?: unknown;
  buyers?: unknown;
  skipped?: Partial<Record<keyof LazadaSkipped, unknown>>;
  exclusions?: {excludedBuyers?: unknown} | null;
};
