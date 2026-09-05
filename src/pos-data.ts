import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {PosProductRow} from './pos-types';
import {MOCK_POS_PRODUCTS} from './pos-mock';

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
      .select('product_id,name,product_line,active,pos_prices(price)')
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
      active: Boolean(r.active),
      price: price?.price ?? null,
      stock: inv?.stock ?? 0,
      next_expiry: inv?.next_expiry ?? null,
    };
  });
});

function pickOne<T>(embedded: T | T[] | null | undefined): T | null {
  if (Array.isArray(embedded)) return embedded[0] ?? null;
  return embedded ?? null;
}
