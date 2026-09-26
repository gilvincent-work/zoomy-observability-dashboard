'use server';

import {revalidatePath, revalidateTag} from 'next/cache';
import {POS_TAGS} from './pos-cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';

// Server action for moving stock between locations (Office <-> Event) via the
// SECURITY DEFINER transfer_stock RPC, which draws down the source location FEFO
// and lands it in the matching destination lot, writing paired transfer-out /
// transfer-in ledger rows. Online-only, mirrors the other pos_* actions. The RPC
// refuses to over-transfer, so a shortfall returns its error unchanged.

export type LocationCode = 'office' | 'event';

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

type TransferResult = {ok: true; moved: number} | {ok: false; error: string};

export async function transferStockAction(input: {
  sku: string;
  qty: number;
  from: LocationCode;
  to: LocationCode;
}): Promise<TransferResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to move stock.'};
  }
  if (!input.sku) return {ok: false, error: 'Pick a product to move.'};
  if (input.from === input.to) return {ok: false, error: 'Source and destination must be different.'};

  const qty = Math.round(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return {ok: false, error: 'Enter a quantity greater than zero.'};

  const {data, error} = await posClient().rpc('transfer_stock', {
    p_product_id: input.sku,
    p_qty: qty,
    p_from: input.from,
    p_to: input.to,
    p_by: await actor(),
  });
  if (error) return {ok: false, error: error.message};

  revalidateStockSurfaces();
  const moved = Number((data as {moved?: number} | null)?.moved ?? qty);
  return {ok: true, moved};
}
