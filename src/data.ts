import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {DigestArchiveRow} from './types';
import {MOCK_DIGESTS} from './mock';
import {maskRows} from './pii';

// SERVER-ONLY. digest_archive is NOT anon-readable — its `bundle` column holds
// verbatim customer quotes — so the dashboard reads it server-side with the
// observability project's SERVICE-ROLE key. These env vars must stay server-only
// (never NEXT_PUBLIC_) so the key never reaches the browser. The `import
// 'server-only'` above makes the build fail if this module is ever pulled into a
// client component. We select only the rendered `digest` (+ window/timestamps),
// never `bundle` — matching the batch repo's readRecentDigests query.
const url = process.env.SUPABASE_URL_ARCHIVE;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

/** True when the archive env is absent — the dashboard renders mock digests. */
export function usingMock(): boolean {
  return !url || !serviceKey;
}

/**
 * Read archived digests, newest first (server-side, service-role, no `bundle`).
 *
 * PII masking happens HERE, at the single read seam, rather than in each Server
 * Component: masking per-caller makes a leak one forgotten call away. Masking at
 * the source is fail-closed — no unmasked customer name can enter an RSC payload.
 * (There is no auth in front of this app yet; relax once there is.) See src/pii.ts.
 */
export async function getDigests(): Promise<DigestArchiveRow[]> {
  if (usingMock()) return maskRows(MOCK_DIGESTS);
  const supabase = createClient(url as string, serviceKey as string, {auth: {persistSession: false}});
  const {data, error} = await supabase
    .from('digest_archive')
    .select('window_from,window_to,digest,created_at')
    .order('window_to', {ascending: false});
  if (error) throw new Error(`digest_archive read failed: ${error.message}`);
  return maskRows((data ?? []) as unknown as DigestArchiveRow[]);
}
