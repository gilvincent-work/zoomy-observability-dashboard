'use strict';
// Pure hostname matching for block-remote.cjs (kept separate so it can be unit tested without patching anything).
const BLOCKED_SUFFIXES = ['.supabase.co', '.supabase.in', '.supabase.net'];
const BLOCKED_APEX = ['supabase.co', 'supabase.in', 'supabase.net'];

/** True when the hostname is a hosted Supabase domain (or any subdomain of one). Case and trailing dot insensitive. */
function isBlockedHost(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return BLOCKED_APEX.includes(h) || BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
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

module.exports = {isBlockedHost, hostOf};
