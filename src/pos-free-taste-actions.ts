'use server';

import {randomUUID} from 'node:crypto';
import {revalidatePath, revalidateTag} from 'next/cache';
import {POS_TAGS} from './pos-cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';

// Server action for logging a free taste (opened stock for sampling) from Coop,
// via the SECURITY DEFINER record_free_taste RPC. It deducts the Event pool FEFO
// and writes a reason='free_taste' ledger row, separate from sales. Online-only;
// a fresh client_uuid keys idempotency so a double-submit is a safe no-op.

async function actor(): Promise<string> {
  try {
    const session = await auth();
    return session?.user?.email ?? 'coop';
  } catch {
    return 'coop';
  }
}

function revalidateStockSurfaces() {
  revalidatePath('/inventory');
  revalidatePath('/offline-sales');
  revalidateTag(POS_TAGS.catalog, 'max');
}

type FreeTasteResult = {ok: true; oversold: boolean} | {ok: false; error: string};

export async function recordFreeTasteAction(input: {
  sku: string;
  qty: number;
  note?: string;
}): Promise<FreeTasteResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to log a free taste.'};
  }
  if (!input.sku) return {ok: false, error: 'Pick a product.'};
  const qty = Math.round(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return {ok: false, error: 'Enter a quantity greater than zero.'};

  const {data, error} = await posClient().rpc('record_free_taste', {
    p: {
      client_uuid: randomUUID(),
      product_id: input.sku,
      qty,
      note: input.note?.trim() || null,
      created_by: await actor(),
      device_id: 'coop-dashboard',
    },
  });
  if (error) return {ok: false, error: error.message};

  revalidateStockSurfaces();
  return {ok: true, oversold: Boolean((data as {oversold?: boolean} | null)?.oversold)};
}

type VoidResult = {ok: true} | {ok: false; error: string};

/** Revert a logged free taste (restores the Event stock it deducted). */
export async function voidFreeTasteAction(clientUuid: string): Promise<VoidResult> {
  if (usingPosMock()) return {ok: false, error: 'Running in demo mode.'};
  if (!clientUuid) return {ok: false, error: 'Missing free-taste reference.'};
  const {data, error} = await posClient().rpc('void_free_taste', {p_client_uuid: clientUuid});
  if (error) return {ok: false, error: error.message};
  if (!(data as {ok?: boolean} | null)?.ok) return {ok: false, error: 'Could not undo that free taste.'};
  revalidateStockSurfaces();
  return {ok: true};
}
