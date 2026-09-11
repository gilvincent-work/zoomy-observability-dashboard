'use server';

import {revalidatePath} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import type {ActionResult} from './pos-actions';

const ACTOR = 'coop';

/**
 * Set the daily revenue target from Coop, through the SECURITY DEFINER
 * set_pos_daily_target RPC (the only write path into pos_settings). Online-only,
 * mirrors the other pos_* server actions. Revalidates both surfaces the bar
 * appears on so the new goal shows immediately.
 */
export async function setDailyTargetAction(amount: number): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in mock mode — set the Supabase pos_* env to change the target.'};
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return {ok: false, error: 'Enter a valid target amount.'};
  }

  const {error} = await posClient().rpc('set_pos_daily_target', {p_amount: amount, p_by: ACTOR});
  if (error) return {ok: false, error: error.message};

  revalidatePath('/offline-sales');
  revalidatePath('/');
  return {ok: true};
}
