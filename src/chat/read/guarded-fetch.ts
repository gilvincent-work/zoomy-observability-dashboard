import {FORBIDDEN_COLUMNS} from './relations';

// Layer 4 of the read-only enforcement (knowledge/best-practices/chat-read-only.md).
// A custom `global.fetch` for the chat's supabase-js client. Pure: no
// supabase-js import, no server-only. Every rule throws BEFORE the underlying
// fetch is called, counts the attempt and calls `onTrip`.

export interface GuardBlock {
  reason: string;
  method: string;
  path: string;
}

export interface GuardStats {
  /** Requests blocked for any reason other than a read verb being fine. */
  attemptedNonRead: number;
  allowed: number;
  blocked: GuardBlock[];
}

export interface GuardedFetchOptions {
  baseUrl: string;
  /** Relation names that may be read (see relationsForMode). */
  relations: readonly string[];
  underlying: typeof fetch;
  onTrip?: (block: GuardBlock) => void;
}

const READ_METHODS = new Set(['GET', 'HEAD']);
const RELATION_PATH = /^\/rest\/v1\/([a-z0-9_]+)$/;
const DENIED_PREFIXES = ['/rest/v1/rpc', '/storage', '/auth', '/functions', '/graphql'];
const FORBIDDEN = new Set(FORBIDDEN_COLUMNS.map((c) => c.toLowerCase()));
// Filter params whose VALUE can name columns.
const COLUMN_VALUE_PARAMS = new Set(['or', 'and', 'not', 'order', 'columns']);

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
const forbiddenIn = (s: string): string | undefined => words(s).find((w) => FORBIDDEN.has(w));

function rawOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

export function createGuardedFetch(opts: GuardedFetchOptions): {fetch: typeof fetch; stats: GuardStats} {
  const baseOrigin = new URL(opts.baseUrl).origin;
  const allowed = new Set(opts.relations);
  const stats: GuardStats = {attemptedNonRead: 0, allowed: 0, blocked: []};

  function violation(raw: string, method: string): string | null {
    if (!READ_METHODS.has(method)) return `method ${method} is not allowed (GET/HEAD only)`;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return 'unparseable URL';
    }
    if (url.origin !== baseOrigin) return `host ${url.origin} is not the project host`;
    if (raw.includes('#')) return 'fragment in URL';

    // Judge the RAW path: WHATWG URL parsing silently resolves `..` / `%2e%2e`.
    const afterOrigin = raw.slice(raw.indexOf('//') + 2);
    const slash = afterOrigin.indexOf('/');
    const rawPath = slash === -1 ? '' : afterOrigin.slice(slash).split('?')[0];
    const lower = rawPath.toLowerCase();
    if (DENIED_PREFIXES.some((p) => lower === p || lower.startsWith(`${p}/`))) return `path ${rawPath} is denied`;
    // The raw path and the parsed path must agree. A mismatch means the URL parser and this
    // guard read the URL differently (backslashes, control characters), so refuse it.
    if (url.pathname !== rawPath) return `path ${rawPath} differs from the parsed path ${url.pathname}`;
    const m = RELATION_PATH.exec(rawPath);
    if (!m) return `path ${rawPath} is not /rest/v1/<relation>`;
    if (!allowed.has(m[1])) return `relation ${m[1]} is not allowlisted`;

    const select = url.searchParams.get('select');
    if (select == null) return 'select is required (an absent select returns every column)';
    if (select.includes('*')) return 'select with * is not allowed';
    const bad = forbiddenIn(select);
    if (bad) return `select references forbidden column ${bad}`;
    for (const [key, value] of url.searchParams) {
      if (key === 'select') continue;
      const k = forbiddenIn(key);
      if (k) return `filter on forbidden column ${k}`;
      if (COLUMN_VALUE_PARAMS.has(key.toLowerCase().split('.').pop() ?? key)) {
        const v = forbiddenIn(value);
        if (v) return `${key} references forbidden column ${v}`;
      }
    }
    return null;
  }

  const guarded = (async (input, init) => {
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const raw = rawOf(input);
    const reason = violation(raw, method);
    if (reason) {
      const block: GuardBlock = {reason, method, path: raw.replace(/^https?:\/\/[^/]+/, '')};
      stats.attemptedNonRead += 1;
      stats.blocked.push(block);
      opts.onTrip?.(block);
      throw new Error(`chat read guard: ${reason}`);
    }
    stats.allowed += 1;
    return opts.underlying(input, init);
  }) as typeof fetch;

  return {fetch: guarded, stats};
}
