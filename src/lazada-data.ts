import 'server-only';
import {cache} from 'react';
import {unstable_cache} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {LAZADA_CACHE_REVALIDATE, LAZADA_TAG} from './lazada-cache';
import {classifySupabaseError} from './lazada-export';
import type {LazadaOrderItem, LazadaUpload} from './lazada-types';

/**
 * Lazada Seller-Center order items (`lazada_orders`), one row per order ITEM.
 *
 * Migrated from the storefront admin, which kept these in the STOREFRONT
 * Supabase project; they now live in the shared archive project alongside the
 * pos_* tables, so Coop owns both the upload and the read. Table DDL:
 * supabase/lazada_orders.sql (plus lazada_uploads.sql for the import ledger).
 *
 * Real customer data — names, phone numbers, cities — so this is read with the
 * service-role key, server-side only. The table's RLS has no policies, which
 * makes it unreachable by the anon key at all.
 *
 * The customer rollup is NOT materialised: the page collapses items by phone at
 * read time (src/lazada-export.ts) so that logic lives in one tested place.
 */

/** A missing table is the normal state of an environment where the SQL has not
 * been run — the page says so rather than erroring. */
export type LazadaRead = {items: LazadaOrderItem[]; missingTable: boolean; configured: boolean};

export const getLazadaItems = cache((): Promise<LazadaRead> =>
  usingPosMock()
    ? Promise.resolve({items: [], missingTable: false, configured: false})
    : lazadaItemsCached(),
);

const lazadaItemsCached = unstable_cache(
  async (): Promise<LazadaRead> => {
    const supabase = posClient();
    const {data, error} = await supabase
      .from('lazada_orders')
      .select('*')
      .order('ordered_at', {ascending: false})
      .limit(50000);

    if (error) {
      const {kind, message} = classifySupabaseError(error);
      if (kind === 'missing-table') {
        return {items: [], missingTable: true, configured: true};
      }
      // Fail soft: an unreachable table must not take down a page that also
      // carries setup instructions explaining how to create it.
      console.warn(`lazada_orders read failed: ${message}`);
      return {items: [], missingTable: false, configured: true};
    }
    return {items: (data ?? []) as LazadaOrderItem[], missingTable: false, configured: true};
  },
  ['lazada-orders'],
  {revalidate: LAZADA_CACHE_REVALIDATE, tags: [LAZADA_TAG]},
);

/**
 * The most recent import's counts. Optional by design — the page omits the
 * figures when the ledger table is absent, and the orders themselves are the
 * source of truth for everything else.
 */
export const getLastLazadaUpload = cache((): Promise<LazadaUpload | null> =>
  usingPosMock() ? Promise.resolve(null) : lastUploadCached(),
);

const lastUploadCached = unstable_cache(
  async (): Promise<LazadaUpload | null> => {
    try {
      const supabase = posClient();
      const {data, error} = await supabase
        .from('lazada_uploads')
        .select('*')
        .order('uploaded_at', {ascending: false})
        .limit(1);
      if (error) return null;
      return (data?.[0] as LazadaUpload) ?? null;
    } catch {
      return null;
    }
  },
  ['lazada-last-upload'],
  {revalidate: LAZADA_CACHE_REVALIDATE, tags: [LAZADA_TAG]},
);
