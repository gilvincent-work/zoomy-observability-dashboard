import type {ReactElement} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {MetricData} from '../src/chat/result-types';
import type {ReportGetResult, ReportListResult} from '../src/reports-types';
import {buildClosure, loadDirs} from './support/chat-arch-scan';
import {bundleData, spec} from './support/report-fixtures';

// GAP-15 (S4#11): the two Reports pages had no test. Both are async Server Components: calling them returns the element they would
// render (type and props) or throws what next/navigation throws, so the redirect, the 404, the deleted notice and the zero-model
// guarantee are asserted without a browser. The components themselves are stubs here (they are plain presentation); the real
// helpers, the real runReport and the real chat data shaping run. Nothing touches a network, a key or a database.

const h = vi.hoisted(() => ({
  viewer: null as string | null,
  list: {status: 'ok', reports: []} as unknown,
  get: {status: 'not_found'} as unknown,
  listCalls: [] as string[],
  getCalls: [] as {id: string; viewer: string; version: number | undefined}[],
  dataCalls: 0,
  data: null as unknown,
  dataFails: false,
  runCalls: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {redirectTo: url});
  },
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), {notFound: true});
  },
}));
// presentation components: identity stubs, compared by reference
vi.mock('@/components/analyst/reports-gallery', () => ({ReportsGallery: function ReportsGallery() {return null;}}));
vi.mock('@/components/analyst/reports-notice', () => ({ReportsNotice: function ReportsNotice() {return null;}}));
vi.mock('@/components/analyst/reports-blocks', () => ({ReportBlocks: function ReportBlocks() {return null;}}));
vi.mock('@/components/analyst/reports-header', () => ({ReportHeader: function ReportHeader() {return null;}}));
vi.mock('@/components/analyst/reports-helpers', async () => await import('../components/analyst/reports-helpers'));
vi.mock('@/src/reports-session', () => ({reportsViewerEmail: async () => h.viewer}));
vi.mock('@/src/reports-data', () => ({
  listReports: async (viewer: string) => {
    h.listCalls.push(viewer);
    return h.list;
  },
  getReport: async (id: string, viewer: string, version?: number) => {
    h.getCalls.push({id, viewer, version});
    return h.get;
  },
}));
vi.mock('@/src/chat/server', () => ({
  getChatMetricData: async () => {
    h.dataCalls += 1;
    if (h.dataFails) throw new Error('not readable');
    return h.data;
  },
}));
vi.mock('@/src/reports-run', async () => {
  const real = await import('../src/reports-run');
  return {
    ...real,
    runReport: (...a: Parameters<typeof real.runReport>) => {
      h.runCalls.push(a[0]);
      return real.runReport(...a);
    },
  };
});

const load = async () => ({
  Gallery: (await import('@/components/analyst/reports-gallery')).ReportsGallery,
  Notice: (await import('@/components/analyst/reports-notice')).ReportsNotice,
  Blocks: (await import('@/components/analyst/reports-blocks')).ReportBlocks,
  Header: (await import('@/components/analyst/reports-header')).ReportHeader,
  ReportsPage: (await import('../app/reports/page')).default,
  ReportPage: (await import('../app/reports/[id]/page')).default,
});
type Page = Awaited<ReturnType<typeof load>>;
const el = (x: unknown): ReactElement<Record<string, unknown>> => x as ReactElement<Record<string, unknown>>;
const props = (id: string, v?: string | string[]) => ({params: Promise.resolve({id}), searchParams: Promise.resolve({v})});
/** What the page throws (a redirect or a 404), or null when it returned an element. */
async function thrown(fn: () => Promise<unknown>): Promise<{redirectTo?: string; notFound?: boolean} | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as {redirectTo?: string; notFound?: boolean};
  }
}

const ITEM = {id: 'r1', title: 'Bundles', owner_email: 'a@example.test', visibility: 'team' as const, pinned: false, current_version: 1, updated_at: '2026-09-27T00:00:00Z', mine: true};
const detail = (over: Record<string, unknown> = {}) => ({
  report: {id: 'r1', owner_email: 'a@example.test', title: 'Bundles', visibility: 'team', pinned: false, current_version: 2, deleted_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-27T00:00:00Z'},
  versions: [], latestVersion: 2, isLatest: true, canEdit: true, isOwner: true,
  viewing: {report_id: 'r1', version: 2, spec_version: 1, spec: spec(), source_prompt: null, created_by: 'a@example.test', created_at: '2026-09-27T00:00:00Z'},
  ...over,
});

let p: Page;
beforeEach(async () => {
  p = await load();
  h.viewer = 'owner@example.test';
  h.list = {status: 'ok', reports: [ITEM]} satisfies ReportListResult;
  h.get = {status: 'ok', detail: detail()} as unknown as ReportGetResult;
  h.listCalls.length = 0;
  h.getCalls.length = 0;
  h.runCalls.length = 0;
  h.dataCalls = 0;
  h.dataFails = false;
  h.data = bundleData() as MetricData;
});

describe('/reports (the gallery)', () => {
  it('no viewer: redirect to sign-in with the page as the callback, and nothing is read', async () => {
    h.viewer = null;
    expect(await thrown(() => p.ReportsPage())).toEqual(expect.objectContaining({redirectTo: '/signin?callbackUrl=%2Freports'}));
    expect(h.listCalls).toEqual([]);
  });

  it('a viewer gets the gallery with what listReports returned for THAT viewer', async () => {
    const out = el(await p.ReportsPage());
    expect(out.type).toBe(p.Gallery);
    expect(out.props.reports).toEqual([ITEM]);
    expect(h.listCalls).toEqual(['owner@example.test']);
  });

  it.each([
    ['not_setup', 'Reports not set up'],
    ['unconfigured', 'Reports need the Supabase connection'],
  ])('%s: a calm notice, not the gallery', async (status, title) => {
    h.list = {status};
    const out = el(await p.ReportsPage());
    expect(out.type).toBe(p.Notice);
    expect(out.props.title).toBe(title);
  });

  it('an error shows a short message (long or technical text is replaced), never the gallery', async () => {
    h.list = {status: 'error', message: 'relation "coop_reports" does not exist ' + 'x'.repeat(200)};
    const out = el(await p.ReportsPage());
    expect(out.type).toBe(p.Notice);
    expect(String(out.props.body)).not.toMatch(/relation|coop_reports/);
  });
});

describe('/reports/[id] (one report)', () => {
  it('no viewer: redirect to sign-in with the report URL as the callback (the id is encoded), and nothing is read', async () => {
    h.viewer = null;
    expect(await thrown(() => p.ReportPage(props('r1')))).toEqual(expect.objectContaining({redirectTo: '/signin?callbackUrl=%2Freports%2Fr1'}));
    expect(await thrown(() => p.ReportPage(props('a b/../c')))).toEqual(expect.objectContaining({redirectTo: `/signin?callbackUrl=${encodeURIComponent('/reports/a b/../c')}`}));
    expect(h.getCalls).toEqual([]);
    expect(h.dataCalls).toBe(0);
  });

  it('not_found (a missing report AND one hidden from this viewer share one status) is a 404, with no data load and no run', async () => {
    h.get = {status: 'not_found'};
    expect(await thrown(() => p.ReportPage(props('r1')))).toEqual(expect.objectContaining({notFound: true}));
    expect(h.dataCalls).toBe(0);
    expect(h.runCalls).toEqual([]);
  });

  it('deleted: a notice that says so, with no title, no spec, no data load and no run', async () => {
    h.get = {status: 'deleted'};
    const out = el(await p.ReportPage(props('r1')));
    expect(out.type).toBe(p.Notice);
    expect(out.props.title).toBe('This report was deleted');
    expect(out.props.body).toBe('Its link no longer shows any data.');
    expect(JSON.stringify(out.props)).not.toMatch(/Bundles|spec|blocks/);
    expect(h.dataCalls).toBe(0);
    expect(h.runCalls).toEqual([]);
  });

  it('not set up and demo mode show the same notices as the gallery, with a way back', async () => {
    h.get = {status: 'not_setup'};
    const out = el(await p.ReportPage(props('r1')));
    expect(out.type).toBe(p.Notice);
    expect(out.props).toMatchObject({title: 'Reports not set up', linkLabel: 'Back to reports'});
  });

  it('passes the viewer, the id and the ?v= version (a bad value is ignored, a repeated parameter takes the first)', async () => {
    await p.ReportPage(props('r1', '1'));
    await p.ReportPage(props('r1', 'abc'));
    await p.ReportPage(props('r1', ['1', '2']));
    expect(h.getCalls.map((c) => c.version)).toEqual([1, undefined, 1]);
    expect(h.getCalls.every((c) => c.id === 'r1' && c.viewer === 'owner@example.test')).toBe(true);
  });

  it('ok: runReport is called ONCE with the stored spec and the live data, and the blocks are rendered', async () => {
    const stored = spec();
    h.get = {status: 'ok', detail: detail({viewing: {...detail().viewing, spec: stored}})};
    const out = el(await p.ReportPage(props('r1')));
    expect(h.dataCalls).toBe(1);
    expect(h.runCalls).toEqual([stored]);
    const children = (out.props.children as unknown[]).map((c) => el(c));
    expect(children[0].type).toBe(p.Header);
    expect(children[1].type).toBe(p.Blocks);
    expect(Array.isArray(children[1].props.blocks) && (children[1].props.blocks as unknown[]).length).toBeGreaterThan(0);
    expect(children[0].props).toMatchObject({id: 'r1', isLatest: true, canEdit: true, isOwner: true, viewingVersion: 2});
  });

  it('?v=1 (not the latest): the header gets no spec to hand to the chat, so nothing from an old version is editable', async () => {
    h.get = {status: 'ok', detail: detail({isLatest: false, canEdit: true, viewing: {...detail().viewing, version: 1}})};
    const header = el((el(await p.ReportPage(props('r1', '1'))).props.children as unknown[])[0]);
    expect(header.props).toMatchObject({isLatest: false, viewingVersion: 1, askSpec: null});
  });

  it('live data not available (a thrown read) is a status message, not a crash, and the header still renders', async () => {
    h.dataFails = true;
    const kids = el(await p.ReportPage(props('r1'))).props.children as unknown[];
    expect(el(kids[0]).type).toBe(p.Header);
    expect(h.runCalls).toEqual([]);
    expect(JSON.stringify(kids[1])).toMatch(/Live data isn't available/);
  });

  it('an untrusted stored spec that cannot be run is shown as an error line, never as data', async () => {
    h.get = {status: 'ok', detail: detail({viewing: {...detail().viewing, spec: {spec_version: 99, blocks: 'x'}}})};
    const kids = el(await p.ReportPage(props('r1'))).props.children as unknown[];
    expect(JSON.stringify(kids[1])).toMatch(/This report can't be shown/);
  });
});

describe('the report pages never reach a model', () => {
  const files = loadDirs(process.cwd(), ['app', 'src', 'components', 'lib']);
  const closure = buildClosure(['app/reports/page.tsx', 'app/reports/[id]/page.tsx'], files, {from: '', allowed: []});

  it('the closure is really walked (it reaches runReport and the data seam), so the checks below are not vacuous', () => {
    expect(closure.files.has('src/reports-run.ts')).toBe(true);
    expect(closure.files.has('src/chat/server.ts')).toBe(true);
    expect(closure.files.has('src/reports-data.ts')).toBe(true);
  });

  it('no Anthropic SDK, no chat loop, no system prompt or model config anywhere in either page\'s import closure', () => {
    expect([...closure.bare.keys()].filter((s) => /anthropic/i.test(s))).toEqual([]);
    for (const f of ['src/chat/loop.ts', 'src/chat/context.ts', 'src/chat/preamble.ts', 'src/chat/config.ts', 'app/api/chat/route.ts']) expect(closure.files.has(f), f).toBe(false);
  });
});
