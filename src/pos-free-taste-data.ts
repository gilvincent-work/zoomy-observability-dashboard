import 'server-only';
import {cache} from 'react';
import {unstable_cache} from 'next/cache';
import {posClient, usingPosMock, getPosProducts} from './pos-data';
import {POS_TAGS, POS_CACHE_REVALIDATE} from './pos-cache';

// SERVER-ONLY. Sampling summary: how much stock went to free tastes (opened for
// pets to sample), by product, over a trailing window. Reads the pos_free_tastes
// entity directly (voided rows excluded). Sold-vs-sampled ratio is a later add.

const WINDOW_DAYS = 30;

export interface SampledProduct {
  product_id: string;
  name: string;
  units: number;
  count: number;
}

export interface RecentFreeTaste {
  client_uuid: string | null;
  product_name: string;
  qty: number;
  oversold: boolean;
  opened_at: string;
}

export interface FreeTasteSummary {
  windowDays: number;
  totalUnits: number;
  totalCount: number;
  oversoldCount: number;
  byProduct: SampledProduct[]; // sorted by units desc
  recent: RecentFreeTaste[]; // newest first, for the undo list
}

const EMPTY: FreeTasteSummary = {windowDays: WINDOW_DAYS, totalUnits: 0, totalCount: 0, oversoldCount: 0, byProduct: [], recent: []};

export const getFreeTasteSummary = cache((now: Date = new Date()): Promise<FreeTasteSummary> =>
  usingPosMock() ? Promise.resolve(EMPTY) : freeTasteSummaryCached(new Date(now.getTime() - WINDOW_DAYS * 86400_000).toISOString()),
);

const freeTasteSummaryCached = unstable_cache(async (sinceIso: string): Promise<FreeTasteSummary> => {
  const [{data, error}, products] = await Promise.all([
    posClient()
      .from('pos_free_tastes')
      .select('client_uuid,product_id,qty,oversold,opened_at')
      .is('voided_at', null)
      .gte('opened_at', sinceIso)
      .order('opened_at', {ascending: false}),
    getPosProducts(),
  ]);
  if (error) throw new Error(`pos_free_tastes read failed: ${error.message}`);

  const nameById = new Map(products.map((p) => [p.product_id, p.name]));
  const agg = new Map<string, {units: number; count: number}>();
  let totalUnits = 0;
  let oversoldCount = 0;
  for (const r of data ?? []) {
    const id = r.product_id as string;
    const qty = Number(r.qty ?? 0);
    const cur = agg.get(id) ?? {units: 0, count: 0};
    cur.units += qty;
    cur.count += 1;
    agg.set(id, cur);
    totalUnits += qty;
    if (r.oversold) oversoldCount += 1;
  }

  const byProduct = [...agg.entries()]
    .map(([product_id, v]) => ({product_id, name: nameById.get(product_id) ?? product_id, units: v.units, count: v.count}))
    .sort((a, b) => b.units - a.units);

  const recent: RecentFreeTaste[] = (data ?? []).slice(0, 15).map((r) => ({
    client_uuid: (r.client_uuid as string | null) ?? null,
    product_name: nameById.get(r.product_id as string) ?? (r.product_id as string),
    qty: Number(r.qty ?? 0),
    oversold: Boolean(r.oversold),
    opened_at: r.opened_at as string,
  }));

  return {windowDays: WINDOW_DAYS, totalUnits, totalCount: (data ?? []).length, oversoldCount, byProduct, recent};
}, ['pos-free-taste-summary'], {tags: [POS_TAGS.catalog], revalidate: POS_CACHE_REVALIDATE});
