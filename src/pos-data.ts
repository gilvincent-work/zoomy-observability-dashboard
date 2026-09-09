import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {PosProductRow, PosBundleRow} from './pos-types';
import {MOCK_POS_PRODUCTS, MOCK_POS_BUNDLES} from './pos-mock';

// SERVER-ONLY. pos_* lives in the SAME Supabase project as the digest archive
// (see COOP_INTEGRATION_PLAN.md, "shared project"), so we reuse the archive
// service-role env. The service-role key bypasses RLS, so Coop reads/writes
// pos_* directly here — never in a client component, never with the anon key.
// Leave the env unset to render the mock catalog (src/pos-mock.ts).
const url = process.env.SUPABASE_URL_ARCHIVE;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

/** True when the Supabase env is absent — the page renders mock products. */
export function usingPosMock(): boolean {
  return !url || !serviceKey;
}

/** A service-role client for pos_* reads/writes. Throws if env is missing. */
export function posClient(): SupabaseClient {
  if (usingPosMock()) throw new Error('pos_* Supabase env not configured');
  return createClient(url as string, serviceKey as string, {auth: {persistSession: false}});
}

/**
 * Read all products with current price and live stock, ordered by product line
 * then name. pos_prices has a real 1:1 FK to pos_products so it embeds reliably;
 * pos_inventory is a VIEW (no FK for PostgREST to infer an embed from), so it's
 * read separately and merged by product_id in JS. React-cached so a page and its
 * layout don't double-fetch.
 */
export const getPosProducts = cache(async (): Promise<PosProductRow[]> => {
  noStore(); // catalog edits must show immediately, never a stale Data Cache read
  if (usingPosMock()) return MOCK_POS_PRODUCTS;

  const supabase = posClient();

  const [productsRes, inventoryRes] = await Promise.all([
    supabase
      .from('pos_products')
      .select('product_id,name,product_line,category,subcategory,emoji,active,pos_prices(price)')
      .order('product_line', {ascending: true})
      .order('name', {ascending: true}),
    supabase.from('pos_inventory').select('product_id,stock,next_expiry'),
  ]);

  if (productsRes.error) throw new Error(`pos_products read failed: ${productsRes.error.message}`);
  if (inventoryRes.error) throw new Error(`pos_inventory read failed: ${inventoryRes.error.message}`);

  const invByProduct = new Map<string, {stock: number; next_expiry: string | null}>();
  for (const inv of inventoryRes.data ?? []) {
    invByProduct.set(inv.product_id as string, {
      stock: (inv.stock as number) ?? 0,
      next_expiry: (inv.next_expiry as string | null) ?? null,
    });
  }

  return (productsRes.data ?? []).map((r): PosProductRow => {
    // pos_prices embeds as an array or object depending on how PostgREST sees the
    // 1:1 FK — normalize both.
    const price = pickOne(r.pos_prices) as {price: number} | null;
    const inv = invByProduct.get(r.product_id as string);
    return {
      product_id: r.product_id as string,
      name: r.name as string,
      product_line: (r.product_line as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      subcategory: (r.subcategory as string | null) ?? null,
      emoji: (r.emoji as string | null) ?? null,
      active: Boolean(r.active),
      price: price?.price ?? null,
      stock: inv?.stock ?? 0,
      next_expiry: inv?.next_expiry ?? null,
    };
  });
});

/**
 * Read all bundles synced from the POS (pos_bundles) with their fixed-item
 * contents, product names resolved. Ordered by name. Mocks when env is unset.
 */
export const getPosBundles = cache(async (): Promise<PosBundleRow[]> => {
  noStore();
  if (usingPosMock()) return MOCK_POS_BUNDLES;

  const supabase = posClient();
  const [bundlesRes, itemsRes, productsRes] = await Promise.all([
    supabase.from('pos_bundles').select('bundle_id,name,price,active,bundle_type,pick_count,line_categories,emoji').order('name', {ascending: true}),
    supabase.from('pos_bundle_items').select('bundle_id,product_id,qty'),
    supabase.from('pos_products').select('product_id,name'),
  ]);
  if (bundlesRes.error) throw new Error(`pos_bundles read failed: ${bundlesRes.error.message}`);
  if (itemsRes.error) throw new Error(`pos_bundle_items read failed: ${itemsRes.error.message}`);
  if (productsRes.error) throw new Error(`pos_products read failed: ${productsRes.error.message}`);

  const nameBySku = new Map<string, string>();
  for (const p of productsRes.data ?? []) nameBySku.set(p.product_id as string, p.name as string);

  const itemsByBundle = new Map<string, {product_id: string; name: string; qty: number}[]>();
  for (const it of itemsRes.data ?? []) {
    const bid = it.bundle_id as string;
    const sku = it.product_id as string;
    const arr = itemsByBundle.get(bid) ?? [];
    arr.push({product_id: sku, name: nameBySku.get(sku) ?? sku, qty: Number(it.qty ?? 1)});
    itemsByBundle.set(bid, arr);
  }

  return (bundlesRes.data ?? []).map((b): PosBundleRow => ({
    bundle_id: b.bundle_id as string,
    name: b.name as string,
    price: Number(b.price ?? 0),
    active: Boolean(b.active),
    bundle_type: (b.bundle_type as string) === 'pick' ? 'pick' : 'fixed',
    pick_count: (b.pick_count as number | null) ?? null,
    line_categories: (b.line_categories as string[] | null) ?? null,
    emoji: (b.emoji as string | null) ?? null,
    items: itemsByBundle.get(b.bundle_id as string) ?? [],
  }));
});

function pickOne<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}
