import type {PetType, PosOrder, PosOrderLine} from './pos-sales-types';
import {fetchAllRows, type PagedResult} from './pos-fetch-paginate';

// Shared POS-orders read. Takes an INJECTED client so the pages (posClient(),
// full service role) and Ask Coop (a narrowed, guarded client) read through the
// same paging and mapping code. Must not import the full-power client modules
// (the pos and digest data seams), next/* or server-only: the chat
// import-boundary test depends on it.

/** The slice of a supabase-js select builder these reads use. */
export interface ReadBuilder extends PromiseLike<PagedResult> {
  order(column: string, options?: {ascending?: boolean}): ReadBuilder;
  range(from: number, to: number): ReadBuilder;
}

/**
 * Structural minimal client: both supabase-js `SupabaseClient` and the chat
 * client satisfy it. `from` is declared with method syntax (parameter
 * bivariance) so a client narrowed to an allowlisted relation union fits.
 */
export interface ReadClient {
  from(relation: string): {select(columns: string): ReadBuilder};
}

export interface PosOrdersReadOptions {
  tables?: Partial<{orders: string; items: string; products: string; bundles: string}>;
  /** Comma-separated PostgREST column lists. Defaults are today's page selects. */
  columns?: Partial<{orders: string; items: string; products: string; bundles: string}>;
}

export const DEFAULT_ORDER_COLUMNS =
  'id,client_uuid,subtotal,discount,total,oversold,device_id,payment_method,customer_handle,status,remarks,created_at,edited_at,event_id,pet_type';
export const DEFAULT_ITEM_COLUMNS = 'order_id,product_id,bundle_id,bundle_group,qty,unit_price,line_total';

function normalizePetType(raw: unknown): PetType | null {
  return raw === 'dog' || raw === 'cat' || raw === 'both' ? raw : null;
}

/**
 * All orders (newest first) with line items and resolved names. Every bulk read
 * is paged via fetchAllRows (PostgREST caps responses at db.max_rows). Customer
 * level fields absent from `columns` map to null (client_uuid to '').
 */
export async function readPosOrders(client: ReadClient, opts: PosOrdersReadOptions = {}): Promise<PosOrder[]> {
  const t = {orders: 'pos_orders', items: 'pos_order_items', products: 'pos_products', bundles: 'pos_bundles', ...opts.tables};
  const c = {
    orders: DEFAULT_ORDER_COLUMNS,
    items: DEFAULT_ITEM_COLUMNS,
    products: 'product_id,name',
    bundles: 'bundle_id,name',
    ...opts.columns,
  };
  const [orders, items, products, bundles] = await Promise.all([
    fetchAllRows(t.orders, (from, to) =>
      client
        .from(t.orders)
        .select(c.orders)
        .order('created_at', {ascending: false})
        .order('id', {ascending: true})
        .range(from, to)),
    fetchAllRows(t.items, (from, to) =>
      client.from(t.items).select(c.items).order('id', {ascending: true}).range(from, to)),
    fetchAllRows(t.products, (from, to) =>
      client.from(t.products).select(c.products).order('product_id', {ascending: true}).range(from, to)),
    fetchAllRows(t.bundles, (from, to) =>
      client.from(t.bundles).select(c.bundles).order('bundle_id', {ascending: true}).range(from, to)),
  ]);

  const nameBySku = new Map<string, string>();
  for (const p of products) nameBySku.set(p.product_id as string, p.name as string);
  const nameByBundle = new Map<string, string>();
  for (const b of bundles) nameByBundle.set(b.bundle_id as string, b.name as string);

  const itemsByOrder = new Map<string, PosOrderLine[]>();
  for (const it of items) {
    const orderId = it.order_id as string;
    const productId = (it.product_id as string | null) ?? null;
    const bundleId = (it.bundle_id as string | null) ?? null;
    const line: PosOrderLine = {
      product_id: productId,
      bundle_id: bundleId,
      bundle_group: (it.bundle_group as string | null) ?? null,
      name: (productId && nameBySku.get(productId)) || (bundleId && nameByBundle.get(bundleId)) || productId || bundleId || 'Unknown',
      qty: (it.qty as number) ?? 0,
      unit_price: Number(it.unit_price ?? 0),
      line_total: Number(it.line_total ?? 0),
    };
    const arr = itemsByOrder.get(orderId) ?? [];
    arr.push(line);
    itemsByOrder.set(orderId, arr);
  }

  return orders.map((o): PosOrder => ({
    id: o.id as string,
    client_uuid: (o.client_uuid as string | undefined) ?? '',
    subtotal: Number(o.subtotal ?? 0),
    discount: o.discount != null ? Number(o.discount) : null,
    total: Number(o.total ?? 0),
    oversold: Boolean(o.oversold),
    device_id: (o.device_id as string | null | undefined) ?? null,
    payment_method: (o.payment_method as string | null) ?? null,
    customer_handle: (o.customer_handle as string | null | undefined) ?? null,
    status: (o.status as string | null) === 'voided' ? 'voided' : 'completed',
    remarks: (o.remarks as string | null | undefined) ?? null,
    created_at: o.created_at as string,
    edited_at: (o.edited_at as string | null) ?? null,
    event_id: (o.event_id as string | null) ?? null,
    pet_type: normalizePetType(o.pet_type),
    items: itemsByOrder.get(o.id as string) ?? [],
  }));
}
