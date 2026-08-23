import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient} from '@supabase/supabase-js';
import type {RepricedVariant, RepriceRow, RepriceRun} from './reprice-types';
import {discountPct} from './reprice-labels';
import {MOCK_REPRICE_RUN, MOCK_REPRICED_VARIANTS} from './reprice-mock';

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

// Every distinct Shopify variant the repricer has ever applied a price to —
// the most recent applied row for that variant, newest-first. This is the
// "state of the store" the page leads with, as distinct from "what the
// latest run did." Empty array when nothing has ever been applied.
export const getRepricedVariants = cache(async (): Promise<RepricedVariant[]> => {
  noStore();
  if (!url || !serviceKey) return MOCK_REPRICED_VARIANTS;
  const supabase = createClient(url, serviceKey, {auth: {persistSession: false}});

  const {data, error} = await supabase
    .from('marketplace_price_changes')
    .select('*')
    .eq('applied', true)
    .not('shopify_variant_id', 'is', null)
    .order('ran_at', {ascending: false});
  if (error) throw new Error(`marketplace_price_changes applied read failed: ${error.message}`);

  const seen = new Set<string>();
  const result: RepricedVariant[] = [];
  for (const raw of (data ?? []) as RawRow[]) {
    const variantId = raw.shopify_variant_id;
    if (!variantId || seen.has(variantId)) continue;
    seen.add(variantId);
    const row = toCamel(raw);
    result.push({
      shopifyVariantId: variantId,
      shopifyTitle: row.shopifyTitle,
      marketplaceTitle: row.marketplaceTitle,
      marketplaceSku: row.marketplaceSku,
      referencePrice: row.referencePrice,
      newPrice: row.newPrice,
      discountPct: discountPct(row),
      ranAt: row.ranAt,
    });
  }
  return result;
});
