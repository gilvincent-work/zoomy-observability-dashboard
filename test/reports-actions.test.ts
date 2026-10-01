import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {FakeReportsDb} from './support/fake-reports-db';

const h = vi.hoisted(() => ({
  db: undefined as unknown as FakeReportsDb,
  session: null as {user: {email?: string | null}} | null,
  authThrows: false,
  authCalls: 0,
  mock: false,
  clientThrows: null as string | null,
  data: undefined as unknown,
  dataFails: false,
  dataCalls: 0,
  paths: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({revalidatePath: (p: string) => void h.paths.push(p), revalidateTag: () => undefined}));
vi.mock('../auth', () => ({
  auth: async () => {
    h.authCalls += 1;
    if (h.authThrows) throw new Error('auth exploded');
    return h.session;
  },
}));
vi.mock('../src/chat/server', () => ({
  getChatMetricData: async () => {
    h.dataCalls += 1;
    if (h.dataFails) throw new Error('data unavailable');
    return h.data;
  },
}));
vi.mock('../src/reports-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/reports-client')>();
  return {
    ...real,
    usingReportsMock: () => h.mock,
    reportsWriteClient: () => {
      if (h.clientThrows) throw new Error(h.clientThrows);
      return {client: h.db.client(), stats: {allowed: 0, blocked: []}};
    },
  };
});

import {deleteReport, renameReport, restoreVersion, saveReport, setPinned, setVisibility, updateReport} from '../src/reports-actions';
import {FakeReportsDb as Fake} from './support/fake-reports-db';
import {EVAL_NOW} from './support/skill-eval-fixtures';
import {bundleData, chartBlock, FILTERS, kpiBlock, spec, tableBlock} from './support/report-fixtures';

const A = 'a@zoomy.test';
const B = 'b@zoomy.test';
const as = (email: string | null) => void (h.session = email ? {user: {email}} : null);
const draft = (...args: Parameters<typeof spec>): unknown => JSON.parse(JSON.stringify(spec(...args)));
const specOf = (id: unknown, version: number) => h.db.versionsOf(id).find((v) => v.version === version)?.spec;
const snapshot = () => JSON.stringify(h.db.tables);

async function saved(over: {visibility?: 'team' | 'private'; as?: string} = {}): Promise<string> {
  as(over.as ?? A);
  const r = await saveReport({spec: draft(), prompt: 'Show bundle sales', visibility: over.visibility});
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

beforeEach(() => {
  h.db = new Fake();
  h.session = {user: {email: A}};
  h.authThrows = false;
  h.authCalls = 0;
  h.mock = false;
  h.clientThrows = null;
  h.data = bundleData();
  h.dataFails = false;
  h.dataCalls = 0;
  h.paths = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Slice 4 #1: Save creates the report and version 1 from a draft', () => {
  it('writes one report row and version 1: no data keys, owner from the session, the prompt stored', async () => {
    as('  A@Zoomy.Test ');
    const planted = [{secret: 'LEAK-123'}];
    const raw = draft() as Record<string, unknown> & {blocks: Record<string, unknown>[]};
    raw.data = planted;
    raw.blocks[0].data = planted;
    raw.blocks[0].values = planted;
    const r = await saveReport({spec: raw, prompt: 'Show bundle sales by pet', owner_email: 'evil@x.test', created_by: 'evil@x.test'} as never);
    expect(r).toMatchObject({ok: true, version: 1});
    if (!r.ok) return;
    expect(h.db.tables.coop_reports).toHaveLength(1);
    expect(h.db.tables.coop_reports[0]).toMatchObject({id: r.id, owner_email: A, title: 'Bundle sales', visibility: 'team', pinned: false, current_version: 1, deleted_at: null});
    const versions = h.db.versionsOf(r.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({version: 1, spec_version: 1, created_by: A, source_prompt: 'Show bundle sales by pet'});
    expect(JSON.stringify(versions[0].spec)).not.toContain('LEAK-123');
    expect(JSON.stringify(versions[0].spec)).not.toMatch(/"data"|"values"/);
    expect(versions[0].spec).toMatchObject({spec_version: 1, title: 'Bundle sales', filters: {...FILTERS, pinned: false}});
    expect(h.paths).toEqual(expect.arrayContaining(['/reports', `/reports/${r.id}`]));
  });

  it('a client cannot switch Pin dates on by sending pinned: true in the spec', async () => {
    const raw = draft() as {filters: Record<string, unknown>};
    raw.filters.pinned = true;
    const r = await saveReport({spec: raw});
    if (!r.ok) throw new Error(r.error);
    expect((specOf(r.id, 1) as {filters: {pinned: boolean}}).filters.pinned).toBe(false);
  });

  it('stores the prompt as plain text, at most 2000 characters, never rendered as markup', async () => {
    const r = await saveReport({spec: draft(), prompt: `  hi\u0000 <b>there</b>\n${'x'.repeat(3000)}`});
    if (!r.ok) throw new Error(r.error);
    const prompt = String(h.db.versionsOf(r.id)[0].source_prompt);
    expect(prompt.length).toBe(2000);
    expect(prompt.startsWith('hi  <b>there</b>\nxxx')).toBe(true);
    expect(prompt).not.toContain('\u0000');
  });

  it('a missing or blank prompt is stored as null', async () => {
    for (const prompt of [undefined, null, '   ', 42]) {
      const r = await saveReport({spec: draft(), prompt: prompt as never});
      if (!r.ok) throw new Error(r.error);
      expect(h.db.versionsOf(r.id)[0].source_prompt).toBeNull();
    }
  });

  it('takes the title from the input, else the spec; plain text, 1 to 120 characters; may be private', async () => {
    const a = await saveReport({spec: draft(), title: '  Weekly   <i>view</i>  ', visibility: 'private'});
    if (!a.ok) throw new Error(a.error);
    expect(h.db.reportById(a.id)).toMatchObject({title: 'Weekly <i>view</i>', visibility: 'private'});
    expect(await saveReport({spec: draft([kpiBlock('b1')], {title: ''})})).toEqual({ok: false, error: 'Give the report a title.'});
    const long = await saveReport({spec: draft(), title: 'y'.repeat(300)});
    if (!long.ok) throw new Error(long.error);
    expect(String(h.db.reportById(long.id)?.title)).toHaveLength(120);
  });

  it('refuses a bad draft without writing: unknown metric, 200 blocks, no blocks, bad visibility, junk', async () => {
    const bad = draft() as {blocks: {query: {metric: string}}[]};
    bad.blocks[0].query.metric = 'drop_table';
    const cases: unknown[] = [bad, draft(Array.from({length: 200}, (_, i) => kpiBlock(`b${i + 1}`))), draft([]), null, 'x', 5];
    for (const c of cases) expect(await saveReport({spec: c})).toMatchObject({ok: false});
    expect(await saveReport({spec: draft(), visibility: 'public' as never})).toMatchObject({ok: false});
    expect(await saveReport(null as never)).toMatchObject({ok: false});
    expect(h.db.tables.coop_reports).toHaveLength(0);
    expect(h.db.tables.coop_report_versions).toHaveLength(0);
  });

  it('a failed version insert leaves no visible report: the half-made row is soft-deleted', async () => {
    h.db.failNext('coop_report_versions', 'insert');
    const r = await saveReport({spec: draft()});
    expect(r).toMatchObject({ok: false});
    expect(h.db.tables.coop_reports).toHaveLength(1);
    expect(h.db.tables.coop_reports[0].deleted_at).not.toBeNull();
    expect(h.db.tables.coop_report_versions).toHaveLength(0);
  });

  it('a LOST response on version 1 also retires the report (it is soft-deleted, so no half-saved report stays visible)', async () => {
    h.db.loseResponseNext('coop_report_versions', 'insert');
    expect(await saveReport({spec: draft()})).toMatchObject({ok: false});
    expect(h.db.tables.coop_reports).toHaveLength(1);
    expect(h.db.tables.coop_reports[0].deleted_at).not.toBeNull();
  });

  it('if retiring the orphan fails too it is logged, the action still returns an error and never throws', async () => {
    h.db.failNext('coop_report_versions', 'insert');
    h.db.failNext('coop_reports', 'update');
    const r = await saveReport({spec: draft()});
    expect(r).toMatchObject({ok: false});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('reports_orphan_not_retired'));
  });

  it('Pin dates: resolves the range once at save time into fixed dates and stores pinned = true', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(EVAL_NOW);
    const r = await saveReport({spec: draft([kpiBlock('b1')], {filters: {...FILTERS, range: 'last_week'}}), pinDates: true});
    if (!r.ok) throw new Error(r.error);
    expect(specOf(r.id, 1)).toMatchObject({filters: {range: 'custom', from: '2026-09-21', to: '2026-09-27', pinned: true}});
    expect(h.dataCalls).toBe(1);
    // without Pin dates the data is not even loaded and the range stays relative
    const live = await saveReport({spec: draft([kpiBlock('b1')], {filters: {...FILTERS, range: 'last_week'}})});
    if (!live.ok) throw new Error(live.error);
    expect(specOf(live.id, 1)).toMatchObject({filters: {range: 'last_week', pinned: false}});
    expect(h.dataCalls).toBe(1);
  });

  it('Pin dates with no data available returns an error and writes nothing', async () => {
    h.dataFails = true;
    expect(await saveReport({spec: draft(), pinDates: true})).toMatchObject({ok: false, error: expect.stringContaining('pinned')});
    expect(h.db.tables.coop_reports).toHaveLength(0);
  });
});

describe('Slice 4 #10: a stale expected_version returns an error and writes no version', () => {
  it('update bumps the version when expected matches, and refuses when it does not', async () => {
    const id = await saved();
    const v2 = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), prompt: 'add a chart'});
    expect(v2).toEqual({ok: true, id, version: 2});
    expect(h.db.reportById(id)?.current_version).toBe(2);
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
    expect(h.db.versionsOf(id)[1]).toMatchObject({source_prompt: 'add a chart', created_by: A});

    const before = snapshot();
    const stale = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1')])});
    expect(stale).toMatchObject({ok: false, error: expect.stringContaining('now version 2')});
    expect(snapshot()).toBe(before);
  });

  it('two concurrent saves with the same expected_version produce exactly one new version', async () => {
    const id = await saved();
    const [x, y] = await Promise.all([
      updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), prompt: 'one'}),
      updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), tableBlock('b2')]), prompt: 'two'}),
    ]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
    expect(h.db.reportById(id)?.current_version).toBe(2);
    const loser = x.ok ? y : x;
    expect(loser).toMatchObject({ok: false, error: expect.stringContaining('changed since you opened it')});
  });

  it('the version primary key alone stops a writer that passed the early check (another writer inserted in between)', async () => {
    const id = await saved();
    // Another writer inserts version 2 between this writer's read of the latest version and its own insert.
    const real = h.db.client;
    h.db.client = () => {
      const c = real.call(h.db);
      return {
        ...c,
        from: (t) => {
          const f = c.from(t);
          return {...f, insert: (v) => (t === 'coop_report_versions' ? (h.db.seedVersion(h.db.reportById(id) as never, 2, draft(), {created_by: B}), f.insert(v)) : f.insert(v))};
        },
      };
    };
    const r = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(r).toMatchObject({ok: false, error: expect.stringContaining('changed since you opened it')});
    expect(h.db.versionsOf(id).map((v) => [v.version, v.created_by])).toEqual([[1, A], [2, B]]); // the other writer's row is untouched
    expect(h.db.reportById(id)?.title).toBe('Bundle sales');
  });

  it('a failed version insert changes nothing (no counter, no title), and the report is still updatable', async () => {
    const id = await saved();
    h.db.failNext('coop_report_versions', 'insert');
    const r = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), title: 'Renamed in the same step'});
    expect(r).toMatchObject({ok: false});
    expect(h.db.reportById(id)).toMatchObject({current_version: 1, title: 'Bundle sales'});
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1]);
    expect(h.db.calls.filter((c) => c.table === 'coop_reports' && c.op === 'update')).toHaveLength(0); // no rollback needed: the counter was never touched
    expect(await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])})).toMatchObject({ok: true, version: 2});
  });

  it('three concurrent saves with the same expected version: exactly one wins, the rest get the stale error', async () => {
    const id = await saved();
    const results = await Promise.all([1, 2, 3].map((n) => updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), prompt: `writer ${n}`})));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({error: expect.stringContaining('changed since you opened it')});
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
    expect(h.db.reportById(id)?.current_version).toBe(2);
  });

  it('a stale loser never advances the counter or the title of the winner', async () => {
    const id = await saved();
    const [x, y] = await Promise.all([
      updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), title: 'Winner or loser A'}),
      updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), tableBlock('b2')]), title: 'Winner or loser B'}),
    ]);
    const winner = x.ok ? 'Winner or loser A' : 'Winner or loser B';
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect(h.db.reportById(id)?.title).toBe(winner);
  });

  it('crash between the version insert and the counter step: the version exists, the next Update (from the real latest version) works and repairs the counter', async () => {
    const id = await saved();
    h.db.failNext('coop_reports', 'update'); // the process dies / the counter PATCH fails after the version row was written
    const first = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(first).toMatchObject({ok: true, version: 2}); // the committed fact is the version row
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
    expect(h.db.reportById(id)?.current_version).toBe(1); // the counter lags: only a cache
    // the page derives expected from the real latest version (reports-data latestVersion = 2), so this is not wedged
    const next = await updateReport({id, expectedVersion: 2, spec: draft([kpiBlock('b1'), chartBlock('b2'), tableBlock('b3')])});
    expect(next).toMatchObject({ok: true, version: 3});
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2, 3]);
    expect(h.db.reportById(id)?.current_version).toBe(3);
  });

  it('a lagging counter does not stop Restore either (it compares with the real latest version)', async () => {
    const id = await saved();
    h.db.failNext('coop_reports', 'update');
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(h.db.reportById(id)?.current_version).toBe(1);
    expect(await restoreVersion({id, version: 1, expectedVersion: 2})).toMatchObject({ok: true, version: 3});
    expect(h.db.reportById(id)?.current_version).toBe(3);
  });

  it('a title changed in a save whose counter step was lost still lands', async () => {
    const id = await saved();
    h.db.failNext('coop_reports', 'update');
    expect(await updateReport({id, expectedVersion: 1, spec: draft(), title: 'Weekly bundles'})).toMatchObject({ok: true, version: 2});
    expect(h.db.reportById(id)?.title).toBe('Weekly bundles'); // the counter stays a lagging cache; the version row is the fact
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
  });

  it('lost insert response (the row landed, the caller saw an error): no retry storm, no wedge', async () => {
    const id = await saved();
    h.db.loseResponseNext('coop_report_versions', 'insert');
    const lost = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(lost).toMatchObject({ok: false});
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]); // it did land
    // the person presses Update again from the old page (expected 1): one clear "reload" answer, nothing written
    const calls = h.db.calls.length;
    const retry = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(retry).toMatchObject({ok: false, error: expect.stringContaining('now version 2')});
    expect(h.db.calls.slice(calls).filter((c) => c.op !== 'select')).toEqual([]);
    expect(h.db.versionsOf(id).map((v) => v.version)).toEqual([1, 2]);
    // after a reload (expected 2) the report saves normally, the counter catching up
    expect(await updateReport({id, expectedVersion: 2, spec: draft([kpiBlock('b1'), chartBlock('b2')])})).toMatchObject({ok: true, version: 3});
    expect(h.db.reportById(id)?.current_version).toBe(3);
  });

  it('the stale and the failed-write messages carry no database text', async () => {
    const id = await saved();
    h.db.failNext('coop_report_versions', 'insert');
    const r = await updateReport({id, expectedVersion: 1, spec: draft()});
    expect(r).toEqual({ok: false, error: 'The report could not be saved. Nothing was changed; try again.'});
    expect(JSON.stringify(r)).not.toContain('boom');
  });

  it('update can rename in the same step, validates the draft again, and refuses garbage expected versions', async () => {
    const id = await saved();
    expect(await updateReport({id, expectedVersion: 1, spec: draft(), title: 'Weekly bundles'})).toMatchObject({ok: true, version: 2});
    expect(h.db.reportById(id)?.title).toBe('Weekly bundles');
    const bad = draft() as {blocks: {query: {metric: string}}[]};
    bad.blocks[0].query.metric = 'drop_table';
    const before = snapshot();
    expect(await updateReport({id, expectedVersion: 2, spec: bad})).toMatchObject({ok: false});
    for (const v of [0, -1, 1.5, '2', null, undefined, NaN]) expect(await updateReport({id, expectedVersion: v as never, spec: draft()})).toMatchObject({ok: false});
    expect(snapshot()).toBe(before);
  });

  it('Pin dates is explicit on update: true pins the dates, absent stores an unpinned recipe', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(EVAL_NOW);
    const id = await saved();
    const r = await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1')], {filters: {...FILTERS, range: 'last_week'}}), pinDates: true});
    expect(r).toMatchObject({ok: true, version: 2});
    expect(specOf(id, 2)).toMatchObject({filters: {range: 'custom', from: '2026-09-21', to: '2026-09-27', pinned: true}});
    await updateReport({id, expectedVersion: 2, spec: draft([kpiBlock('b1')], {filters: {...FILTERS, range: 'last_week'}})});
    expect(specOf(id, 3)).toMatchObject({filters: {range: 'last_week', pinned: false}});
  });
});

describe('Slice 4 #3: Restore copies version N into a NEW latest version', () => {
  it('with 3 versions, restoring v1 creates v4 equal to v1 and leaves v1 to v3 unchanged', async () => {
    const id = await saved();
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')]), prompt: 'two'});
    await updateReport({id, expectedVersion: 2, spec: draft([kpiBlock('b1'), chartBlock('b2'), tableBlock('b3')]), prompt: 'three'});
    const before = h.db.versionsOf(id).map((v) => JSON.stringify(v));
    expect(before).toHaveLength(3);

    const r = await restoreVersion({id, version: 1, expectedVersion: 3});
    expect(r).toEqual({ok: true, id, version: 4});
    const after = h.db.versionsOf(id);
    expect(after.slice(0, 3).map((v) => JSON.stringify(v))).toEqual(before);
    expect(after[3]).toMatchObject({version: 4, spec_version: 1, created_by: A, source_prompt: 'Restored from version 1'});
    expect(after[3].spec).toEqual(after[0].spec);
    expect(h.db.reportById(id)?.current_version).toBe(4);
  });

  it('refuses a stale expected version, the latest version, a missing version and bad numbers, writing nothing', async () => {
    const id = await saved();
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    const before = snapshot();
    expect(await restoreVersion({id, version: 1, expectedVersion: 1})).toMatchObject({ok: false, error: expect.stringContaining('now version 2')});
    expect(await restoreVersion({id, version: 2, expectedVersion: 2})).toMatchObject({ok: false, error: 'That is already the latest version.'});
    expect(await restoreVersion({id, version: 9, expectedVersion: 2})).toMatchObject({ok: false, error: 'Version 9 was not found.'});
    expect(await restoreVersion({id, version: 0, expectedVersion: 2})).toMatchObject({ok: false});
    expect(snapshot()).toBe(before);
  });

  it('an old version with a metric since removed is still restorable (copied as stored, not re-validated)', async () => {
    const id = await saved();
    const v1 = h.db.versionsOf(id)[0];
    (v1.spec as {blocks: {query: {metric: string}}[]}).blocks[0].query.metric = 'since_removed';
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(await restoreVersion({id, version: 1, expectedVersion: 2})).toMatchObject({ok: true, version: 3});
    expect(JSON.stringify(specOf(id, 3))).toContain('since_removed');
  });

  it('a failed insert of the restored version changes nothing', async () => {
    const id = await saved();
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    h.db.failNext('coop_report_versions', 'insert');
    expect(await restoreVersion({id, version: 1, expectedVersion: 2})).toMatchObject({ok: false});
    expect(h.db.reportById(id)?.current_version).toBe(2);
    expect(h.db.versionsOf(id)).toHaveLength(2);
  });
});

describe('Slice 4 #4: rename, pin and visibility create no version', () => {
  it('rename changes the title only', async () => {
    const id = await saved();
    const before = h.db.versionsOf(id).map((v) => JSON.stringify(v));
    const created = String(h.db.reportById(id)?.updated_at);
    expect(await renameReport({id, title: '  New   <b>name</b> '})).toEqual({ok: true, id});
    expect(h.db.reportById(id)).toMatchObject({title: 'New <b>name</b>', current_version: 1});
    expect(String(h.db.reportById(id)?.updated_at) > created).toBe(true);
    expect(h.db.versionsOf(id).map((v) => JSON.stringify(v))).toEqual(before);
  });

  it('pin and unpin change the flag only; visibility changes team and private; none writes a version', async () => {
    const id = await saved();
    expect(await setPinned({id, pinned: true})).toEqual({ok: true, id});
    expect(h.db.reportById(id)?.pinned).toBe(true);
    expect(await setPinned({id, pinned: false})).toEqual({ok: true, id});
    expect(await setVisibility({id, visibility: 'private'})).toEqual({ok: true, id});
    expect(h.db.reportById(id)?.visibility).toBe('private');
    expect(await setVisibility({id, visibility: 'team'})).toEqual({ok: true, id});
    expect(h.db.versionsOf(id)).toHaveLength(1);
    expect(h.db.reportById(id)?.current_version).toBe(1);
    expect(h.db.calls.filter((c) => c.table === 'coop_report_versions' && c.op !== 'select')).toHaveLength(1); // only the save's version 1
  });

  it('refuses a blank title, a non-boolean pin and a bad visibility', async () => {
    const id = await saved();
    expect(await renameReport({id, title: '   '})).toMatchObject({ok: false});
    expect(await setPinned({id, pinned: 'yes' as never})).toMatchObject({ok: false});
    expect(await setVisibility({id, visibility: 'everyone' as never})).toMatchObject({ok: false});
    expect(h.db.reportById(id)).toMatchObject({title: 'Bundle sales', pinned: false, visibility: 'team'});
  });
});

describe("Slice 4 #8: user B cannot touch user A's private report", () => {
  it('every action returns the same error as for a report that does not exist, and changes nothing', async () => {
    const id = await saved({visibility: 'private'});
    as(B);
    const before = snapshot();
    const errors = [
      await setPinned({id, pinned: true}),
      await renameReport({id, title: 'Mine now'}),
      await deleteReport({id}),
      await setVisibility({id, visibility: 'team'}),
      await updateReport({id, expectedVersion: 1, spec: draft()}),
      await restoreVersion({id, version: 1, expectedVersion: 1}),
    ];
    for (const e of errors) expect(e).toEqual({ok: false, error: 'Report not found.'});
    expect(snapshot()).toBe(before);
    const missing = await deleteReport({id: '00000000-0000-4000-8000-0000000000ff'});
    expect(missing).toEqual({ok: false, error: 'Report not found.'});
  });

  it('on a TEAM report B may rename, pin, update and restore, but not delete or change visibility (owner only)', async () => {
    const id = await saved({visibility: 'team'});
    as(B);
    expect(await setPinned({id, pinned: true})).toMatchObject({ok: true});
    expect(await renameReport({id, title: 'By B'})).toMatchObject({ok: true});
    expect(await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])})).toMatchObject({ok: true, version: 2});
    expect(h.db.versionsOf(id)[1].created_by).toBe(B);
    expect(await restoreVersion({id, version: 1, expectedVersion: 2})).toMatchObject({ok: true, version: 3});
    expect(await deleteReport({id})).toEqual({ok: false, error: 'Only the owner can delete this report.'});
    expect(await setVisibility({id, visibility: 'private'})).toEqual({ok: false, error: 'Only the owner can change who sees this report.'});
    expect(h.db.reportById(id)).toMatchObject({deleted_at: null, visibility: 'team', owner_email: A});
  });

  it('the owner can delete and change visibility of their own report', async () => {
    const id = await saved({visibility: 'private'});
    as(A);
    expect(await setVisibility({id, visibility: 'team'})).toMatchObject({ok: true});
    expect(await deleteReport({id})).toMatchObject({ok: true});
  });

  it('an id that is not a uuid never reaches the database', async () => {
    const calls = h.db.calls.length;
    for (const id of ['', 'abc', '1 or 1=1', "x'--"]) expect(await deleteReport({id})).toEqual({ok: false, error: 'Report not found.'});
    expect(h.db.calls.length).toBe(calls);
  });
});

describe('Slice 4 #9: a deleted report refuses every action', () => {
  it('delete is soft: the row and all versions stay, deleted_at is set', async () => {
    const id = await saved();
    await updateReport({id, expectedVersion: 1, spec: draft([kpiBlock('b1'), chartBlock('b2')])});
    expect(await deleteReport({id})).toEqual({ok: true, id});
    expect(h.db.tables.coop_reports).toHaveLength(1);
    expect(h.db.reportById(id)?.deleted_at).not.toBeNull();
    expect(h.db.versionsOf(id)).toHaveLength(2);
  });

  it('afterwards rename, pin, visibility, update, restore and a second delete all return the deleted error', async () => {
    const id = await saved();
    await deleteReport({id});
    const before = snapshot();
    const results = [
      await renameReport({id, title: 'Zombie'}),
      await setPinned({id, pinned: true}),
      await setVisibility({id, visibility: 'private'}),
      await updateReport({id, expectedVersion: 1, spec: draft()}),
      await restoreVersion({id, version: 1, expectedVersion: 1}),
      await deleteReport({id}),
    ];
    for (const r of results) expect(r).toEqual({ok: false, error: 'This report was deleted.'});
    expect(snapshot()).toBe(before);
  });

  it('a delete that races an update: the counter step filters on deleted_at, the caller is told the report was deleted', async () => {
    const id = await saved();
    const row = h.db.reportById(id) as {deleted_at: string | null};
    const real = h.db.client;
    h.db.client = () => {
      const c = real.call(h.db);
      return {...c, from: (t) => {
        const f = c.from(t);
        return {...f, update: (v) => ((row.deleted_at = '2026-10-01T00:00:00Z'), f.update(v))};
      }};
    };
    expect(await updateReport({id, expectedVersion: 1, spec: draft()})).toEqual({ok: false, error: 'This report was deleted.'});
    expect(h.db.reportById(id)?.deleted_at).toBe('2026-10-01T00:00:00Z'); // still deleted, not resurrected
  });
});

describe('Slice 4 #11: no session returns an error without touching the database', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const everyAction = () => [
    saveReport({spec: draft()}),
    updateReport({id, expectedVersion: 1, spec: draft()}),
    restoreVersion({id, version: 1, expectedVersion: 2}),
    renameReport({id, title: 'x'}),
    setPinned({id, pinned: true}),
    setVisibility({id, visibility: 'private'}),
    deleteReport({id}),
  ];

  it.each([
    ['no session', () => as(null)],
    ['a session without an email', () => void (h.session = {user: {email: null}})],
    ['a blank email', () => as('   ')],
    ['auth() throwing', () => void (h.authThrows = true)],
  ])('%s: every action returns an error and the database sees no call', async (_n, setup) => {
    setup();
    for (const r of await Promise.all(everyAction())) expect(r).toEqual({ok: false, error: 'Sign in to use reports.'});
    expect(h.db.calls).toEqual([]);
    expect(h.authCalls).toBeGreaterThanOrEqual(7);
    expect(h.dataCalls).toBe(0);
    expect(h.paths).toEqual([]);
  });

  it('calls auth() first: even in demo mode, no session wins', async () => {
    as(null);
    h.mock = true;
    expect(await saveReport({spec: draft()})).toEqual({ok: false, error: 'Sign in to use reports.'});
  });
});

describe('demo mode and failures: actions return an ActionResult and never throw', () => {
  it('with the Supabase env unset every action returns an error naming demo mode and touches nothing', async () => {
    h.mock = true;
    const id = '00000000-0000-4000-8000-000000000001';
    const all = await Promise.all([
      saveReport({spec: draft()}),
      updateReport({id, expectedVersion: 1, spec: draft()}),
      restoreVersion({id, version: 1, expectedVersion: 2}),
      renameReport({id, title: 'x'}),
      setPinned({id, pinned: true}),
      setVisibility({id, visibility: 'private'}),
      deleteReport({id}),
    ]);
    for (const r of all) expect(r).toMatchObject({ok: false, error: expect.stringContaining('demo mode')});
    expect(h.db.calls).toEqual([]);
  });

  it('a client that cannot be created (for example COOP_REQUIRE_LOCAL_DB against a hosted URL) is an error, not a throw', async () => {
    h.clientThrows = 'COOP_REQUIRE_LOCAL_DB=1: refusing to connect to abc.supabase.co (only 127.0.0.1 or localhost is allowed).';
    expect(await saveReport({spec: draft()})).toMatchObject({ok: false, error: expect.stringContaining('COOP_REQUIRE_LOCAL_DB')});
    expect(h.db.calls).toEqual([]);
  });

  it('missing tables say so; any other database error is reported; an unexpected throw is contained', async () => {
    h.db.missing = true;
    expect(await saveReport({spec: draft()})).toMatchObject({ok: false, error: expect.stringContaining('not set up')});
    h.db.missing = false;
    h.db.failNext('coop_reports', 'insert');
    const generic = await saveReport({spec: draft()});
    expect(generic).toEqual({ok: false, error: 'The report could not be saved. Nothing was changed; try again.'});
    const real = h.db.client;
    h.db.client = () => ({
      from: (t) => ({
        ...real.call(h.db).from(t),
        insert: () => {
          throw new Error('kaboom');
        },
      }),
    });
    const r = await saveReport({spec: draft()});
    expect(r).toMatchObject({ok: false});
    expect(JSON.stringify(r)).not.toContain('kaboom');
  });
});

describe('the actions file is a write seam, not an export surface', () => {
  const src = readFileSync('src/reports-actions.ts', 'utf8');
  it("starts with 'use server' and exports only async functions (and types)", () => {
    expect(src.trimStart().startsWith("'use server'")).toBe(true);
    const exports = [...src.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]);
    expect(exports.length).toBeGreaterThan(0);
    for (const e of exports) expect(e).toMatch(/^(async function \w+|type |interface )/);
  });
  it('writes only through reportsWriteClient (no createClient, no other client import)', () => {
    expect(src).toContain('reportsWriteClient');
    expect(src).not.toMatch(/createClient|pos-data|posClient|reportsReadClient/);
  });
});
