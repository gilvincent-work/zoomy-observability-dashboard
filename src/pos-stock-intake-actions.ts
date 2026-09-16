'use server';

import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';
import type {ActionResult} from './pos-actions';

// Server actions for adding stock (batch, all-or-nothing) and undoing the most
// recent add (void-last-add). Both go through SECURITY DEFINER RPCs that stamp
// the signed-in Coop user (Q18/Q20/Q22). Online-only, mirrors the other pos_*
// actions. On success the forecast + history + product stock all revalidate.

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
  revalidatePath('/products');
  revalidatePath('/offline-sales');
}

export interface StockLine {
  sku: string;
  qty: number;
}

type AddResult = {ok: true; count: number} | {ok: false; error: string};

/** Add stock for several products in one transaction (all-or-nothing). */
export async function addStockAction(lines: StockLine[]): Promise<AddResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to add stock.'};
  }
  const clean = lines
    .filter((l) => l.sku && Number.isFinite(l.qty) && l.qty > 0)
    .map((l) => ({sku: l.sku, qty: Math.round(l.qty)}));
  if (clean.length === 0) return {ok: false, error: 'Add at least one product with a quantity.'};

  const {data, error} = await posClient().rpc('add_pos_stock', {p_lines: clean, p_by: await actor()});
  if (error) return {ok: false, error: error.message};

  revalidateStockSurfaces();
  return {ok: true, count: Number(data ?? clean.length)};
}

/** Reverse the most recent add for a product; posts an offsetting ledger row. */
export async function voidLastAddAction(sku: string): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to undo an add.'};
  }
  if (!sku) return {ok: false, error: 'No product to undo.'};

  const {data, error} = await posClient().rpc('void_last_stock_add', {p_product_id: sku, p_by: await actor()});
  if (error) return {ok: false, error: error.message};
  if (Number(data ?? 0) <= 0) return {ok: false, error: 'Nothing to undo — that stock has already sold through.'};

  revalidateStockSurfaces();
  return {ok: true};
}
