import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient} from '@supabase/supabase-js';
import type {LastChangeSummary, RepriceRow, RepriceRun} from './reprice-types';
import {MOCK_LAST_CHANGE, MOCK_REPRICE_RUN} from './reprice-mock';

// SERVER-ONLY, READ-ONLY. Reads the newest run of marketplace_price_changes
// from the archive project with the same service-role posture as
// src/health-data.ts. This dashboard never writes to this table, and never
// holds Shopify or Lazada credentials — those stay with the batch job.
const url = process.env.SUPABASE_URL_ARCHIVE;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

// snake_case row shape as it comes back from Supabase.
interface RawRow {
  id: string;
  run_id: string;
  ran_at: string;
  dry_run: boolean;
  applied: boolean;
  marketplace: string;
  marketplace_sku: string;
  marketplace_title: string;
  reference_price: number | null;
  reference_source: string | null;
  listed_price: number | null;
  special_price: number | null;
  shopify_variant_id: string | null;
  shopify_title: string | null;
  match_score: number | null;
  match_band: RepriceRow['matchBand'];
  target_price: number | null;
  floor_price: number | null;
  old_price: number | null;
  new_price: number | null;
  guardrail: RepriceRow['guardrail'];
  skip_reason: RepriceRow['skipReason'];
}

function toCamel(r: RawRow): RepriceRow {
  return {
    id: r.id,
    runId: r.run_id,
    ranAt: r.ran_at,
    dryRun: r.dry_run,
    applied: r.applied,
    marketplace: r.marketplace,
    marketplaceSku: r.marketplace_sku,
    marketplaceTitle: r.marketplace_title,
    referencePrice: r.reference_price,
    referenceSource: r.reference_source,
    listedPrice: r.listed_price,
    specialPrice: r.special_price,
    shopifyVariantId: r.shopify_variant_id,
    shopifyTitle: r.shopify_title,
    matchScore: r.match_score,
    matchBand: r.match_band,
    targetPrice: r.target_price,
    floorPrice: r.floor_price,
    oldPrice: r.old_price,
    newPrice: r.new_price,
    guardrail: r.guardrail,
    skipReason: r.skip_reason,
  };
}

export const getLatestRepriceRun = cache(async (): Promise<RepriceRun> => {
  noStore();
  if (!url || !serviceKey) return MOCK_REPRICE_RUN;
  const supabase = createClient(url, serviceKey, {auth: {persistSession: false}});

  const {data: latest, error: latestError} = await supabase
    .from('marketplace_price_changes')
    .select('run_id,ran_at,dry_run')
    .order('ran_at', {ascending: false})
    .limit(1);
  if (latestError) throw new Error(`marketplace_price_changes latest-run read failed: ${latestError.message}`);
  const head = latest?.[0];
  if (!head) return MOCK_REPRICE_RUN;

  const {data: rows, error: rowsError} = await supabase
    .from('marketplace_price_changes')
    .select('*')
    .eq('run_id', head.run_id);
  if (rowsError) throw new Error(`marketplace_price_changes row read failed: ${rowsError.message}`);

  return {
    runId: head.run_id as string,
    ranAt: head.ran_at as string,
    dryRun: head.dry_run as boolean,
    rows: ((rows ?? []) as RawRow[]).map(toCamel),
  };
});

// The most recent run that actually applied a price change, and how many
// rows it applied — used to point a viewer at "the interesting run" when the
// latest run was a no-op dry run. Null when no price has ever been applied.
export const getLastChangeSummary = cache(async (): Promise<LastChangeSummary | null> => {
  noStore();
  if (!url || !serviceKey) return MOCK_LAST_CHANGE;
  const supabase = createClient(url, serviceKey, {auth: {persistSession: false}});

  const {data: latestApplied, error: latestError} = await supabase
    .from('marketplace_price_changes')
    .select('run_id,ran_at')
    .eq('applied', true)
    .order('ran_at', {ascending: false})
    .limit(1);
  if (latestError) throw new Error(`marketplace_price_changes last-change read failed: ${latestError.message}`);
  const head = latestApplied?.[0];
  if (!head) return null;

  const {count, error: countError} = await supabase
    .from('marketplace_price_changes')
    .select('id', {count: 'exact', head: true})
    .eq('run_id', head.run_id)
    .eq('applied', true);
  if (countError) throw new Error(`marketplace_price_changes last-change count failed: ${countError.message}`);

  return {ranAt: head.ran_at as string, count: count ?? 0};
});
