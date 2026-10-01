// The ONE local-only guard for everything that can connect to a Supabase project from a test or a script (owner rule: the
// project in .env is PRODUCTION; only the throwaway local stack from scripts/local-supabase/ may be read by a harness).
// Plain JS so the .mjs scripts and the TypeScript tests share one implementation; test/support/local-only.ts re-exports it.
// The error text never contains the URL (it can carry a key or a project ref).
export const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

/** Pure: is this URL a plain http(s) URL whose host (as the WHATWG parser resolves it) is 127.0.0.1 or localhost, with no userinfo? */
export function isLocalSupabaseUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username !== '' || u.password !== '') return false; // `http://127.0.0.1@evil.example` style tricks are never accepted
  return LOCAL_HOSTS.includes(u.hostname); // `127.0.0.1.evil.com`, `[::1]`, `localhost.` and any hosted name fail here
}

/** Throws unless the URL is the local stack. Call it before building any Supabase client or sending any request. */
export function assertLocalSupabase(url) {
  if (!isLocalSupabaseUrl(url)) {
    throw new Error('refusing to run: the Supabase URL is missing or is not a local host (only http://127.0.0.1 or http://localhost, no userinfo, is allowed; a hosted project, PROD above all, is never used by a test or a script)');
  }
}
