import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import type {DailyTarget} from './pos-target-types';

// SERVER-ONLY. Reads the owner-set daily revenue target from pos_settings with
// the shared archive service-role key (see src/pos-data.ts). Leave the env unset
// to render the mock target. Throws on a real read error like the other pos_*
// loaders — the pages wrap this fail-soft so a target hiccup only hides the bar.

/** Mock target when the Supabase pos_* env is absent (mirrors the seed default). */
export const MOCK_DAILY_TARGET = 5000;

/** The daily revenue goal. React-cached so a page and its layout don't refetch. */
export const getDailyTarget = cache(async (): Promise<DailyTarget> => {
  noStore(); // an owner's target edit must show immediately, never a stale read
  if (usingPosMock()) return {amount: MOCK_DAILY_TARGET, updated_at: null};

  const {data, error} = await posClient()
    .from('pos_settings')
    .select('value,updated_at')
    .eq('key', 'daily_revenue_target')
    .maybeSingle();
  if (error) throw new Error(`pos_settings read failed: ${error.message}`);

  const raw = (data?.value as {amount?: number} | null)?.amount;
  const amount = Number(raw ?? 0);
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    updated_at: (data?.updated_at as string | null) ?? null,
  };
});
