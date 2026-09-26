import 'server-only';
import {cache} from 'react';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {getLocationStock} from './pos-location-data';

// SERVER-ONLY. Data for the Prizes panel: the won free items (joined to their
// order + customer), a list of recent orders to attach a backfilled prize to, and
// the product list with Event on-hand. Read live (the offline-sales page is
// force-dynamic), so no unstable_cache here.

export interface PrizeRow {
  id: string;
  client_uuid: string | null;
  product_id: string;
  product_name: string;
  qty: number;
  oversold: boolean;
  note: string | null;
  won_at: string;
  voided_at: string | null;
  order_client_uuid: string | null;
  customer_handle: string | null;
  order_at: string | null;
}

export interface RecentOrder {
  client_uuid: string;
  label: string; // customer + date + total, for the picker
}

export interface PrizeProduct {
  product_id: string;
  name: string;
  event: number;
}

export interface PrizeData {
  prizes: PrizeRow[];
  recentOrders: RecentOrder[];
  products: PrizeProduct[];
}

const EMPTY: PrizeData = {prizes: [], recentOrders: [], products: []};

const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'}) : '—';

export const getPrizeData = cache(async (): Promise<PrizeData> => {
  if (usingPosMock()) return EMPTY;
  const supabase = posClient();

  const [prizeRes, ordersRes, products, locations] = await Promise.all([
    supabase
      .from('pos_order_prizes')
      .select('id,client_uuid,product_id,qty,oversold,note,won_at,voided_at,pos_orders(client_uuid,customer_handle,created_at)')
      .order('won_at', {ascending: false})
      .limit(200),
    supabase
      .from('pos_orders')
      .select('client_uuid,customer_handle,created_at,total,status')
      .eq('status', 'completed')
      .not('client_uuid', 'is', null)
      .order('created_at', {ascending: false})
      .limit(100),
    getPosProducts(),
    getLocationStock().catch(() => []),
  ]);
  if (prizeRes.error) throw new Error(`pos_order_prizes read failed: ${prizeRes.error.message}`);
  if (ordersRes.error) throw new Error(`pos_orders read failed: ${ordersRes.error.message}`);

  const nameById = new Map(products.map((p) => [p.product_id, p.name]));
  const eventById = new Map(locations.map((l) => [l.product_id, l.event]));

  const prizes: PrizeRow[] = (prizeRes.data ?? []).map((r) => {
    const ord = pickOne(r.pos_orders) as {client_uuid: string | null; customer_handle: string | null; created_at: string | null} | null;
    return {
      id: r.id as string,
      client_uuid: (r.client_uuid as string | null) ?? null,
      product_id: r.product_id as string,
      product_name: nameById.get(r.product_id as string) ?? (r.product_id as string),
      qty: Number(r.qty ?? 0),
      oversold: Boolean(r.oversold),
      note: (r.note as string | null) ?? null,
      won_at: r.won_at as string,
      voided_at: (r.voided_at as string | null) ?? null,
      order_client_uuid: ord?.client_uuid ?? null,
      customer_handle: ord?.customer_handle ?? null,
      order_at: ord?.created_at ?? null,
    };
  });

  const recentOrders: RecentOrder[] = (ordersRes.data ?? []).map((o) => {
    const who = (o.customer_handle as string | null)?.trim() || 'Walk-in';
    return {
      client_uuid: o.client_uuid as string,
      label: `${who} · ${shortDate(o.created_at as string | null)} · ${peso(Number(o.total ?? 0))}`,
    };
  });

  const productList: PrizeProduct[] = products.map((p) => ({
    product_id: p.product_id,
    name: p.name,
    event: eventById.get(p.product_id) ?? 0,
  }));

  return {prizes, recentOrders, products: productList};
});

function pickOne<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}
