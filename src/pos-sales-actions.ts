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
