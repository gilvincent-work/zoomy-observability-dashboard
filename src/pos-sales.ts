import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import type {PosOrder, PosOrderLine, PosSyncEntry} from './pos-sales-types';
import {paginate, type PageInfo} from './pos-sales-compute';
import {MOCK_POS_ORDERS, MOCK_POS_SYNC_LOG} from './pos-sales-mock';

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
      .select('id,subtotal,discount,total,oversold,device_id,created_at')
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
export const getPosOrdersPage = cache(async (page: number, pageSize?: number): Promise<{orders: PosOrder[]; pageInfo: PageInfo}> => {
  noStore();

  if (usingPosMock()) {
    const info = paginate(MOCK_POS_ORDERS.length, page, pageSize);
    return {orders: MOCK_POS_ORDERS.slice(info.from, info.to + 1), pageInfo: info};
  }

  const supabase = posClient();
  const {count, error: countErr} = await supabase
    .from('pos_orders')
    .select('id', {count: 'exact', head: true});
  if (countErr) throw new Error(`pos_orders count failed: ${countErr.message}`);

  const info = paginate(count ?? 0, page, pageSize);
  if ((count ?? 0) === 0) return {orders: [], pageInfo: info};

  const {data: orderRows, error: ordersErr} = await supabase
    .from('pos_orders')
    .select('id,subtotal,discount,total,oversold,device_id,created_at')
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
    created_at: o.created_at as string,
    items: itemsByOrder.get(o.id as string) ?? [],
  }));

  return {orders, pageInfo: info};
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
