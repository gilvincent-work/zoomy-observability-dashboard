import 'server-only';
import {cache} from 'react';
import {unstable_cache} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {POS_CACHE_REVALIDATE} from './pos-cache';
import type {SpinLead} from './spin-leads-types';

/**
 * Spin-the-wheel booth leads (spin_wheel_leads). The storefront admin
 * (zoomyforpets.com/admin/spin-wheel) writes these to the STOREFRONT Supabase
 * project, which Coop has no credentials for — finished events are imported
 * into the shared archive project with scripts/import-spin-leads.mjs from the
 * admin's CSV export. Table DDL: supabase/spin_wheel_leads.sql.
 *
 * Contact data, so this is read with the service-role key server-side only
 * (the table's RLS has no policies — the anon key sees nothing).
 * ponytail: import-on-demand; wire the storefront project if leads must be live.
 */
export const getSpinLeads = cache((): Promise<SpinLead[]> =>
  usingPosMock() ? Promise.resolve([]) : spinLeadsCached(),
);

const spinLeadsCached = unstable_cache(async (): Promise<SpinLead[]> => {
  const supabase = posClient();
  const {data, error} = await supabase
    .from('spin_wheel_leads')
    .select('email,mobile,prize,campaign,collected_at')
    .order('collected_at', {ascending: false});

  // Fail soft, unlike the pos_* readers. Leads are one optional block at the
  // bottom of the event card, and the table is created per environment by hand
  // (supabase/spin_wheel_leads.sql) — an environment that has not run it yet
  // must still render sales, cash reconciliation and the rest of the page.
  if (error) {
    console.warn(`spin_wheel_leads read failed, rendering events without leads: ${error.message}`);
    return [];
  }

  return (data ?? []).map((l): SpinLead => ({
    email: l.email as string,
    mobile: (l.mobile as string | null) ?? null,
    prize: (l.prize as string | null) ?? 'Unknown',
    campaign: (l.campaign as string | null) ?? null,
    collectedAt: l.collected_at as string,
  }));
}, ['spin-wheel-leads'], {revalidate: POS_CACHE_REVALIDATE});
