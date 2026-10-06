// Explore status probe for /api/chat/health: ONE fixed, internal statement through the same read-only envelope the chat uses (the
// caller passes the real RunQuery from explore-setup; tests pass a fake). It is not model SQL and does not go through the validator.
// Returns a short code on failure, never driver text, and never throws. Pure apart from the injected runner and its own timer.
import {ExploreDbError} from './errors';
import {wrapCursor} from './parse';
import type {RawQueryResult} from './result';
import {EXPLORE_ROLE} from './types';

export const PROBE_SQL =
  "select current_user as role_name, current_setting('transaction_read_only') as read_only, current_setting('statement_timeout') as statement_timeout, (select count(*) from public.coop_explore_orders) as orders_visible";

export const PROBE_CAP_MS = 5000;

export type ExploreProbeCode = 'connection_refused' | 'auth_failed' | 'timeout' | 'undefined_table' | 'permission_denied' | 'wrong_role' | 'not_read_only' | 'unreachable' | 'other';
export type ExploreProbe = {ok: true; role: string; readOnly: string; ms: number} | {ok: false; code: ExploreProbeCode};

type Run = (sent: string, opts: {timeoutMs: number; maxRows: number}) => Promise<RawQueryResult>;

function codeOf(e: unknown): ExploreProbeCode {
  if (!(e instanceof ExploreDbError)) return 'other';
  const s = e.sqlstate ?? '';
  if (s === '28P01' || s === '28000') return 'auth_failed';
  if (e.code === 'E_TIMEOUT' || s === 'CONNECT_TIMEOUT' || s === 'ETIMEDOUT' || s === 'CONNECTION_CONNECT_TIMEOUT') return 'timeout';
  if (s === 'ECONNREFUSED' || s === 'CONNECTION_REFUSED' || s === 'ENOTFOUND') return 'connection_refused';
  if (e.code === 'E_RELATION') return 'undefined_table';
  if (e.code === 'E_DB_DENIED') return 'permission_denied';
  if (e.code === 'E_UNAVAILABLE') return 'unreachable';
  return 'other';
}

export async function probeExplore(runQuery: Run): Promise<ExploreProbe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t0 = Date.now();
  try {
    const cap = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExploreDbError('E_TIMEOUT')), PROBE_CAP_MS);
    });
    const r = await Promise.race([Promise.resolve().then(() => runQuery(wrapCursor(PROBE_SQL), {timeoutMs: 3000, maxRows: 1})), cap]);
    const row = r.rows[0];
    if (!row) return {ok: false, code: 'other'};
    const [role, readOnly] = row;
    if (role !== EXPLORE_ROLE) return {ok: false, code: 'wrong_role'};
    if (readOnly !== 'on') return {ok: false, code: 'not_read_only'};
    return {ok: true, role, readOnly, ms: Date.now() - t0};
  } catch (e) {
    return {ok: false, code: codeOf(e)};
  } finally {
    if (timer) clearTimeout(timer);
  }
}
