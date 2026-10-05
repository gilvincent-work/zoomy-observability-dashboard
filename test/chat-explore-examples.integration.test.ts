// LOCAL INTEGRATION (skipped unless the local stack from `scripts/local-supabase/up.sh --explore` is up and its env is loaded):
//   set -a; . scripts/local-supabase/.local-env; set +a; npx vitest run test/chat-explore-examples.integration.test.ts
// Every worked example in the prompt runs through the REAL executor (real parser, real `postgres` driver, role coop_explore_ro) on the
// fictional local fixture. As written (fictional names, 2025 dates) it must not error; with the fixture's own names and dates swapped in
// it must return rows of the right shape. A broken example would teach the model SQL that fails, so this is the gate.
import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {createRunQuery} from '../src/chat/explore/client';
import {createExploreExecutor} from '../src/chat/explore/executor';
import {EXPLORE_EXAMPLES} from '../src/chat/explore/examples';
import {DEFAULT_EXPLORE_LIMITS} from '../src/chat/explore/limits';
import {validateExploreSql} from '../src/chat/explore/parse';
import type {MetricResult} from '../src/chat/result-types';
import {assertLocalPostgres} from './support/local-only';

const URL_ = process.env.EXPLORE_DATABASE_URL;
if (URL_) assertLocalPostgres(URL_);
const local = !!URL_;
const run = local ? createRunQuery({enabled: true, limits: DEFAULT_EXPLORE_LIMITS, databaseUrl: URL_!}) : (undefined as never);

/** The prompt text is fictional on purpose; the fixture has its own events, dates and campaigns. */
const toFixture = (id: string, sql: string): string =>
  // only the Modern Market event has leads that carry a pet field (SM Aura's v1 export has none), so the breed example points there
  sql.replaceAll('%demo pet fair%', id === 'E03' ? '%modern market%' : '%sm aura pet fair%').replaceAll('%sample mall%', '%circuit makati%').replaceAll('2025-03-01', '2026-09-01').replaceAll('%demo%', '%modern%');

async function exec(sql: string): Promise<{payload: Record<string, unknown>; stored: MetricResult}> {
  let stored: MetricResult | undefined;
  const e = createExploreExecutor({
    runQuery: run,
    validate: validateExploreSql,
    limits: DEFAULT_EXPLORE_LIMITS,
    now: new Date('2026-10-05T00:00:00Z'),
    user: 'dev@localhost',
    store: {set: (_id, r) => void (stored = r)},
  });
  const payload = (await e({purpose: 'example check', sql, step: 'final'})) as Record<string, unknown>;
  if ('error' in payload) throw new Error(`${sql.slice(0, 40)}: ${String(payload.error)}`);
  return {payload, stored: stored!};
}

async function scalar(sql: string): Promise<number> {
  const r = await run(`DECLARE coop_explore_c NO SCROLL CURSOR FOR ${sql}`, {timeoutMs: 5000, maxRows: 5});
  return r.rows[0][0] as number;
}

describe.skipIf(!local)('EXP-02 every worked example runs through the real executor on the local fixture', () => {
  it.each(EXPLORE_EXAMPLES.map((e) => [e.id, e.sql]))('EXP-02 %s runs as written without an error', async (_id, sql) => {
    const {stored} = await exec(sql);
    expect(stored.columns.length).toBeGreaterThan(0);
    expect(stored.meta.exploratory?.sql).toBe(sql);
  });

  it.each(EXPLORE_EXAMPLES.map((e) => [e.id, e.sql]))('EXP-02 %s returns rows of the right shape on the fixture names and dates', async (id, sql) => {
    const {stored} = await exec(toFixture(id, sql));
    expect(stored.rows.length, `${id} returned no rows`).toBeGreaterThan(0);
    for (const c of stored.columns) {
      if (c.key.endsWith('_php')) expect([c.unit, c.role], c.key).toEqual(['PHP', 'measure']);
      if (c.key.endsWith('_count') || c.key.endsWith('_units')) expect(c.role, c.key).toBe('measure');
      if (c.role === 'measure' || c.role === 'share') for (const r of stored.rows) expect(typeof r[c.key] === 'number' || r[c.key] === null, `${id}.${c.key}`).toBe(true);
    }
    // a column that is a date is typed as time, never as a measure
    for (const k of ['day']) if (stored.columns.some((c) => c.key === k)) expect(stored.columns.find((c) => c.key === k)?.role).toBe('time');
  });

  // G3: E02 groups the event name case- and whitespace-insensitively and returns the per-event total as a cell, equal to the pet rows' sum.
  it('EXP-02 E02 per-event total is a cell that equals the sum of its pet rows', async () => {
    const e02 = EXPLORE_EXAMPLES.find((e) => e.id === 'E02')!;
    const {stored} = await exec(toFixture('E02', e02.sql));
    const per = new Map<string, {sum: number; totals: Set<number>}>();
    for (const r of stored.rows) {
      const k = String(r.event).toLowerCase().trim();
      const cur = per.get(k) ?? {sum: 0, totals: new Set<number>()};
      cur.sum += r.orders_count as number;
      cur.totals.add(r.event_total_count as number);
      per.set(k, cur);
    }
    expect(per.size).toBeGreaterThan(0);
    for (const [k, v] of per) expect([...v.totals], k).toEqual([v.sum]);
  });

  // Grain check (a wrong example teaches wrong figures): E15 splits the order total by pet, so its pieces must add up to every completed order,
  // including orders that have no item lines (an inner join to the items CTE used to drop them silently).
  it('EXP-02 E15 revenue per pet adds up to the revenue of all completed orders', async () => {
    const e15 = EXPLORE_EXAMPLES.find((e) => e.id === 'E15')!;
    const {stored} = await exec(e15.sql);
    const total = await scalar("select sum(o.total) from coop_explore_orders o where o.status = 'completed'");
    expect(stored.rows.reduce((a, r) => a + (r.revenue_php as number), 0)).toBeCloseTo(total, 2);
  });
});
