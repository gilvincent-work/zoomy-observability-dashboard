'use server';

import {revalidatePath} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {parsePrice} from './pos-format';

// Server actions for Product Controls. Coop co-owns name / price / listing with
// the POS and writes them through the SAME SECURITY DEFINER RPCs (see
// COOP_INTEGRATION_PLAN.md) so the audit trail (pos_price_changes) stays
// consistent regardless of which side made the edit. Product creation is
// Coop-only and has no RPC, so it's a direct insert here (service-role).
// All actions are online-only; there is no offline queue on the Coop side.

const ACTOR = 'coop';

export type ActionResult = {ok: true} | {ok: false; error: string};

function mockBlocked(): ActionResult {
  return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to make edits.'};
}

/** Create a product (Coop-only). Seeds its price via the reprice RPC if given. */
export async function createProductAction(input: {
  product_id: string;
  name: string;
  product_line?: string | null;
  price?: string;
}): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();

  const product_id = input.product_id.trim();
  const name = input.name.trim();
  if (!product_id) return {ok: false, error: 'SKU Code is required.'};
  if (!name) return {ok: false, error: 'Name is required.'};

  let price: number | null = null;
  if (input.price && input.price.trim()) {
    const parsed = parsePrice(input.price);
    if ('error' in parsed) return {ok: false, error: parsed.error};
    price = parsed.value;
  }

  const supabase = posClient();
  const {error} = await supabase.from('pos_products').insert({
    product_id,
    name,
    product_line: input.product_line?.trim() || null,
    active: true,
  });
  if (error) {
    if (error.code === '23505') return {ok: false, error: `SKU ${product_id} already exists.`};
    return {ok: false, error: error.message};
  }

  if (price != null) {
    const {error: priceErr} = await supabase.rpc('reprice_product', {
      p_product_id: product_id,
      p_new_price: price,
      p_reason: 'initial price',
      p_by: ACTOR,
    });
    if (priceErr) return {ok: false, error: `Product created, but price failed: ${priceErr.message}`};
  }

  revalidatePath('/products');
  return {ok: true};
}

export async function renameProductAction(product_id: string, name: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const trimmed = name.trim();
  if (!trimmed) return {ok: false, error: 'Name is required.'};

  const {error} = await posClient().rpc('rename_product', {
    p_product_id: product_id,
    p_name: trimmed,
    p_by: ACTOR,
  });
  if (error) return {ok: false, error: error.message};
  revalidatePath('/products');
  return {ok: true};
}

export async function repriceProductAction(product_id: string, price: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const parsed = parsePrice(price);
  if ('error' in parsed) return {ok: false, error: parsed.error};

  const {error} = await posClient().rpc('reprice_product', {
    p_product_id: product_id,
    p_new_price: parsed.value,
    p_reason: 'coop edit',
    p_by: ACTOR,
  });
  if (error) return {ok: false, error: error.message};
  revalidatePath('/products');
  return {ok: true};
}

export async function setListingAction(product_id: string, active: boolean): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();

  const {error} = await posClient().rpc('set_product_listing', {
    p_product_id: product_id,
    p_active: active,
    p_by: ACTOR,
  });
  if (error) return {ok: false, error: error.message};
  revalidatePath('/products');
  return {ok: true};
}
