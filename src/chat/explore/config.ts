// Fail-closed access and limits for Explore mode (spec 3.6). Pure: no env reads of its own (the caller passes `process.env`), no
// logging, never throws. `enabled: true` only if EVERY rule holds; otherwise `enabled: false` with a log-safe reason code (no URL, no email).
import {DEFAULT_EXPLORE_LIMITS, EXPLORE_LIMIT_CEILINGS, EXPLORE_LIMIT_ENV} from './limits';
import {EXPLORE_ROLE, type ExploreAccess, type ExploreEnv, type ExploreLimits, type ExploreOffReason} from './types';

const LOOPBACK = ['127.0.0.1', 'localhost'];

/** An integer in [1, ceiling]; anything else (blank, text, 0, negative, fractional, above the ceiling) is the default. Never throws. */
function knob(raw: string | undefined, def: number, ceiling: number): number {
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw.trim())) return def;
  const n = Number(raw.trim());
  return n >= 1 && n <= ceiling ? n : def;
}

export function loadExploreLimits(env: ExploreEnv): ExploreLimits {
  const out = {...DEFAULT_EXPLORE_LIMITS} as ExploreLimits;
  for (const k of Object.keys(DEFAULT_EXPLORE_LIMITS) as (keyof ExploreLimits)[]) {
    out[k] = knob(env?.[EXPLORE_LIMIT_ENV[k]], DEFAULT_EXPLORE_LIMITS[k], EXPLORE_LIMIT_CEILINGS[k]);
  }
  return out;
}

type ParsedUrl = {ok: true; username: string; hostPart: string; hostname: string} | {ok: false; reason: ExploreOffReason};

/**
 * Parse the way the driver does: the host is the text after the FIRST '@' of the authority (postgres.js), the user comes from the
 * WHATWG parse. The two must agree on the host, a host list is refused, and so is a query that sets the host.
 */
function parseUrl(url: string): ParsedUrl {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return {ok: false, reason: 'url_invalid'};
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return {ok: false, reason: 'url_invalid'};
  const authority = url.slice(url.indexOf('://') + 3).split(/[?/#]/)[0];
  const hostPart = authority.slice(authority.indexOf('@') + 1);
  if (hostPart.includes(',') || hostPart.includes('\\') || hostPart.includes('@')) return {ok: false, reason: 'url_invalid'};
  for (const k of u.searchParams.keys()) if (/^(host|hostaddr|path|service)$/i.test(k)) return {ok: false, reason: 'url_invalid'};
  let username = '';
  try {
    username = decodeURIComponent(u.username);
  } catch {
    return {ok: false, reason: 'url_invalid'};
  }
  return {ok: true, username, hostPart, hostname: u.hostname.toLowerCase()};
}

const csv = (s: string | undefined): string[] =>
  (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function resolveExploreAccess(env: ExploreEnv, email: string | null): ExploreAccess {
  const off = (reason: ExploreOffReason): ExploreAccess => ({enabled: false, reason});
  try {
    const e = env ?? {};
    // 1. exactly "on"; the default and any other value is off
    if (e.EXPLORE_MODE !== 'on') return off('mode_off');
    // 2. a postgres URL for the Explore role (never a service or superuser URL pasted by mistake)
    const raw = typeof e.EXPLORE_DATABASE_URL === 'string' ? e.EXPLORE_DATABASE_URL.trim() : '';
    if (raw === '') return off('url_missing');
    const url = parseUrl(raw);
    if (!url.ok) return off(url.reason);
    if (url.username !== EXPLORE_ROLE && !url.username.startsWith(`${EXPLORE_ROLE}.`)) return off('url_role');
    const production = e.NODE_ENV === 'production';
    if (!production) {
      // 3. dev and tests can never reach a hosted database
      const bare = url.hostPart.replace(/:\d{1,5}$/, '').toLowerCase();
      if (!LOOPBACK.includes(bare) || !LOOPBACK.includes(url.hostname)) return off('url_not_local');
    } else {
      // 4. production needs the read-only chat role (so the registry path is locked too) and a non-empty sign-in allowlist
      if (e.CHAT_READ_MODE !== 'ro_role') return off('not_ro_role');
      if (csv(e.ALLOWED_EMAILS).length === 0) return off('allowed_emails_unset');
    }
    // 5. the signed-in email must be on the Explore list; an empty list is nobody
    const list = csv(e.EXPLORE_ALLOWED_EMAILS);
    if (list.length === 0) return off('list_empty');
    const who = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (who === '' || !list.includes(who)) return off('user_not_allowed');
    return {enabled: true, limits: loadExploreLimits(e), databaseUrl: raw};
  } catch {
    return off('url_invalid');
  }
}
