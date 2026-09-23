'use server';

import {revalidateTag} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {LAZADA_TAG} from './lazada-cache';
import {buildUploadSummary, classifySupabaseError} from './lazada-export';
import type {LazadaOrderItem, LazadaParseStats} from './lazada-types';

/** Rows per upsert request. Large enough to keep a 600-row export to two round
 * trips, small enough to stay well inside PostgREST's payload limits. */
const CHUNK = 400;

/** A ceiling on one import. A real Seller-Center export is a few hundred rows;
 * anything near this is a mistake worth stopping before it reaches the table. */
const MAX_ITEMS = 20_000;

export type LazadaUploadResult = {ok: true; saved: number} | {ok: false; error: string};

/**
 * Save a parsed Lazada export.
 *
 * The browser does the spreadsheet work (src/lazada-export-client.ts) and posts
 * normalised rows; this writes them. Upserting on `order_item_id` is what makes
 * re-uploading the same export, or two exports with overlapping date windows,
 * converge on the same rows instead of double-counting orders.
 */
export async function uploadLazadaItems(
  items: LazadaOrderItem[],
  stats: LazadaParseStats,
  fileName?: string,
): Promise<LazadaUploadResult> {
  if (usingPosMock()) return {ok: false, error: 'Supabase is not configured for this environment.'};
  if (!Array.isArray(items) || !items.length) return {ok: false, error: 'That export had no usable rows.'};
  if (items.length > MAX_ITEMS) {
    return {
      ok: false,
      error: `That file has ${items.length} rows — more than this page accepts at once (${MAX_ITEMS}).`,
    };
  }

  const supabase = posClient();
  for (let i = 0; i < items.length; i += CHUNK) {
    const {error} = await supabase
      .from('lazada_orders')
      .upsert(items.slice(i, i + CHUNK), {onConflict: 'order_item_id'});
    if (error) {
      const {kind, message} = classifySupabaseError(error);
      console.error(`lazada_orders upsert failed: ${message}`);
      if (kind === 'missing-table') {
        return {
          ok: false,
          error:
            'The lazada_orders table does not exist yet — run supabase/lazada_orders.sql in the Supabase SQL editor, then try again.',
        };
      }
      return {ok: false, error: `Could not save the upload: ${message}`};
    }
  }

  // Counts only, and best-effort: the orders are already saved, so a missing
  // ledger table must not report a successful import as failed.
  const {error: ledgerError} = await supabase
    .from('lazada_uploads')
    .insert([buildUploadSummary(items, stats, fileName)]);
  if (ledgerError && classifySupabaseError(ledgerError).kind !== 'missing-table') {
    console.warn(`lazada_uploads write failed: ${ledgerError.message}`);
  }

  revalidateTag(LAZADA_TAG);
  return {ok: true, saved: items.length};
}
