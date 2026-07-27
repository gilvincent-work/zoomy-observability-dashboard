import {createClient} from '@supabase/supabase-js';
import type {DigestArchiveRow} from './types';
import {MOCK_DIGESTS} from './mock';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when Supabase env is absent — the dashboard renders mock digests. */
export function usingMock(): boolean {
  return !url || !anon;
}

/**
 * Read archived digests, newest first. Uses the Supabase ANON key + RLS — never
 * the service-role key (that is server-only, in the batch job). Falls back to
 * mock fixtures when env is unset so the app runs with no database.
 */
export async function getDigests(): Promise<DigestArchiveRow[]> {
  if (usingMock()) return MOCK_DIGESTS;
  const supabase = createClient(url as string, anon as string);
  const {data, error} = await supabase
    .from('digest_archive')
    .select('window_from,window_to,digest,created_at,emailed_at')
    .order('window_from', {ascending: false});
  if (error) throw new Error(`digest_archive read failed: ${error.message}`);
  return (data ?? []) as unknown as DigestArchiveRow[];
}
