// Drift status for /api/chat/health (spec 1.6): the newest row of coop_explore_drift_log, counts only. A fake runQuery stands in for
// the driver: no database, no network.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {DRIFT_SQL, loadDrift} from '../src/chat/explore/drift';
import type {RawQueryResult} from '../src/chat/explore/result';

const NOW = new Date('2026-10-08T00:00:00Z');
const ok = (rows: unknown[][]): RawQueryResult => ({columns: [{name: 'checked_at', type: 'timestamp'}, {name: 'findings_count', type: 'number'}], rows, fetched: rows.length, ms: 1});

describe('drift status for /api/chat/health (spec 1.6)', () => {
  it('reads the newest drift row, counts only, through the cursor envelope', async () => {
    let sent = '';
    const s = await loadDrift(async (sql) => { sent = sql; return ok([['2026-10-07T22:00:00Z', 0]]); }, NOW);
    expect(sent).toContain(DRIFT_SQL);
    expect(sent).toMatch(/^DECLARE coop_explore_c NO SCROLL CURSOR FOR /);
    expect(DRIFT_SQL).not.toMatch(/findings[^_]/); // never the names, only the count
    expect(s).toEqual({checkedAt: '2026-10-07T22:00:00Z', findings: 0, stale: false});
  });
  it('is stale with no row, an old row, or a failed read; never throws', async () => {
    expect(await loadDrift(async () => ok([]), NOW)).toEqual({checkedAt: null, findings: null, stale: true});
    expect((await loadDrift(async () => ok([['2026-10-01T22:00:00Z', 2]]), NOW)).stale).toBe(true);
    expect(await loadDrift(async () => { throw new Error('down'); }, NOW)).toEqual({checkedAt: null, findings: null, stale: true});
  });
  it('a non-numeric count or an unparseable time is reported, not trusted', async () => {
    expect(await loadDrift(async () => ok([['2026-10-07T22:00:00Z', 'x']]), NOW)).toEqual({checkedAt: '2026-10-07T22:00:00Z', findings: null, stale: false});
    expect((await loadDrift(async () => ok([['not a time', 0]]), NOW)).stale).toBe(true);
  });
});

// The SQL is proven against a real database by scripts/coop-explore-ro-proof.mjs (local only); these pins keep the contract from drifting
// silently in `npm test`.
describe('drift job and rollback SQL (Train 3, Task 4)', () => {
  const read = (f: string) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8');
  const direct = read('coop_chat_explore_direct.sql');
  const rollback = read('coop_chat_explore_direct_rollback.sql');
  it('drift_findings reports the eight keys, role memberships, unlisted views and the guards; cron runs it daily', () => {
    const body = direct.slice(direct.indexOf('function coop_explore_admin.drift_findings()'));
    for (const k of ['closed_readable', 'secret_columns_readable', 'write_privileges', 'unreadable_open', 'unlisted_views', 'role', 'guard', 'other_schemas']) expect(body).toContain(`'${k}',`);
    expect(body).toMatch(/pg_auth_members m where m\.member = ro/);
    expect(body).toMatch(/coop_explore_guard_ddl/);
    expect(body).toMatch(/coop_explore_reapply/);
    expect(direct).toMatch(/cron\.schedule\('coop_explore_drift', '0 22 \* \* \*'/);
    expect(direct).toMatch(/revoke all on sequence public\.coop_explore_drift_log_id_seq from public, anon, authenticated/);
  });
  it('the rollback is one transaction that removes every guard and ends in a self-check', () => {
    expect(rollback.trimStart().split('\n').filter((l) => !l.startsWith('--'))[0]).toBe('begin;');
    expect(rollback.trimEnd().endsWith('commit;')).toBe(true);
    for (const s of ["'coop_explore_reapply', 'coop_explore_drift'", 'drop event trigger if exists coop_explore_guard_ddl', 'nobypassrls', 'drop schema if exists coop_explore_admin cascade', 'drop table if exists public.coop_explore_drift_log', 'rollback verified']) expect(rollback).toContain(s);
    expect(rollback.match(/ \('coop_explore_[a-z_]+'\)[,;]/g)).toHaveLength(15);
  });
});
