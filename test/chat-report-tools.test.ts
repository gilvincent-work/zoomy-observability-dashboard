import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {runMetric} from '../src/chat/query-metric';
import {buildDigestBlock, buildStaticSystem} from '../src/chat/context';
import {buildPreamble} from '../src/chat/preamble';
import {createReportSession, openReportSession, type ReportSession} from '../src/chat/report-session';
import {requestOf} from '../src/chat/report-spec';
import {createLineDecoder, encodeEvent} from '../src/chat/stream-protocol';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import {createExecutors} from '../src/chat/tool-executors';
import {dispatchToolCall} from '../src/chat/tools';
import type {ChartBlock, ChatBlock, KpiBlock, TableBlock} from '../src/chat/block-types';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import type {ReportBlockSpec, ReportSpec} from '../src/chat/report-types';
import type {MetricData, MetricRequest} from '../src/chat/result-types';
import {EVAL_NOW, line, mkOrder, standardData} from './support/skill-eval-fixtures';
import {BASE, bundleData, chartBlock, FILTERS, fx, kpiBlock, spec, tableBlock} from './support/report-fixtures';

type Out = Record<string, any>;

function setup(opts: {data?: MetricData; report?: ReportSession} = {}) {
  const data = opts.data ?? bundleData();
  const blocks: ChatBlock[] = [];
  const reports: (ReportSpec | null)[] = [];
  const session = opts.report ?? createReportSession();
  const ex = createExecutors({data: async () => data, now: EVAL_NOW, user: null, emitBlock: (b) => blocks.push(b), emitReport: (s) => reports.push(s), report: session});
  const q = async (over: Partial<MetricRequest>) => (await ex.query_metric?.({...BASE, ...over})) as Out;
  const kpi = (source: string, value: string, label: string, format: string, block = 'new') => ex.render_kpi?.({block, source, value, label, format}) as Promise<Out>;
  const chart = (source: string, over: Record<string, unknown> = {}) =>
    ex.render_chart?.({block: 'new', source, kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'A chart', ...over}) as Promise<Out>;
  const table = (source: string, over: Record<string, unknown> = {}) => ex.render_table?.({block: 'new', source, columns: ['auto'], title: 'A table', ...over}) as Promise<Out>;
  const filters = (over: Record<string, string> = {}) =>
    ex.set_report_filters?.({range: 'keep', from: '', to: '', pet: 'keep', event: 'keep', channel: 'keep', ...over}) as Promise<Out>;
  const lastSpec = () => reports.at(-1) ?? null;
  return {ex, blocks, reports, session, q, kpi, chart, table, filters, lastSpec, data};
}

/** The bundle dashboard, built the way the model builds it: b1 tile, b2 chart by pet, b3 table by bundle and pet. */
async function built() {
  const t = setup();
  const summary = await t.q({dimension: 'none'});
  const byPet = await t.q({dimension: 'pet_type'});
  const byBundle = await t.q({dimension: 'bundle_by_pet'});
  await t.kpi(summary.id, 'bundle_revenue', 'Bundle revenue', 'peso');
  await t.chart(byPet.id, {title: 'Revenue by pet'});
  await t.table(byBundle.id, {title: 'By bundle'});
  return {...t, summary, byPet, byBundle};
}

const bySpec = (s: ReportSpec | null) => Object.fromEntries((s?.blocks ?? []).map((b) => [b.id, JSON.stringify(b)]));

describe('recording what the model draws', () => {
  it('a built dashboard records query and view per block, adopts the source filters and emits the report after each call', async () => {
    const t = await built();
    expect(t.reports).toHaveLength(3); // one report event per successful render call
    const s = t.lastSpec() as ReportSpec;
    expect(s.filters).toEqual(FILTERS);
    expect(s.blocks.map((b) => [b.id, b.kind])).toEqual([['b1', 'kpi'], ['b2', 'chart'], ['b3', 'table']]);
    expect(s.blocks[0]).toEqual(kpiBlock('b1'));
    expect(s.blocks[1]).toMatchObject({query: {metric: 'bundle_sales', dimension: 'pet_type', measure: 'default', compare_to: 'none', sort: 'default', limit: 25}, view: {kind: 'auto', orientation: 'auto', mode: 'auto', x: 'auto', y: ['auto'], title: 'Revenue by pet'}});
    expect(s.blocks[2]).toMatchObject({view: {columns: ['auto'], title: 'By bundle'}});
    expect(JSON.stringify(s)).not.toMatch(/"rows"|"data"|"values"/);
  });
  it('the first render into an empty report adopts the source request filters', async () => {
    const t = setup();
    const r = await t.q({range: 'last_week', pet: 'cat'});
    await t.kpi(r.id, 'bundle_revenue', 'Bundle revenue', 'peso');
    expect(t.lastSpec()?.filters).toMatchObject({range: 'last_week', pet: 'cat'});
  });
  it('a failed render emits no block and no report event', async () => {
    const t = setup();
    expect(await t.table('r9')).toMatchObject({error: expect.stringContaining('Unknown result')});
    expect(t.reports).toEqual([]);
    expect(t.blocks).toEqual([]);
  });
});

describe('F8 criteria over the real executors and the bundle fixture', () => {
  it('criterion 1: re-binding b2 to a pie changes only b2 (mode user); the others are byte-identical', async () => {
    const t = await built();
    const before = bySpec(t.lastSpec());
    const emittedBefore = t.blocks.length;
    const pie = await t.q({dimension: 'pet_type'});
    const r = await t.chart(pie.id, {block: 'b2', kind: 'pie'});
    expect(r).toMatchObject({ok: true, block: 'b2'});
    const emitted = t.blocks.slice(emittedBefore);
    expect(emitted.map((b) => b.id)).toEqual(['b2']);
    expect((emitted[0] as ChartBlock).chart.form).toBe('pie');
    const after = bySpec(t.lastSpec());
    expect(after.b1).toBe(before.b1);
    expect(after.b3).toBe(before.b3);
    expect(after.b2).not.toBe(before.b2);
    expect(t.lastSpec()?.blocks[1]).toMatchObject({kind: 'chart', view: {kind: 'pie', mode: 'user'}});
    expect(t.lastSpec()?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']); // never a second copy
  });
  it('"show percentages": source may be the block id itself, and the query stays the block\'s', async () => {
    const t = await built();
    const r = await t.chart('b2', {block: 'b2', kind: 'stacked_bar_100'});
    expect(r).toMatchObject({ok: true, block: 'b2'});
    expect((t.blocks.at(-1) as ChartBlock).chart.form).toBe('stacked_bar_100');
    expect(t.lastSpec()?.blocks[1]).toMatchObject({query: {dimension: 'pet_type'}, view: {kind: 'stacked_bar_100', mode: 'user'}});
    expect(t.lastSpec()?.blocks).toHaveLength(3);
  });
  it('re-binding with kind auto puts a user block back to auto mode, and orientation is kept as asked', async () => {
    const t = await built();
    await t.chart('b2', {block: 'b2', kind: 'pie'});
    await t.chart('b2', {block: 'b2', kind: 'auto', orientation: 'vertical'});
    expect(t.lastSpec()?.blocks[1]).toMatchObject({view: {kind: 'auto', mode: 'auto', orientation: 'vertical'}});
  });

  it('criterion 2: set_report_filters pet=cat re-runs every block; data equals the cat compute; the filters change once', async () => {
    const t = await built();
    const emittedBefore = t.blocks.length;
    const reportsBefore = t.reports.length;
    const r = await t.filters({pet: 'cat'});
    expect(r).toMatchObject({ok: true, filters: {pet: 'cat', range: 'all_available'}});
    expect(t.reports).toHaveLength(reportsBefore + 1); // one report event, so the filters change once
    expect(t.lastSpec()?.filters).toEqual({...FILTERS, pet: 'cat'});
    const emitted = t.blocks.slice(emittedBefore);
    expect(emitted.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']); // same ids, same order: the client replaces them in place
    const run = (dimension: string) => {
      const out = runMetric({...BASE, dimension, pet: 'cat'}, t.data, EVAL_NOW);
      if ('error' in out) throw new Error(out.error);
      return out;
    };
    expect((emitted[0] as KpiBlock).value).toBe(run('none').rows[0].bundle_revenue);
    expect((emitted[1] as ChartBlock).twin.rows).toEqual(run('pet_type').rows);
    expect((emitted[2] as TableBlock).rows).toEqual(run('bundle_by_pet').rows);
    // the recipes did not change, only the filters
    expect(t.lastSpec()?.blocks.map((b) => JSON.stringify(b))).toEqual(Object.values(bySpec(t.reports[reportsBefore - 1])));
  });
  it('set_report_filters: only the named fields change; "keep" leaves the rest', async () => {
    const t = await built();
    await t.filters({pet: 'dog'});
    await t.filters({range: 'last_week'});
    expect(t.lastSpec()?.filters).toMatchObject({pet: 'dog', range: 'last_week', channel: 'offline', event: 'all'});
    await t.filters({range: 'custom', from: '2026-09-07', to: '2026-09-13'});
    expect(t.lastSpec()?.filters).toMatchObject({range: 'custom', from: '2026-09-07', to: '2026-09-13', pet: 'dog'});
  });

  it('criterion 3: last_month and this_week report each block\'s new coverage (possibly none), never zeros', async () => {
    const t = await built();
    const month = await t.filters({range: 'last_month'});
    expect(month.blocks.map((b: Out) => b.coverage)).toEqual(['partial', 'partial', 'partial']);
    expect(month.blocks[0]).toMatchObject({block: 'b1', covered_from: '2026-09-07', covered_to: '2026-09-27'});
    const none = await t.filters({range: 'this_week'});
    expect(none.blocks.map((b: Out) => b.coverage)).toEqual(['none', 'none', 'none']);
    expect(none.blocks.every((b: Out) => b.covered_from === null)).toBe(true);
    const shown = t.blocks.slice(-3);
    expect((shown[0] as KpiBlock).value).toBeNull();
    expect((shown[1] as TableBlock).rows).toEqual([]);
    expect(JSON.stringify(none)).not.toMatch(/"value"|rows/);
  });

  it('criterion 4: "add top SKUs" appends the next id and leaves the existing ids unchanged', async () => {
    const t = await built();
    const before = bySpec(t.lastSpec());
    const emittedBefore = t.blocks.length;
    const skus = await t.q({metric: 'bundle_picks', dimension: 'sku', measure: 'revenue', limit: 5, sort: 'value_desc'});
    const r = await t.table(skus.id, {title: 'Top SKUs'});
    expect(r).toMatchObject({ok: true, block: 'b4'});
    expect(t.blocks.slice(emittedBefore).map((b) => b.id)).toEqual(['b4']);
    const after = bySpec(t.lastSpec());
    expect(Object.keys(after)).toEqual(['b1', 'b2', 'b3', 'b4']);
    for (const id of ['b1', 'b2', 'b3']) expect(after[id]).toBe(before[id]);
    expect(t.lastSpec()?.blocks[3]).toMatchObject({kind: 'table', query: {metric: 'bundle_picks', dimension: 'sku', measure: 'revenue', limit: 5, sort: 'value_desc'}});
  });
  it('new block ids continue after the highest id of the client spec', async () => {
    const session = openReportSession(spec([kpiBlock('b2'), tableBlock('b5')]), bundleData(), EVAL_NOW);
    const t = setup({report: session});
    const r = await t.q({});
    expect(await t.kpi(r.id, 'bundle_orders', 'Orders', 'count')).toMatchObject({block: 'b6'});
    expect(t.lastSpec()?.blocks.map((b) => b.id)).toEqual(['b2', 'b5', 'b6']);
  });

  it('criterion 5: a filter change from 2 to 14 categories re-picks an auto chart; a user pie keeps its form and folds to Other', async () => {
    const orders = [mkOrder('a', '2026-09-22T10:00:00+08:00', [line('p1', 'Product 1', 1, 100), line('p2', 'Product 2', 1, 90)])];
    for (let i = 3; i <= 14; i++) orders.push(mkOrder(`o${i}`, '2026-09-05T10:00:00+08:00', [line(`p${i}`, `Product ${i}`, 1, 100 - i)]));
    const data: MetricData = {...standardData(), orders};
    const t = setup({data});
    const top = await t.q({metric: 'top_products', dimension: 'none', range: 'last_week'});
    await t.chart(top.id, {title: 'Top products'}); // b1, auto
    await t.chart(top.id, {title: 'Top products as a pie', kind: 'pie'}); // b2, user pie
    expect(t.blocks.map((b) => (b as ChartBlock).chart.form)).toEqual(['stacked_bar', 'pie']);
    expect(t.lastSpec()?.blocks.map((b) => (b as any).view.mode)).toEqual(['auto', 'user']);
    const emittedBefore = t.blocks.length;
    const r = await t.filters({range: 'all_available'});
    expect(r.ok).toBe(true);
    const [auto, user] = t.blocks.slice(emittedBefore) as ChartBlock[];
    expect([auto.id, user.id]).toEqual(['b1', 'b2']);
    expect(auto.chart.form).toBe('bar'); // re-picked: a top-7 bar plus "Other", not the 2-category stacked bar
    expect(auto.chosen.mode).toBe('auto');
    expect(auto.chart.folded).toMatchObject({into: 'Other'});
    expect(user.chart.form).toBe('pie'); // kept
    expect(user.chosen.mode).toBe('user');
    expect(user.chart.folded).toMatchObject({count: 9, into: 'Other'});
    expect(user.twin.rows).toHaveLength(14); // the twin still has every row
  });

  it('criterion 6: render_chart(block b9) for a missing block is an is_error listing the valid ids; the spec is unchanged', async () => {
    const t = await built();
    const before = JSON.stringify(t.lastSpec());
    const reports = t.reports.length;
    const out = await dispatchToolCall({name: 'render_chart', input: {block: 'b9', source: t.byPet.id, kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: ''}}, t.ex);
    expect(out.is_error).toBe(true);
    expect(out.content).toEqual({error: 'Unknown block \'b9\'. Use "new" or one of: b1, b2, b3.'});
    expect(JSON.stringify(t.session.snapshot())).toBe(before);
    expect(t.reports).toHaveLength(reports);
  });

  it('criterion 8: a report at 12 blocks refuses a 13th; replacing a block still works', async () => {
    const session = openReportSession(spec(Array.from({length: 12}, (_, i) => kpiBlock(`b${i + 1}`))), bundleData(), EVAL_NOW);
    const t = setup({report: session});
    const r = await t.q({});
    const before = JSON.stringify(session.snapshot());
    const out = await dispatchToolCall({name: 'render_kpi', input: {block: 'new', source: r.id, value: 'bundle_orders', label: 'Orders', format: 'count'}}, t.ex);
    expect(out.is_error).toBe(true);
    expect(out.content).toEqual({error: expect.stringMatching(/12 blocks.*remove_block/)});
    expect(JSON.stringify(session.snapshot())).toBe(before);
    expect(t.reports).toEqual([]);
    expect(await t.kpi(r.id, 'bundle_orders', 'Orders', 'count', 'b3')).toMatchObject({ok: true, block: 'b3'});
    expect(session.size()).toBe(12);
    await t.ex.remove_block?.({block: 'b12'});
    expect(await t.kpi(r.id, 'bundle_orders', 'Orders', 'count')).toMatchObject({ok: true, block: 'b13'});
  });

  it('criterion 10: a render whose source filters differ from the report\'s is an is_error pointing to set_report_filters', async () => {
    const t = await built();
    const before = JSON.stringify(t.session.snapshot());
    const cat = await t.q({dimension: 'pet_type', pet: 'cat'});
    const out = await dispatchToolCall({name: 'render_chart', input: {block: 'b2', source: cat.id, kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: ''}}, t.ex);
    expect(out.is_error).toBe(true);
    expect((out.content as Out).error).toMatch(/different filters.*set_report_filters/);
    const week = await t.q({range: 'last_week'});
    expect((await dispatchToolCall({name: 'render_kpi', input: {block: 'new', source: week.id, value: 'bundle_revenue', label: 'R', format: 'peso'}}, t.ex)).is_error).toBe(true);
    expect(JSON.stringify(t.session.snapshot())).toBe(before);
  });
  it('criterion 10: after set_report_filters the same query passes', async () => {
    const t = await built();
    await t.filters({pet: 'cat'});
    const cat = await t.q({dimension: 'pet_type', pet: 'cat'});
    expect(await t.chart(cat.id, {block: 'b2', kind: 'pie'})).toMatchObject({ok: true, block: 'b2'});
  });
});

describe('remove_block and set_report_title', () => {
  it('remove_block drops one block, emits the report, and the block id stops resolving as a source', async () => {
    const t = await built();
    const emittedBefore = t.blocks.length;
    const r = await t.ex.remove_block?.({block: 'b1'});
    expect(r).toEqual({ok: true, removed: 'b1', blocks: ['b2', 'b3']});
    expect(t.lastSpec()?.blocks.map((b) => b.id)).toEqual(['b2', 'b3']);
    expect(t.blocks).toHaveLength(emittedBefore); // nothing is drawn
    const out = await dispatchToolCall({name: 'render_table', input: {block: 'new', source: 'b1', columns: ['auto'], title: ''}}, t.ex);
    expect(out.is_error).toBe(true);
    expect((out.content as Out).error).toMatch(/Unknown result 'b1'.*b2, b3/);
    expect(await t.table('b3')).toMatchObject({ok: true, block: 'b4'}); // ids are not reused
  });
  it('remove_block of an unknown id is an is_error listing the valid ids and changes nothing', async () => {
    const t = await built();
    const reports = t.reports.length;
    const out = await dispatchToolCall({name: 'remove_block', input: {block: 'b9'}}, t.ex);
    expect(out).toEqual({is_error: true, content: {error: "Unknown block 'b9'. Blocks on the dashboard: b1, b2, b3."}});
    expect(t.reports).toHaveLength(reports);
    expect((await t.ex.remove_block?.({block: 'x'.repeat(500)})) as Out).toMatchObject({error: expect.not.stringContaining('xxxxxxxxxxxxxxxxxxxxxxxxx')});
  });
  it('removing the last block leaves a null report when there is no title', async () => {
    const t = setup();
    const r = await t.q({});
    await t.kpi(r.id, 'bundle_orders', 'Orders', 'count');
    await t.ex.remove_block?.({block: 'b1'});
    expect(t.lastSpec()).toBeNull();
  });
  it('set_report_title stores plain text, emits the report, and refuses an empty title', async () => {
    const t = await built();
    expect(await t.ex.set_report_title?.({title: '  Bundle\n sales   by pet  '})).toEqual({ok: true});
    expect(t.lastSpec()?.title).toBe('Bundle sales by pet');
    expect(await t.ex.set_report_title?.({title: 'x'.repeat(500)})).toEqual({ok: true});
    expect(t.lastSpec()?.title).toHaveLength(120);
    const out = await dispatchToolCall({name: 'set_report_title', input: {title: '   '}}, t.ex);
    expect(out.is_error).toBe(true);
  });
});

describe('set_report_filters refusals', () => {
  it('is an is_error when no dashboard is open', async () => {
    const t = setup();
    const out = await dispatchToolCall({name: 'set_report_filters', input: {range: 'last_week', from: '', to: '', pet: 'keep', event: 'keep', channel: 'keep'}}, t.ex);
    expect(out.is_error).toBe(true);
    expect((out.content as Out).error).toMatch(/no dashboard open/);
    expect(t.reports).toEqual([]);
  });
  it('refuses an all-"keep" call, a bad enum, and a custom range without real dates', async () => {
    const t = await built();
    const reports = t.reports.length;
    expect(await t.filters()).toEqual({error: 'Nothing to change: every field was "keep".'});
    expect(await t.filters({pet: 'bird'})).toMatchObject({error: expect.stringMatching(/pet is not allowed.*keep, all, dog, cat, both, untagged/)});
    expect(await t.filters({range: 'forever'})).toMatchObject({error: expect.stringMatching(/range is not allowed/)});
    expect(await t.filters({channel: 'lazada'})).toMatchObject({error: expect.stringMatching(/channel/)});
    expect(await t.filters({range: 'custom', from: 'soon', to: ''})).toMatchObject({error: expect.stringMatching(/real YYYY-MM-DD/)});
    expect(await t.filters({event: ''})).toMatchObject({error: expect.stringMatching(/event/)});
    expect(t.reports).toHaveLength(reports);
  });
  it('an unknown event, or a block that cannot take the filter, leaves everything unchanged and says which block', async () => {
    const t = await built();
    const before = JSON.stringify(t.session.snapshot());
    const out = await dispatchToolCall({name: 'set_report_filters', input: {range: 'keep', from: '', to: '', pet: 'keep', event: 'No Such Event', channel: 'keep'}}, t.ex);
    expect(out.is_error).toBe(true);
    expect((out.content as Out).error).toMatch(/Block b1 cannot use these filters.*Unknown event.*Nothing was changed/);
    expect(JSON.stringify(t.session.snapshot())).toBe(before);
  });
});

describe('criterion 9: the outline is figure-free and the cached prefix does not move', () => {
  it('has ids and params and none of the result values', async () => {
    const t = await built();
    await t.filters({pet: 'cat'});
    await t.ex.set_report_title?.({title: 'Bundle sales by pet'});
    const outline = t.session.outline();
    expect(outline).toMatch(/^b1 kpi: bundle_sales/m);
    expect(outline).toMatch(/^b2 chart: /m);
    expect(outline).toMatch(/^b3 table: /m);
    // Every digit left after removing ids, limits and dates would be a figure: there must be none.
    const stripped = outline.replace(/\bb\d+\b/g, '').replace(/limit \d+/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '');
    expect(stripped).not.toMatch(/\d/);
    // And no value of any stored result appears.
    for (const id of ['b1', 'b2', 'b3']) {
      for (const row of t.session.store.get(id)?.rows ?? []) {
        for (const v of Object.values(row)) if (typeof v === 'number' && v >= 100) expect(outline).not.toContain(String(v));
      }
    }
    expect(fx.expected.bundleRevenueC).toBeGreaterThan(0);
  });
  it('is appended to the preamble only when a report is open; tools and system are byte-identical either way', async () => {
    const t = await built();
    const data = bundleData();
    const plain = buildPreamble(data, EVAL_NOW);
    expect(buildPreamble(data, EVAL_NOW, '')).toBe(plain);
    expect(buildPreamble(data, EVAL_NOW, undefined)).toBe(plain);
    const withReport = buildPreamble(data, EVAL_NOW, t.session.outline());
    expect(withReport.startsWith(plain)).toBe(true);
    expect(withReport).toContain('[dashboard open]');
    // The cached blocks do not take a report as input at all: building them again after a report is open changes nothing.
    const toolsBefore = JSON.stringify(CHAT_TOOLS);
    const systemBefore = [buildStaticSystem({tools: true}), buildDigestBlock([], undefined, {home: false})];
    const open = openReportSession(spec(), data, EVAL_NOW);
    expect(open.outline()).not.toBe('');
    expect(JSON.stringify(CHAT_TOOLS)).toBe(toolsBefore);
    expect([buildStaticSystem({tools: true}), buildDigestBlock([], undefined, {home: false})]).toEqual(systemBefore);
  });
});

describe('the client spec round trip (hydrate, then edit by block id)', () => {
  it('a hydrated block can be a source by its block id, and equals what query_metric returns', async () => {
    const session = openReportSession(spec(), bundleData(), EVAL_NOW);
    const t = setup({report: session});
    expect(await t.chart('b2', {block: 'b2', kind: 'pie'})).toMatchObject({ok: true, block: 'b2'});
    const chart = t.blocks.at(-1) as ChartBlock;
    const direct = runMetric(requestOf(chartBlock('b2').query, FILTERS), t.data, EVAL_NOW);
    if ('error' in direct) throw new Error(direct.error);
    expect(chart.twin.rows).toEqual(direct.rows);
    expect(t.lastSpec()?.blocks[0]).toEqual(kpiBlock('b1'));
  });
  it('set_report_filters works on a hydrated spec and its title survives', async () => {
    const t = setup({report: openReportSession(spec(), bundleData(), EVAL_NOW)});
    expect(await t.filters({pet: 'dog'})).toMatchObject({ok: true});
    expect(t.lastSpec()).toMatchObject({title: 'Bundle sales', filters: {pet: 'dog'}});
  });
  it('a block that cannot be re-run on hydrate is not a source', async () => {
    const noPet: ReportBlockSpec = {id: 'b1', kind: 'table', query: {...kpiBlock('b1').query, metric: 'pet_mix', dimension: 'none'}, view: {columns: ['auto'], title: 'Pets'}};
    const session = openReportSession(spec([noPet], {filters: {...FILTERS, pet: 'cat'}}), bundleData(), EVAL_NOW);
    const t = setup({report: session});
    expect(await t.table('b1')).toMatchObject({error: expect.stringContaining("Unknown result 'b1'")});
  });
});

describe('route wiring: emitReport -> {t: "report"}', () => {
  it('streams a report event after each changing tool call, through the same encoder the route uses', async () => {
    const wire: string[] = [];
    const emit = (e: ChatStreamEvent) => wire.push(encodeEvent(e));
    const session = openReportSession(spec(), bundleData(), EVAL_NOW);
    // Exactly what app/api/chat/route.ts passes to createExecutors.
    const ex = createExecutors({data: async () => bundleData(), now: EVAL_NOW, user: null, emitBlock: (block) => emit({t: 'block', block}), report: session, emitReport: (s) => emit({t: 'report', spec: s})});
    emit({t: 'text', d: 'Switching to cats.'});
    await ex.set_report_filters?.({range: 'keep', from: '', to: '', pet: 'cat', event: 'keep', channel: 'keep'});
    await ex.remove_block?.({block: 'b3'});
    await ex.remove_block?.({block: 'b2'});
    await ex.remove_block?.({block: 'b1'});
    const events: ChatStreamEvent[] = createLineDecoder()(wire.join(''));
    expect(events.map((e) => e.t)).toEqual(['text', 'block', 'block', 'block', 'report', 'report', 'report', 'report']);
    const reports = events.filter((e): e is Extract<ChatStreamEvent, {t: 'report'}> => e.t === 'report').map((e) => e.spec);
    expect(reports[0]?.filters.pet).toBe('cat');
    expect(reports[0]?.blocks).toHaveLength(3);
    expect(reports[2]?.blocks.map((b) => b.id)).toEqual(['b1']);
    expect(reports[3]).toMatchObject({title: 'Bundle sales', blocks: []}); // the title keeps the report alive
  });
  it('the report event round-trips as JSON, including null', () => {
    const e: ChatStreamEvent[] = [{t: 'report', spec: spec()}, {t: 'report', spec: null}];
    expect(createLineDecoder()(e.map(encodeEvent).join(''))).toEqual(e);
  });
});

describe('what the model gets back stays small and figure-free', () => {
  it('set_report_filters returns filters and coverage only', async () => {
    const t = await built();
    const r = await t.filters({pet: 'cat'});
    expect(Object.keys(r).sort()).toEqual(['blocks', 'filters', 'ok']);
    for (const b of r.blocks) expect(Object.keys(b).sort()).toEqual(['block', 'coverage', 'covered_from', 'covered_to', 'form']);
    expect(r.blocks.map((b: Out) => b.form)).toEqual(['kpi', 'stacked_bar', 'table']);
  });
});
