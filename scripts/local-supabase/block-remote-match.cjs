'use strict';
// Pure hostname matching for block-remote.cjs (kept separate so it can be unit tested without patching anything).
// Blocked: the hosted Supabase domains (*.supabase.co / .in / .net, and the apex of those), every subdomain of supabase.com (which
// includes the connection pooler hosts *.pooler.supabase.com and the management API; the marketing apex supabase.com itself stays
// reachable), and any custom domain listed in the COOP_BLOCK_HOSTS environment variable (comma separated; an entry blocks that host
// and its subdomains). A custom domain in front of a hosted project is invisible to the built-in patterns: this is how it is covered.
const BLOCKED_SUFFIXES = ['.supabase.co', '.supabase.in', '.supabase.net', '.supabase.com'];
const BLOCKED_APEX = ['supabase.co', 'supabase.in', 'supabase.net'];

/** One host the way the matcher compares it: lower case, no brackets, no port, no trailing dot. */
function normalizeHost(host) {
  return String(host).trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

/**
 * The custom domains from COOP_BLOCK_HOSTS (comma separated). Each entry may be written as a bare host, "*.host", ".host", a URL or
 * host:port; empty and unusable entries are dropped. Read at call time so the variable can be set after this module loads.
 */
function customBlockedHosts(env = process.env) {
  const raw = typeof env.COOP_BLOCK_HOSTS === 'string' ? env.COOP_BLOCK_HOSTS : '';
  const out = [];
  for (const part of raw.split(',')) {
    let e = part.trim().toLowerCase();
    if (!e) continue;
    e = e.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^.*@/, ''); // scheme, path, user-info
    e = normalizeHost(e).replace(/^(\*\.|\.)+/, '');
    if (!e || !e.includes('.')) continue; // a bare word such as "localhost" or "com" is never a custom domain
    if (/^127(\.\d+){3}$/.test(e) || e.endsWith('.localhost')) continue; // never block the local stack by a typo
    out.push(e);
  }
  return out;
}

/** True when the hostname is a hosted Supabase domain (or any subdomain of one), or a COOP_BLOCK_HOSTS domain. Case and trailing dot insensitive. */
function isBlockedHost(host) {
  if (typeof host !== 'string') return false;
  const h = normalizeHost(host);
  if (BLOCKED_APEX.includes(h) || BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  return customBlockedHosts().some((d) => h === d || h.endsWith(`.${d}`));
}

/** The hostname a fetch/http argument points at, or '' when it cannot tell. */
function hostOf(arg) {
  try {
    if (typeof arg === 'string') return new URL(arg).hostname;
    if (arg instanceof URL) return arg.hostname;
    if (arg && typeof arg === 'object') {
      if (typeof arg.url === 'string') return new URL(arg.url).hostname; // fetch Request
      if (typeof arg.hostname === 'string') return arg.hostname;
      if (typeof arg.host === 'string') return arg.host;
    }
  } catch {
    /* unparseable: let the real call fail on its own */
  }
  return '';
}

module.exports = {isBlockedHost, hostOf, customBlockedHosts};
