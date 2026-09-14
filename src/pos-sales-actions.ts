'use server';

import {revalidatePath} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import type {ActionResult} from './pos-actions';

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
  return {ok: true};
}

/** One edited product line: a catalog SKU, a qty, and a unit price. */
export type EditOrderLine = {product_id: string; qty: number; unit_price: number};

/**
 * Edit a POS sale from Coop in place, via the shared edit_pos_order RPC. It
 * reverses the order's inventory then re-applies the new item set, and updates
 * the payment method / IG handle / items — recomputing the total server-side, so
 * stock, revenue-by-method, and the KPIs all stay consistent. Rejects a voided
 * order. Online-only.
 */
export async function editOrderAction(
  clientUuid: string,
  patch: {payment_method?: string; customer_handle?: string | null},
  lines: EditOrderLine[],
): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to edit.'};
  }
  if (!clientUuid) return {ok: false, error: 'Missing order reference.'};
  const clean = lines.filter((l) => l.product_id && l.qty > 0);
  if (clean.length === 0) return {ok: false, error: 'An order needs at least one item.'};

  const p_items = clean.map((l) => ({
    product_id: l.product_id,
    qty: l.qty,
    unit_price: l.unit_price,
    line_total: Math.round(l.qty * l.unit_price * 100) / 100,
  }));
  // Only send handle when it's part of the patch; '' clears it, a value sets it.
  const p_patch: Record<string, string> = {};
  if (patch.payment_method) p_patch.payment_method = patch.payment_method;
  if (patch.customer_handle !== undefined) p_patch.customer_handle = patch.customer_handle ?? '';

  const {data, error} = await posClient().rpc('edit_pos_order', {
    p_client_uuid: clientUuid,
    p_patch,
    p_items,
  });
  if (error) return {ok: false, error: error.message};
  if (data && (data as {ok?: boolean}).ok === false) {
    return {ok: false, error: (data as {error?: string}).error ?? 'Edit failed.'};
  }

  revalidatePath('/offline-sales/orders');
  revalidatePath('/offline-sales');
  return {ok: true};
}
