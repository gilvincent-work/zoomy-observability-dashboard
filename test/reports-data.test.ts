import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {FakeReportsDb} from './support/fake-reports-db';

const h = vi.hoisted(() => ({db: undefined as unknown as FakeReportsDb, mock: false}));

vi.mock('server-only', () => ({}));
vi.mock('../src/reports-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/reports-client')>();
  return {...real, usingReportsMock: () => h.mock, reportsReadClient: () => ({client: h.db.client(), stats: {allowed: 0, blocked: []}})};
});

import {REPORT_LIST_LIMIT, getReport, listReports} from '../src/reports-data';
import {FakeReportsDb as Fake} from './support/fake-reports-db';
import {spec} from './support/report-fixtures';

const A = 'a@zoomy.test';
const B = 'b@zoomy.test';
const S = JSON.parse(JSON.stringify(spec()));

function report(over: Record<string, unknown> = {}, versions = 1) {
  const r = h.db.seedReport(over);
  for (let v = 1; v <= versions; v++) h.db.seedVersion(r, v, {...S, title: `v${v}`}, {source_prompt: `prompt ${v}`});
  r.current_version = versions;
  return r;
}

beforeEach(() => {
  h.db = new Fake();
  h.mock = false;
});

describe('unconfigured and not set up', () => {
  it('Supabase env unset: both readers return {status: unconfigured} and read nothing', async () => {
    h.mock = true;
    expect(await listReports(A)).toEqual({status: 'unconfigured'});
    expect(await getReport('00000000-0000-4000-8000-000000000001', A)).toEqual({status: 'unconfigured'});
    expect(h.db.calls).toEqual([]);
  });

  it('Slice 4 #12: missing tables return {status: not_setup} from both readers', async () => {
    h.db.missing = true;
    expect(await listReports(A)).toEqual({status: 'not_setup'});
    expect(await getReport('00000000-0000-4000-8000-000000000001', A)).toEqual({status: 'not_setup'});
  });

  it('any other database failure is a distinct error status, not an empty gallery', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.db.failNext('coop_reports', 'select');
    const failed = await listReports(A);
    expect(failed).toEqual({status: 'error', message: 'The reports could not be read right now. Try again in a moment.'});
    expect(JSON.stringify(failed)).not.toContain('boom'); // the database text is logged, never shown
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('reports_read_error'));
    spy.mockRestore();
    const r = report();
    h.db.failNext('coop_report_versions', 'select');
    expect(await getReport(String(r.id), A)).toMatchObject({status: 'error'});
  });
});

describe('listReports: the gallery', () => {
  it('lists team reports for anyone and private ones only for their owner', async () => {
    report({title: 'Team one'});
    report({title: 'A private', visibility: 'private'});
    report({title: 'B private', visibility: 'private', owner_email: B});
    const forB = await listReports(B);
    const forA = await listReports(A);
    expect(forB).toMatchObject({status: 'ok'});
    if (forB.status !== 'ok' || forA.status !== 'ok') throw new Error('expected ok');
    expect(forB.reports.map((r) => r.title).sort()).toEqual(['B private', 'Team one']);
    expect(forA.reports.map((r) => r.title).sort()).toEqual(['A private', 'Team one']);
  });

  it("Slice 4 #8: a private report of another user is absent from the gallery", async () => {
    report({title: 'A private', visibility: 'private'});
    const r = await listReports(B);
    expect(r).toEqual({status: 'ok', reports: []});
    expect(JSON.stringify(r)).not.toContain('A private');
  });

  it('flags what the viewer owns and returns no spec', async () => {
    report({title: 'Mine'});
    report({title: 'Theirs', owner_email: B});
    const r = await listReports(A);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.reports.find((x) => x.title === 'Mine')?.mine).toBe(true);
    expect(r.reports.find((x) => x.title === 'Theirs')?.mine).toBe(false);
    for (const item of r.reports) expect(Object.keys(item).sort()).toEqual(['current_version', 'id', 'mine', 'owner_email', 'pinned', 'title', 'updated_at', 'visibility']);
  });

  it('Slice 4 #4: pinned first, then most recently updated; deleted reports are not listed', async () => {
    const old = report({title: 'Old'});
    report({title: 'Newer'});
    const pinned = report({title: 'Pinned old', pinned: true});
    report({title: 'Deleted', deleted_at: '2026-10-01T00:00:00Z'});
    old.updated_at = '2026-10-05T00:00:00.000Z';
    pinned.updated_at = '2026-09-01T00:00:00.000Z';
    const r = await listReports(A);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.reports.map((x) => x.title)).toEqual(['Pinned old', 'Old', 'Newer']);
  });

  it('shows at most 100', async () => {
    for (let i = 0; i < REPORT_LIST_LIMIT + 20; i++) h.db.seedReport({title: `R${i}`});
    const r = await listReports(A);
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.reports).toHaveLength(100);
  });

  it('no viewer (no session) sees an empty list and the database is not read', async () => {
    report();
    for (const v of [null, '', '  ']) expect(await listReports(v)).toEqual({status: 'ok', reports: []});
    expect(h.db.calls).toEqual([]);
  });

  it('never reads a spec for the gallery', async () => {
    report();
    await listReports(A);
    expect(h.db.calls.every((c) => c.table === 'coop_reports')).toBe(true);
  });
});

describe('getReport: one report, its versions, one version', () => {
  it('returns the latest version by default with the version list newest first', async () => {
    const r = report({}, 3);
    const res = await getReport(String(r.id), A);
    if (res.status !== 'ok') throw new Error(res.status);
    const d = res.detail;
    expect(d.report).toMatchObject({id: r.id, title: 'Bundle sales', current_version: 3});
    expect(d.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(d.versions[0]).toEqual({version: 3, created_by: A, created_at: expect.any(String), source_prompt: 'prompt 3'});
    expect(d.viewing).toMatchObject({version: 3, spec_version: 1, source_prompt: 'prompt 3'});
    expect((d.viewing.spec as {title: string}).title).toBe('v3');
    expect(d).toMatchObject({latestVersion: 3, isLatest: true, canEdit: true, isOwner: true});
  });

  it('Slice 4 #3: ?v=1 returns that older version, flagged as not the latest (the page makes it read-only)', async () => {
    const r = report({}, 3);
    const res = await getReport(String(r.id), A, 1);
    if (res.status !== 'ok') throw new Error(res.status);
    expect(res.detail.viewing.version).toBe(1);
    expect((res.detail.viewing.spec as {title: string}).title).toBe('v1');
    expect(res.detail).toMatchObject({isLatest: false, latestVersion: 3});
  });

  it('a version that does not exist, or a nonsense version, is not found', async () => {
    const r = report({}, 2);
    for (const v of [3, 99, 0, -1, 1.5, NaN]) expect(await getReport(String(r.id), A, v)).toEqual({status: 'not_found'});
  });

  it('a malformed or unknown id is not found, and a malformed one never reaches the database', async () => {
    for (const id of ['', 'abc', '1 or 1=1', 'x'.repeat(500)]) expect(await getReport(id, A)).toEqual({status: 'not_found'});
    expect(h.db.calls).toEqual([]);
    expect(await getReport('00000000-0000-4000-8000-0000000000ff', A)).toEqual({status: 'not_found'});
  });

  it('Slice 4 #8: user B asking for a private report of A gets not_found, identical to a missing report, with no version read', async () => {
    const r = report({visibility: 'private'});
    const hidden = await getReport(String(r.id), B);
    const missing = await getReport('00000000-0000-4000-8000-0000000000ff', B);
    expect(hidden).toEqual({status: 'not_found'});
    expect(hidden).toEqual(missing);
    expect(h.db.calls.some((c) => c.table === 'coop_report_versions')).toBe(false);
    expect(await getReport(String(r.id), null)).toEqual({status: 'not_found'});
  });

  it('team reports are open to B for editing; private ones to their owner only', async () => {
    const team = report();
    const mine = report({visibility: 'private', owner_email: B});
    const a = await getReport(String(team.id), B);
    const b = await getReport(String(mine.id), B);
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('expected ok');
    expect(a.detail).toMatchObject({canEdit: true, isOwner: false});
    expect(b.detail).toMatchObject({canEdit: true, isOwner: true});
  });

  it('Slice 4 #9: a deleted report returns {status: deleted} and nothing else, no title, no spec, no version read', async () => {
    const r = report({deleted_at: '2026-10-01T00:00:00Z'}, 2);
    const res = await getReport(String(r.id), A);
    expect(res).toEqual({status: 'deleted'});
    expect(JSON.stringify(res)).not.toContain('Bundle');
    expect(h.db.calls.some((c) => c.table === 'coop_report_versions')).toBe(false);
  });

  it("hidden wins over deleted: a stranger asking for A's deleted private report is told not_found", async () => {
    const r = report({visibility: 'private', deleted_at: '2026-10-01T00:00:00Z'});
    expect(await getReport(String(r.id), B)).toEqual({status: 'not_found'});
    expect(await getReport(String(r.id), A)).toEqual({status: 'deleted'});
  });

  it('trusts the versions that exist, not the counter: a bump whose version row is missing falls back to the newest row', async () => {
    const r = report({}, 2);
    r.current_version = 3;
    const res = await getReport(String(r.id), A);
    if (res.status !== 'ok') throw new Error(res.status);
    expect(res.detail).toMatchObject({latestVersion: 2, isLatest: true});
  });

  it('a lagging counter (a crash after the version insert) does not hide the newest version: latestVersion comes from the version rows', async () => {
    const r = report({}, 3);
    r.current_version = 2;
    const res = await getReport(String(r.id), A);
    expect(res).toMatchObject({status: 'ok', detail: {latestVersion: 3, isLatest: true}});
  });

  it('a report with no version at all is an error, not a blank page', async () => {
    const r = h.db.seedReport();
    expect(await getReport(String(r.id), A)).toMatchObject({status: 'error'});
  });
});
