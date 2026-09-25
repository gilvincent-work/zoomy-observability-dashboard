'use server';

import {revalidatePath, revalidateTag} from 'next/cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';
import {POS_TAGS} from './pos-cache';
import {parseEmoji, parsePrice, parseQty, POS_CATEGORIES, POS_SUBCATEGORIES, PRODUCT_LINES} from './pos-format';

// Server actions for Product Controls. Coop co-owns name / price / listing with
// the POS and writes them through the SAME SECURITY DEFINER RPCs (see
// COOP_INTEGRATION_PLAN.md) so the audit trail (pos_price_changes) stays
// consistent regardless of which side made the edit. Product creation is
// Coop-only and has no RPC, so it's a direct insert here (service-role).
// All actions are online-only; there is no offline queue on the Coop side.

const ACTOR = 'coop';

/** The signed-in Coop user's email (for the audit trail), or 'coop' as a fallback. */
async function actor(): Promise<string> {
  try {
    const session = await auth();
    return session?.user?.email ?? ACTOR;
  } catch {
    return ACTOR;
  }
}

export type ActionResult = {ok: true} | {ok: false; error: string};

function mockBlocked(): ActionResult {
  return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to make edits.'};
}

function isValidLine(line: string): boolean {
  return (PRODUCT_LINES as readonly string[]).includes(line);
}
function isValidCategory(c: string): boolean {
  return (POS_CATEGORIES as readonly string[]).includes(c);
}
function isValidSubcategory(s: string): boolean {
  return (POS_SUBCATEGORIES as readonly string[]).includes(s);
}

/**
 * Create a product (Coop-only). Seeds its price via the reprice RPC and its
 * opening stock via the receive_lot RPC when given.
 */
export async function createProductAction(input: {
  product_id: string;
  name: string;
  product_line?: string | null;
  category?: string | null;
  subcategory?: string | null;
  emoji?: string;
  price?: string;
  stock?: string;
}): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();

  const product_id = input.product_id.trim();
  const name = input.name.trim();
  if (!product_id) return {ok: false, error: 'SKU Code is required.'};
  if (!name) return {ok: false, error: 'Name is required.'};

  const line = input.product_line?.trim() || null;
  if (line && !isValidLine(line)) return {ok: false, error: `Line must be one of ${PRODUCT_LINES.join(', ')}.`};

  const category = input.category?.trim() || null;
  if (category && !isValidCategory(category)) return {ok: false, error: 'Invalid category.'};
  const subcategory = input.subcategory?.trim() || null;
  if (subcategory && !isValidSubcategory(subcategory)) return {ok: false, error: 'Invalid subcategory.'};

  // Emoji is optional on create; when given it must be 1-3 chars. Empty -> null
  // so the POS uses its default tile emoji.
  let emoji: string | null = null;
  if (input.emoji && input.emoji.trim()) {
    const parsed = parseEmoji(input.emoji);
    if ('error' in parsed) return {ok: false, error: parsed.error};
    emoji = parsed.value;
  }

  let price: number | null = null;
  if (input.price && input.price.trim()) {
    const parsed = parsePrice(input.price);
    if ('error' in parsed) return {ok: false, error: parsed.error};
    price = parsed.value;
  }

  const parsedQty = parseQty(input.stock ?? '');
  if ('error' in parsedQty) return {ok: false, error: parsedQty.error};
  const stock = parsedQty.value;

  const supabase = posClient();
  const {error} = await supabase.from('pos_products').insert({product_id, name, product_line: line, category, subcategory, emoji, active: true});
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

  if (stock > 0) {
    const {error: lotErr} = await supabase.rpc('receive_lot', {
      p_product_id: product_id,
      p_expires_on: null,
      p_qty: stock,
      p_lot_code: 'opening',
    });
    if (lotErr) return {ok: false, error: `Product created, but stock failed: ${lotErr.message}`};
  }

  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Set a product's total on-hand stock to an absolute quantity (set_product_stock RPC). */
export async function setStockAction(product_id: string, qty: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const parsed = parseQty(qty);
  if ('error' in parsed) return {ok: false, error: parsed.error};

  const {error} = await posClient().rpc('set_product_stock', {
    p_product_id: product_id,
    p_new_qty: parsed.value,
    p_by: await actor(),
  });
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${product_id}`);
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Set a product's tile emoji (1-3 chars; a direct column update, no RPC). */
export async function setEmojiAction(product_id: string, emoji: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const parsed = parseEmoji(emoji);
  if ('error' in parsed) return {ok: false, error: parsed.error};

  const {error} = await posClient()
    .from('pos_products')
    .update({emoji: parsed.value, updated_at: new Date().toISOString()})
    .eq('product_id', product_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Set a product's line (a direct column update; product_line has no RPC). */
export async function setLineAction(product_id: string, line: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const trimmed = line.trim();
  if (trimmed && !isValidLine(trimmed)) return {ok: false, error: `Line must be one of ${PRODUCT_LINES.join(', ')}.`};

  const {error} = await posClient()
    .from('pos_products')
    .update({product_line: trimmed || null, updated_at: new Date().toISOString()})
    .eq('product_id', product_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/**
 * Set a product's POS category (+ subcategory). Direct column update — this is
 * the tab the POS shows. Subcategory only applies to Freeze Dried; it's cleared
 * for any other category so a stale subcategory can't linger.
 */
export async function setCategoryAction(product_id: string, category: string, subcategory: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const cat = category.trim();
  if (cat && !isValidCategory(cat)) return {ok: false, error: 'Invalid category.'};
  let sub = subcategory.trim();
  if (cat !== 'Freeze Dried') sub = '';
  if (sub && !isValidSubcategory(sub)) return {ok: false, error: 'Invalid subcategory.'};

  const {error} = await posClient()
    .from('pos_products')
    .update({category: cat || null, subcategory: sub || null, updated_at: new Date().toISOString()})
    .eq('product_id', product_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
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
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
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
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
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
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

// ── Bundles ────────────────────────────────────────────────────────────────
// Bundles are created on the POS; Coop co-edits them. These are direct column
// updates / deletes on pos_bundles (service role) — the POS mirrors pos_bundles
// on its next catalog pull, so edits propagate to every device. Bundle creation
// stays in the POS (the Buy-Any-N builder).

/** Set a bundle's tile emoji (1-3 chars). */
export async function setBundleEmojiAction(bundle_id: string, emoji: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const parsed = parseEmoji(emoji);
  if ('error' in parsed) return {ok: false, error: parsed.error};

  const {error} = await posClient()
    .from('pos_bundles')
    .update({emoji: parsed.value, updated_at: new Date().toISOString()})
    .eq('bundle_id', bundle_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** List / unlist a bundle (hides it from the POS Bundles pill). */
export async function setBundleActiveAction(bundle_id: string, active: boolean): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const {error} = await posClient()
    .from('pos_bundles')
    .update({active, updated_at: new Date().toISOString()})
    .eq('bundle_id', bundle_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Rename a bundle. */
export async function renameBundleAction(bundle_id: string, name: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const trimmed = name.trim();
  if (!trimmed) return {ok: false, error: 'Name is required.'};
  const {error} = await posClient()
    .from('pos_bundles')
    .update({name: trimmed, updated_at: new Date().toISOString()})
    .eq('bundle_id', bundle_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Reprice a bundle. */
export async function repriceBundleAction(bundle_id: string, price: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const parsed = parsePrice(price);
  if ('error' in parsed) return {ok: false, error: parsed.error};
  const {error} = await posClient()
    .from('pos_bundles')
    .update({price: parsed.value, updated_at: new Date().toISOString()})
    .eq('bundle_id', bundle_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/** Delete a bundle (and its items) via the shared RPC, so the POS drops it too. */
export async function deleteBundleAction(bundle_id: string): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const {error} = await posClient().rpc('delete_pos_bundle', {p_bundle_id: bundle_id});
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

/**
 * Edit a Buy-Any-N bundle's scope: the pick count and which product lines qualify.
 * Direct column update on pos_bundles (line_categories is jsonb), same path as the
 * other co-edits; the POS mirrors it on its next catalog pull.
 */
export async function setBundleScopeAction(bundle_id: string, pickCount: number, lineCategories: string[]): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  if (!(pickCount >= 1)) return {ok: false, error: 'Pick count must be at least 1.'};
  if (lineCategories.length === 0) return {ok: false, error: 'Choose at least one eligible line.'};
  const {error} = await posClient()
    .from('pos_bundles')
    .update({pick_count: pickCount, line_categories: lineCategories, updated_at: new Date().toISOString()})
    .eq('bundle_id', bundle_id);
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}

export interface NewBundleInput {
  name: string;
  emoji?: string;
  price: string;
  pickCount: number;
  lineCategories: string[];
}

/**
 * Create a "Buy Any N" bundle from Coop, through the shared apply_pos_bundle RPC
 * (the same write path the POS uses). Coop mints the bundle_id; the POS picks it up
 * on its next catalog pull, so it lands on every device. Buy-Any-N only for now:
 * pick_count + eligible lines, no fixed item list.
 */
export async function createBundleAction(input: NewBundleInput): Promise<ActionResult> {
  if (usingPosMock()) return mockBlocked();
  const name = input.name.trim();
  if (!name) return {ok: false, error: 'Give the bundle a name.'};
  const parsed = parsePrice(input.price);
  if ('error' in parsed) return {ok: false, error: parsed.error};
  if (!(input.pickCount >= 1)) return {ok: false, error: 'Pick count must be at least 1.'};
  if (input.lineCategories.length === 0) return {ok: false, error: 'Choose at least one eligible line.'};
  const emoji = input.emoji ? parseEmoji(input.emoji) : {value: null as string | null};
  if ('error' in emoji) return {ok: false, error: emoji.error};

  const {error} = await posClient().rpc('apply_pos_bundle', {
    p_bundle: {
      bundle_id: crypto.randomUUID(),
      name,
      price: parsed.value,
      active: true,
      bundle_type: 'pick',
      pick_count: input.pickCount,
      line_categories: input.lineCategories,
      emoji: emoji.value,
    },
    p_items: [],
  });
  if (error) return {ok: false, error: error.message};
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
  return {ok: true};
}
