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

/**
 * Pure: is this a postgres:// or postgresql:// URL whose host is exactly 127.0.0.1 or localhost (optional :port)?
 * Userinfo is allowed (a Postgres URL carries `user:password@`), but the driver (postgres.js) takes the host from the text after the
 * FIRST '@' of the authority while WHATWG URL takes it after the LAST one, and the driver also honours `host1,host2` lists. So the
 * text after the first '@' must itself be exactly the local host, and the two parsers must agree. A query string may not set a host.
 */
export function isLocalPostgresUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  const raw = url.trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return false;
  const afterScheme = raw.slice(raw.indexOf('://') + 3);
  const authority = afterScheme.split(/[?/#]/)[0];
  const hostPart = authority.slice(authority.indexOf('@') + 1);
  if (!/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/i.test(hostPart)) return false; // `a@b@127.0.0.1`, `127.0.0.1,evil.com`, `evil.com\@127.0.0.1`, IPv6, any hosted name
  if (!LOCAL_HOSTS.includes(u.hostname.toLowerCase())) return false;
  for (const k of u.searchParams.keys()) if (/^(host|hostaddr|path|service)$/i.test(k)) return false;
  return true;
}

/** Throws unless the Postgres URL is the local stack. Call it before opening any Postgres connection (the URL can carry a password and is never echoed). */
export function assertLocalPostgres(url) {
  if (!isLocalPostgresUrl(url)) {
    throw new Error('refusing to run: the Postgres URL is missing or is not a local host (only postgres://...@127.0.0.1 or @localhost is allowed; a hosted database, PROD above all, is never used by a test or a script)');
  }
}
