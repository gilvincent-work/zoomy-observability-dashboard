// The per-turn coverage line (spec 6.7): the fixed statement validates, the line is built from real figures only, failures are quiet.
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {coverageLine, EXPLORE_COVERAGE_SQL, loadCoverageLine, resetCoverageCache} from '../src/chat/explore/coverage';
import {validateExploreSql} from '../src/chat/explore/parse';
import {DEFAULT_EXPLORE_LIMITS} from '../src/chat/explore/limits';
import {lines, sink} from './support/fake-model';

beforeEach(resetCoverageCache);

describe('explore coverage line', () => {
  it('the fixed statement passes the real validator (and is a single SELECT on the allowed views)', async () => {
    const v = await validateExploreSql(EXPLORE_COVERAGE_SQL);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.relations.sort()).toEqual(['coop_explore_event_leads', 'coop_explore_orders']);
  });

  it('builds the line from the row', () => {
    const row = ['2026-09-07', '2026-09-27', 120, 6, '2026-09-11', 100, 70, '2026-09-12', '2026-09-27', 45];
    expect(coverageLine(row)).toBe('[explore coverage] Orders from 7 Sep 2026 to 27 Sep 2026 (120 completed, 6 voided); pet tagged on 70% of completed orders since 11 Sep 2026; event leads from 12 Sep 2026 to 27 Sep 2026 (45 sign-ups, booth leads, not buyers).');
  });

  it('omits what it does not know and returns null for an empty database', () => {
    expect(coverageLine([null, null, 0, 0, null, 0, 0, null, null, 0])).toBeNull();
    expect(coverageLine(['2026-09-07', '2026-09-27', 3, 0, null, 0, 0, null, null, 0])).toBe('[explore coverage] Orders from 7 Sep 2026 to 27 Sep 2026 (3 completed, 0 voided).');
  });

  it('runs once a minute (module cache) and a failure logs one line and returns null', async () => {
    const run = vi.fn(async () => ({columns: [], rows: [['2026-09-07', '2026-09-27', 3, 0, null, 0, 0, null, null, 0]], fetched: 1, ms: 1}));
    let t = 1_000;
    const deps = {runQuery: run, validate: validateExploreSql, limits: DEFAULT_EXPLORE_LIMITS, clock: () => t};
    const a = await loadCoverageLine(deps);
    await loadCoverageLine(deps);
    expect(run).toHaveBeenCalledTimes(1);
    t += 61_000;
    await loadCoverageLine(deps);
    expect(run).toHaveBeenCalledTimes(2);
    expect(a).toMatch(/^\[explore coverage\]/);

    resetCoverageCache();
    const s = sink();
    const bad = await loadCoverageLine({...deps, runQuery: async () => { throw new Error('db down at host'); }, sink: s});
    expect(bad).toBeNull();
    expect(lines(s.info)).toEqual([{event: 'chat_explore_coverage_failed', code: 'failed'}]);
  });
});
