'use server';

import {revalidatePath} from 'next/cache';
import {auth} from '@/auth';
import {posClient, usingPosMock} from './pos-data';
import type {ActionResult} from './pos-actions';
import {configToJson, planToJson} from './pos-stock-settings';
import type {ForecastConfig, NextEventPlan} from './pos-forecast-compute';

// Server actions for the Stock Forecast config + next-event surge plan. Both go
// through the SECURITY DEFINER upsert RPCs (set_pos_stock_config /
// set_pos_next_event_plan). Any signed-in Coop user may write (Q22); the actor
// email is recorded as p_by. Online-only, mirrors the other pos_* actions.

/** The signed-in Coop user's email, or 'coop' as a fallback. */
async function actor(): Promise<string> {
  try {
    const session = await auth();
    return session?.user?.email ?? 'coop';
  } catch {
    return 'coop';
  }
}

function validConfig(c: ForecastConfig): string | null {
  if (!(c.threshold >= 0)) return 'Threshold must be zero or more.';
  if (!(c.targetCoverEventDays >= 1)) return 'Cover window must be at least 1 event.';
  if (!(c.leadTimeDays >= 0)) return 'Lead time must be zero or more days.';
  if (!(c.earlyWarningEvents >= 0)) return 'Early-warning window must be zero or more.';
  return null;
}

export async function setStockConfigAction(config: ForecastConfig): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to change settings.'};
  }
  const invalid = validConfig(config);
  if (invalid) return {ok: false, error: invalid};

  const {error} = await posClient().rpc('set_pos_stock_config', {p_config: configToJson(config), p_by: await actor()});
  if (error) return {ok: false, error: error.message};

  revalidatePath('/inventory');
  revalidatePath('/offline-sales');
  return {ok: true};
}

export async function setNextEventPlanAction(plan: NextEventPlan): Promise<ActionResult> {
  if (usingPosMock()) {
    return {ok: false, error: 'Running in demo mode — set the Supabase pos_* env to change the plan.'};
  }
  if (!(plan.multiplier > 0)) return {ok: false, error: 'Expected volume must be greater than zero.'};

  const {error} = await posClient().rpc('set_pos_next_event_plan', {p_plan: planToJson(plan), p_by: await actor()});
  if (error) return {ok: false, error: error.message};

  revalidatePath('/inventory');
  revalidatePath('/offline-sales');
  return {ok: true};
}
