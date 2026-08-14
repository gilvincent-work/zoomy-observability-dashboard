import 'server-only';
import {cache} from 'react';
import {unstable_noStore as noStore} from 'next/cache';
import {createClient} from '@supabase/supabase-js';
import type {BusinessHealthSnapshot} from './health-types';
import {MOCK_HEALTH} from './health-mock';

// SERVER-ONLY. Reads the newest business_health snapshot with the archive
// project's service-role key (same posture as src/data.ts). The snapshot is
// aggregate-only (no PII), but we keep the service-role read for consistency.
const url = process.env.SUPABASE_URL_ARCHIVE;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

export const getBusinessHealth = cache(async (): Promise<BusinessHealthSnapshot> => {
  noStore();
  if (!url || !serviceKey) return MOCK_HEALTH;
  const supabase = createClient(url, serviceKey, {auth: {persistSession: false}});
  const {data, error} = await supabase
    .from('business_health')
    .select('snapshot,window_to')
    .order('window_to', {ascending: false})
    .limit(1);
  if (error) throw new Error(`business_health read failed: ${error.message}`);
  return (data?.[0]?.snapshot as BusinessHealthSnapshot) ?? MOCK_HEALTH;
});
