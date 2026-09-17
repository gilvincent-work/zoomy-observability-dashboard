'use server';

import {revalidatePath, revalidateTag} from 'next/cache';
import {POS_TAGS} from './pos-cache';
import {posClient, usingPosMock} from './pos-data';
import type {ActionResult} from './pos-actions';
import type {EditEntry} from './pos-sales-types';

/**
 * Void a POS sale from Coop by its client_uuid. Uses the same SECURITY DEFINER
 * void_pos_order RPC the POS uses, which flips the order to 'voided' AND restocks
 * it (reverses the sale's inventory decrements). Idempotent — a re-void is a
 * no-op, so stock is never restored twice. Online-only (no offline queue on the
 * Coop side).
 */
export async function voidOrderAction(clientUuid: string): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to void.'};
  }
  if (!clientUuid) return {ok: false, error: 'Missing order reference.'};

  const {error} = await posClient().rpc('void_pos_order', {p_client_uuid: clientUuid});
  if (error) return {ok: false, error: error.message};

  // The overview KPIs exclude voided sales, so refresh both surfaces.
  revalidatePath('/offline-sales/orders');
  revalidatePath('/offline-sales');
  revalidateTag(POS_TAGS.orders);
  revalidateTag(POS_TAGS.catalog); // a void/edit can restock, changing on-hand
  return {ok: true};
}

/**
 * Unvoid a previously voided POS sale from Coop by its client_uuid (inverse of
 * voidOrderAction). Uses the SECURITY DEFINER unvoid_pos_order RPC, which flips
 * the order back to 'completed' AND re-applies its inventory decrements FEFO.
 * Rejects an order that isn't voided. Online-only.
 */
export async function unvoidOrderAction(clientUuid: string): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to unvoid.'};
  }
  if (!clientUuid) return {ok: false, error: 'Missing order reference.'};

  const {data, error} = await posClient().rpc('unvoid_pos_order', {p_client_uuid: clientUuid});
  if (error) return {ok: false, error: error.message};
  if (data && (data as {ok?: boolean}).ok === false) {
    return {ok: false, error: (data as {error?: string}).error ?? 'Unvoid failed.'};
  }

  // Restores the sale to the KPIs and revenue-by-method, so refresh both surfaces.
  revalidatePath('/offline-sales/orders');
  revalidatePath('/offline-sales');
  revalidateTag(POS_TAGS.orders);
  revalidateTag(POS_TAGS.catalog); // a void/edit can restock, changing on-hand
  return {ok: true};
}

/**
 * Edit a POS sale from Coop in place, via the shared edit_pos_order RPC. It
 * reverses the order's inventory then re-applies the new entry set (individual
 * items + bundle groups), updating payment method / IG handle and recomputing the
 * total server-side, so stock, revenue-by-method, and the KPIs stay consistent.
 * The RPC enforces each bundle's rules (a pick bundle needs exactly its
 * pick_count picks, all from eligible categories) and rejects an invalid or
 * voided order. Online-only.
 */
export async function editOrderAction(
  clientUuid: string,
  patch: {payment_method?: string; customer_handle?: string | null},
  entries: EditEntry[],
): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to edit.'};
  }
  if (!clientUuid) return {ok: false, error: 'Missing order reference.'};

  const p_entries = entries
    .map((e) =>
      e.kind === 'bundle'
        ? {kind: 'bundle', bundle_id: e.bundle_id, price: e.price, picks: e.picks.filter((p) => p.product_id && p.qty > 0)}
        : {kind: 'item', product_id: e.product_id, qty: e.qty, unit_price: e.unit_price},
    )
    // Keep every bundle (a custom bundle has an empty bundle_id, which the RPC
    // stores as a premium line); drop only empty item lines.
    .filter((e) => e.kind === 'bundle' || (!!e.product_id && (e.qty ?? 0) > 0));
  if (p_entries.length === 0) return {ok: false, error: 'An order needs at least one item.'};

  // Only send handle when it's part of the patch; '' clears it, a value sets it.
  const p_patch: Record<string, string> = {};
  if (patch.payment_method) p_patch.payment_method = patch.payment_method;
  if (patch.customer_handle !== undefined) p_patch.customer_handle = patch.customer_handle ?? '';

  const {data, error} = await posClient().rpc('edit_pos_order', {
    p_client_uuid: clientUuid,
    p_patch,
    p_entries,
  });
  if (error) return {ok: false, error: error.message};
  if (data && (data as {ok?: boolean}).ok === false) {
    return {ok: false, error: (data as {error?: string}).error ?? 'Edit failed.'};
  }

  revalidatePath('/offline-sales/orders');
  revalidatePath('/offline-sales');
  revalidateTag(POS_TAGS.orders);
  revalidateTag(POS_TAGS.catalog); // a void/edit can restock, changing on-hand
  return {ok: true};
}
