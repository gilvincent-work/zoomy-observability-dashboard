'use server';

import {randomUUID} from 'node:crypto';
import {revalidatePath, revalidateTag} from 'next/cache';
import {POS_TAGS} from './pos-cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';

// Server actions for the spin-a-wheel free ITEM (prize) attached to an order, via
// the SECURITY DEFINER add_order_prize / void_order_prize RPCs. A prize deducts the
// Event pool (reason='free_item') separate from sales. This is the Coop backfill
// path (attach a prize to a past order); the POS tags prizes live in the cart.

async function actor(): Promise<string> {
  try {
    const session = await auth();
    return session?.user?.email ?? 'coop';
  } catch {
    return 'coop';
  }
}

function revalidatePrizeSurfaces() {
  revalidatePath('/offline-sales');
  revalidatePath('/inventory');
  revalidateTag(POS_TAGS.catalog, 'max');
}

type AddResult = {ok: true; oversold: boolean} | {ok: false; error: string};

export async function addPrizeAction(input: {
  orderClientUuid: string;
  sku: string;
  qty: number;
  note?: string;
}): Promise<AddResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to add a prize.'};
  }
  if (!input.orderClientUuid) return {ok: false, error: 'Pick the order that won the prize.'};
  if (!input.sku) return {ok: false, error: 'Pick a product.'};
  const qty = Math.round(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return {ok: false, error: 'Enter a quantity greater than zero.'};

  const {data, error} = await posClient().rpc('add_order_prize', {
    p: {
      client_uuid: randomUUID(),
      order_client_uuid: input.orderClientUuid,
      product_id: input.sku,
      qty,
      note: input.note?.trim() || null,
      created_by: await actor(),
      device_id: 'coop-dashboard',
    },
  });
  if (error) return {ok: false, error: error.message};

  revalidatePrizeSurfaces();
  return {ok: true, oversold: Boolean((data as {oversold?: boolean} | null)?.oversold)};
}

type VoidResult = {ok: true} | {ok: false; error: string};

export async function voidPrizeAction(clientUuid: string): Promise<VoidResult> {
  if (usingPosMock()) return {ok: false, error: 'Running in demo mode.'};
  if (!clientUuid) return {ok: false, error: 'Missing prize reference.'};
  const {data, error} = await posClient().rpc('void_order_prize', {p_client_uuid: clientUuid});
  if (error) return {ok: false, error: error.message};
  if (!(data as {ok?: boolean} | null)?.ok) return {ok: false, error: 'Could not undo that prize.'};
  revalidatePrizeSurfaces();
  return {ok: true};
}
