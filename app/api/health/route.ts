import {createClient} from '@supabase/supabase-js';
import {envForHost} from '@/src/coop-env';

export const dynamic = 'force-dynamic';

// Public health probe for the Manage Environments page (it calls each environment's
// /api/health server-to-server). Returns only: which environment this is, the deployed
// branch + short commit, a MASKED database ref, and whether the database answers.
// No data, no secrets.

const mask = (ref: string) => (ref.length > 8 ? `${ref.slice(0, 4)}…${ref.slice(-4)}` : '••••');

export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const url = process.env.SUPABASE_URL_ARCHIVE;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  const ref = url ? (new URL(url).hostname.split('.')[0] ?? '') : '';

  let dbOk = false;
  if (url && key) {
    try {
      // pagination-ok: count-only head request, returns no rows.
      const res = await createClient(url, key, {auth: {persistSession: false}}).from('companies').select('id', {count: 'exact', head: true});
      dbOk = !res.error;
    } catch {
      dbOk = false;
    }
  }

  return Response.json(
    {
      ok: dbOk,
      env: envForHost(host).key,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      db: ref ? mask(ref) : null,
      dbOk,
      checkedAt: new Date().toISOString(),
    },
    {headers: {'cache-control': 'no-store'}},
  );
}
