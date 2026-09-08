import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import type {PosOrder, PosOrderLine, PosOrdersFilter, PosSyncEntry, PriceBounds} from './pos-sales-types';
import {
  boundsFromMax,
  DEFAULT_ORDERS_FILTER,
  filterOrders,
  paginate,
  priceBounds,
  rangeStart,
  type PageInfo,
} from './pos-sales-compute';
import {MOCK_POS_ORDERS, MOCK_POS_SYNC_LOG} from './pos-sales-mock';

/**
 * The transactions filter expressed as PostgREST operations, so the exact same
 * predicates apply to both the count (head) query and the row-range query. A
 * 'cash' filter also matches legacy null rows, mirroring how the UI labels them.
 * Returned as data (not a builder wrapper) to avoid the deep generic
 * instantiation that wrapping the Supabase builder type triggers.
 */
type OrderFilterOp =
  | ['or', string]
  | ['eq', string, string]
  | ['gte', string, string | number]
  | ['lte', string, string | number];

function orderFilterOps(filter: PosOrdersFilter): OrderFilterOp[] {
  const ops: OrderFilterOp[] = [];
  if (filter.method !== 'all') {
    ops.push(
      filter.method === 'cash'
        ? ['or', 'payment_method.eq.cash,payment_method.is.null']
        : ['eq', 'payment_method', filter.method],
    );
  }
  const start = rangeStart(filter.range);
  if (start) ops.push(['gte', 'created_at', start]);
  if (filter.minPrice != null) ops.push(['gte', 'total', filter.minPrice]);
  if (filter.maxPrice != null) ops.push(['lte', 'total', filter.maxPrice]);
  return ops;
}

// SERVER-ONLY. Reads the offline (POS) sales tables with the shared archive
// service-role key (see src/pos-data.ts). Leave the env unset to render mocks.

/**
 * All POS orders (newest first) with their line items, product names resolved
 * from pos_products. React-cached so a page and its layout don't double-fetch.
 */
export const getPosOrders = cache(async (): Promise<PosOrder[]> => {
  noStore();
  if (usingPosMock()) return MOCK_POS_ORDERS;

  const supabase = posClient();
  const [ordersRes, itemsRes, productsRes] = await Promise.all([
    supabase
      .from('pos_orders')
      .select('id,subtotal,discount,total,oversold,device_id,payment_method,created_at')
      .order('created_at', {ascending: false}),
    supabase.from('pos_order_items').select('order_id,product_id,qty,unit_price,line_total'),
    supabase.from('pos_products').select('product_id,name'),
  ]);

  if (ordersRes.error) throw new Error(`pos_orders read failed: ${ordersRes.error.message}`);
  if (itemsRes.error) throw new Error(`pos_order_items read failed: ${itemsRes.error.message}`);
  if (productsRes.error) throw new Error(`pos_products read failed: ${productsRes.error.message}`);

  const nameBySku = new Map<string, string>();
  for (const p of productsRes.data ?? []) nameBySku.set(p.product_id as string, p.name as string);

  const itemsByOrder = new Map<string, PosOrderLine[]>();
  for (const it of itemsRes.data ?? []) {
    const orderId = it.order_id as string;
    const productId = (it.product_id as string | null) ?? null;
    const line: PosOrderLine = {
      product_id: productId,
      name: (productId && nameBySku.get(productId)) || productId || 'Unknown',
      qty: (it.qty as number) ?? 0,
      unit_price: Number(it.unit_price ?? 0),
      line_total: Number(it.line_total ?? 0),
    };
    const arr = itemsByOrder.get(orderId) ?? [];
    arr.push(line);
    itemsByOrder.set(orderId, arr);
  }

  return (ordersRes.data ?? []).map((o): PosOrder => ({
    id: o.id as string,
    subtotal: Number(o.subtotal ?? 0),
    discount: o.discount != null ? Number(o.discount) : null,
    total: Number(o.total ?? 0),
    oversold: Boolean(o.oversold),
    device_id: (o.device_id as string | null) ?? null,
    payment_method: (o.payment_method as string | null) ?? null,
    created_at: o.created_at as string,
    items: itemsByOrder.get(o.id as string) ?? [],
  }));
});

/**
 * One page of orders (newest first) with server-side pagination. Reads a total
 * count, then only that page's order rows (via range) and only their line items
 * (by id) — so it stays bounded as history grows, unlike getPosOrders which
 * fetches everything for aggregation. Returns the clamped page info alongside.
 */
export const getPosOrdersPage = cache(async (
  page: number,
  filter: PosOrdersFilter = DEFAULT_ORDERS_FILTER,
  pageSize?: number,
): Promise<{orders: PosOrder[]; pageInfo: PageInfo}> => {
  noStore();

  if (usingPosMock()) {
    const filtered = filterOrders(MOCK_POS_ORDERS, filter);
    const info = paginate(filtered.length, page, pageSize);
    return {orders: filtered.slice(info.from, info.to + 1), pageInfo: info};
  }

  const supabase = posClient();
  const ops = orderFilterOps(filter);

  let countQuery = supabase.from('pos_orders').select('id', {count: 'exact', head: true});
  for (const op of ops) {
    countQuery = op[0] === 'or' ? countQuery.or(op[1])
      : op[0] === 'eq' ? countQuery.eq(op[1], op[2])
      : op[0] === 'gte' ? countQuery.gte(op[1], op[2])
      : countQuery.lte(op[1], op[2]);
  }
  const {count, error: countErr} = await countQuery;
  if (countErr) throw new Error(`pos_orders count failed: ${countErr.message}`);

  const info = paginate(count ?? 0, page, pageSize);
  if ((count ?? 0) === 0) return {orders: [], pageInfo: info};

  let rowQuery = supabase
    .from('pos_orders')
    .select('id,subtotal,discount,total,oversold,device_id,payment_method,created_at');
  for (const op of ops) {
    rowQuery = op[0] === 'or' ? rowQuery.or(op[1])
      : op[0] === 'eq' ? rowQuery.eq(op[1], op[2])
      : op[0] === 'gte' ? rowQuery.gte(op[1], op[2])
      : rowQuery.lte(op[1], op[2]);
  }
  const {data: orderRows, error: ordersErr} = await rowQuery
    .order('created_at', {ascending: false})
    .range(info.from, info.to);
  if (ordersErr) throw new Error(`pos_orders read failed: ${ordersErr.message}`);

  const ids = (orderRows ?? []).map((o) => o.id as string);
  const [itemsRes, productsRes] = await Promise.all([
    supabase.from('pos_order_items').select('order_id,product_id,qty,unit_price,line_total').in('order_id', ids),
    supabase.from('pos_products').select('product_id,name'),
  ]);
  if (itemsRes.error) throw new Error(`pos_order_items read failed: ${itemsRes.error.message}`);
  if (productsRes.error) throw new Error(`pos_products read failed: ${productsRes.error.message}`);

  const nameBySku = new Map<string, string>();
  for (const p of productsRes.data ?? []) nameBySku.set(p.product_id as string, p.name as string);

  const itemsByOrder = new Map<string, PosOrderLine[]>();
  for (const it of itemsRes.data ?? []) {
    const orderId = it.order_id as string;
    const productId = (it.product_id as string | null) ?? null;
    const arr = itemsByOrder.get(orderId) ?? [];
    arr.push({
      product_id: productId,
      name: (productId && nameBySku.get(productId)) || productId || 'Unknown',
      qty: (it.qty as number) ?? 0,
      unit_price: Number(it.unit_price ?? 0),
      line_total: Number(it.line_total ?? 0),
    });
    itemsByOrder.set(orderId, arr);
  }

  const orders = (orderRows ?? []).map((o): PosOrder => ({
    id: o.id as string,
    subtotal: Number(o.subtotal ?? 0),
    discount: o.discount != null ? Number(o.discount) : null,
    total: Number(o.total ?? 0),
    oversold: Boolean(o.oversold),
    device_id: (o.device_id as string | null) ?? null,
    payment_method: (o.payment_method as string | null) ?? null,
    created_at: o.created_at as string,
    items: itemsByOrder.get(o.id as string) ?? [],
  }));

  return {orders, pageInfo: info};
});

/**
 * Inclusive price bounds for the transactions filter slider, from the single
 * highest order total across the whole dataset (unfiltered, so the slider range
 * stays stable as other filters change). Returns a clean ceiling; 0..100 when
 * there are no orders.
 */
export const getPosOrdersPriceBounds = cache(async (): Promise<PriceBounds> => {
  noStore();
  if (usingPosMock()) return priceBounds(MOCK_POS_ORDERS);

  const supabase = posClient();
  const {data, error} = await supabase
    .from('pos_orders')
    .select('total')
    .order('total', {ascending: false})
    .limit(1);
  if (error) throw new Error(`pos_orders price bounds failed: ${error.message}`);

  return boundsFromMax(Number(data?.[0]?.total ?? 0));
});

/** Recent sync-log entries (newest first), for the "recently synced" strip. */
export const getPosSyncLog = cache(async (limit = 8): Promise<PosSyncEntry[]> => {
  noStore();
  if (usingPosMock()) return MOCK_POS_SYNC_LOG.slice(0, limit);

  const supabase = posClient();
  const {data, error} = await supabase
    .from('pos_sync_log')
    .select('synced_at,direction,entity,summary,device_id')
    .order('synced_at', {ascending: false})
    .limit(limit);
  if (error) throw new Error(`pos_sync_log read failed: ${error.message}`);

  return (data ?? []).map((r): PosSyncEntry => ({
    synced_at: r.synced_at as string,
    direction: r.direction as string,
    entity: r.entity as string,
    summary: (r.summary as Record<string, unknown> | null) ?? null,
    device_id: (r.device_id as string | null) ?? null,
  }));
});
