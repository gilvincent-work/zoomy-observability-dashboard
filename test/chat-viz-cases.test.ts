import {describe, expect, it} from 'vitest';
import {recommendView} from '../src/chat/recommend-view';
import {createReportSession} from '../src/chat/report-session';
import {createExecutors} from '../src/chat/tool-executors';
import type {ChartBlock, ChatBlock} from '../src/chat/block-types';
import type {ColumnRole, ColumnUnit, MeasureDecl, MetricResult, MetricRow, ResultColumn} from '../src/chat/result-types';
import {BASE} from './support/report-fixtures';
import {EVAL_NOW} from './support/skill-eval-fixtures';
import {goldenData} from './support/golden-cases';

// F11, Slice 6 criterion 4: "Given the viz-choice cases, then chosen.form matches in every case and kind is auto in every case
// whose prompt names no form." The table below is the TOOL-CALL table (what the model is expected to pass to render_chart /
// render_table for each prompt); it runs through the real render executors and the real recommendView over the synthetic
// fixtures, so it asserts the code's choice, not the model's. Design section 8 rows first, then one row per recommendView rule
// and per preference tier (A honored, B honored with a note, C substituted with a reason).

type Shape = {columns: ResultColumn[]; rows: MetricRow[]; measure?: string; measures?: MeasureDecl[]};
type Source = {query: Partial<typeof BASE>} | {shape: Shape};
type Render = {tool: 'render_chart' | 'render_table' | 'render_kpi'; kind?: string; orientation?: string; x?: string; y?: string[]; columns?: string[]; value?: string};

interface VizCase {
  id: string;
  prompt: string;
  source: Source;
  render: Render;
  /** Block kinds produced, in order. */
  blocks: ('kpi' | 'chart' | 'table')[];
  /** chosen.form of each CHART block, in order. */
  forms?: string[];
  orientation?: 'vertical' | 'horizontal';
  tier?: 'A' | 'B' | 'C';
  /** Must appear in the joined adjustments of the first chart (or, for a tile, of the choice). */
  note?: RegExp;
  /** Categories folded into "Other" in the first chart. */
  folded?: number;
  /** The first chart's chosen.mode. */
  mode?: 'auto' | 'user';
}

const col = (key: string, unit: ColumnUnit, role: ColumnRole, label = key): ResultColumn => ({key, label, unit, role});
const names = (n: number, prefix = 'Item') => Array.from({length: n}, (_, i) => `${prefix} ${String.fromCharCode(65 + i)}`);
const cats = (n: number, values?: number[], prefix = 'Item'): Shape => ({
  columns: [col('name', 'text', 'category'), col('revenue', 'PHP', 'measure', 'Revenue')],
  rows: names(n, prefix).map((name, i) => ({name, revenue: values?.[i] ?? 1000 - i * 50})),
});
const DAYS = ['2026-09-03', '2026-09-01', '2026-09-02', '2026-09-04'];

// ---- the table ---------------------------------------------------------------------------------------------------------------

const CASES: VizCase[] = [
  // design section 8, viz-choice rows
  {id: 'daily_revenue', prompt: 'Daily revenue last week', source: {query: {metric: 'offline_revenue', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['area'], orientation: 'vertical', mode: 'auto'},
  {id: 'daily_revenue_and_orders', prompt: 'Daily revenue and order count', source: {query: {metric: 'offline_aov', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart', y: ['revenue', 'orders']}, blocks: ['chart', 'chart'], forms: ['area', 'area'], note: /different scales.*no shared axis/},
  {id: 'top5_by_revenue', prompt: 'Top 5 products by revenue', source: {query: {metric: 'top_products', range: 'last_week', limit: 5}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['bar'], orientation: 'vertical'},
  {id: 'top5_long_names', prompt: 'Top 5 products by revenue (long product names)', source: {shape: cats(5, [500, 100, 90, 80, 70], 'Freeze Dried Chicken Breast')}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['bar'], orientation: 'horizontal'},
  {id: 'payment_mix', prompt: 'Payment mix', source: {query: {metric: 'payment_mix', range: 'last_week'}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['stacked_bar'], orientation: 'horizontal'},
  {id: 'total_revenue_tile', prompt: 'Total revenue last week', source: {query: {metric: 'offline_revenue', range: 'last_week'}}, render: {tool: 'render_chart'}, blocks: ['kpi']},
  {id: 'revenue_by_12_skus', prompt: 'Revenue by SKU (12 SKUs)', source: {shape: cats(12)}, render: {tool: 'render_chart'}, blocks: ['chart', 'table'], forms: ['bar'], folded: 5, note: /all 12 rows.*top 7/},
  {id: 'revenue_by_19_skus', prompt: 'Revenue by SKU', source: {query: {metric: 'top_products', limit: 25}}, render: {tool: 'render_chart'}, blocks: ['chart', 'table'], forms: ['bar'], folded: 12, note: /all 19 rows/},
  {id: 'bundles_by_pet', prompt: 'Bundles by pet', source: {query: {metric: 'bundle_sales', dimension: 'pet_type', limit: 25}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['stacked_bar'], orientation: 'horizontal'},
  {id: 'payment_mix_pie', prompt: 'Show payment mix as a pie', source: {query: {metric: 'payment_mix', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['pie'], tier: 'B', mode: 'user', note: /pie of two slices is better as a bar/},
  {id: 'pet_mix_pie', prompt: 'Show pet mix as a pie', source: {query: {metric: 'pet_mix', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['pie'], tier: 'A', mode: 'user'},
  {id: 'sku_pie_12', prompt: 'Show revenue by SKU as a pie', source: {shape: cats(12)}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['pie'], tier: 'B', folded: 7, note: /Folded the 7 smallest of 12 categories into "Other".*max 6 slices/},
  {id: 'sku_pie_19', prompt: 'Show revenue by SKU as a pie', source: {query: {metric: 'top_products', limit: 25}}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['pie'], tier: 'B', folded: 14, note: /19 categories/},
  {id: 'one_chart', prompt: 'Revenue and orders on one chart', source: {query: {metric: 'offline_aov', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart', y: ['revenue', 'orders']}, blocks: ['chart', 'chart'], forms: ['area', 'area'], note: /different scales/},
  {id: 'make_it_horizontal', prompt: 'Make it horizontal', source: {query: {metric: 'top_products', range: 'last_week', limit: 5}}, render: {tool: 'render_chart', orientation: 'horizontal'}, blocks: ['chart'], forms: ['bar'], orientation: 'horizontal', tier: 'A'},
  {id: 'everything_as_table', prompt: 'Show everything as a table', source: {query: {metric: 'top_products', range: 'last_week', limit: 5}}, render: {tool: 'render_table', columns: ['auto']}, blocks: ['table']},

  // one row per recommendView rule (first match wins)
  {id: 'rule_no_rows', prompt: 'Show the events', source: {shape: {columns: [col('name', 'text', 'category'), col('revenue', 'PHP', 'measure')], rows: []}}, render: {tool: 'render_chart'}, blocks: ['table']},
  {id: 'rule_one_row_tiles', prompt: 'Show the headline numbers', source: {shape: {columns: [col('rev', 'PHP', 'measure'), col('orders', 'count', 'measure'), col('share', 'percent', 'share')], rows: [{rev: 12000, orders: 30, share: 41.5}]}}, render: {tool: 'render_chart'}, blocks: ['kpi', 'kpi', 'kpi']},
  {id: 'rule_too_many_numbers', prompt: 'Show every number', source: {shape: {columns: Array.from({length: 5}, (_, i) => col(`m${i}`, 'count', 'measure')), rows: [{m0: 1, m1: 2, m2: 3, m3: 4, m4: 5}]}}, render: {tool: 'render_chart'}, blocks: ['table']},
  {id: 'rule_no_number', prompt: 'List the names', source: {shape: {columns: [col('name', 'text', 'category'), col('note', 'text', 'category')], rows: [{name: 'A', note: 'x'}, {name: 'B', note: 'y'}]}}, render: {tool: 'render_chart'}, blocks: ['table']},
  {id: 'rule_time_several_series', prompt: 'Revenue and refunds by day', source: {shape: {columns: [col('day', 'date', 'time'), col('a', 'PHP', 'measure'), col('b', 'PHP', 'measure')], rows: DAYS.map((day, i) => ({day, a: i * 10, b: i * 20}))}}, render: {tool: 'render_chart', y: ['a', 'b']}, blocks: ['chart'], forms: ['line']},
  {id: 'rule_delta', prompt: 'Change since last week', source: {shape: {columns: [col('name', 'text', 'category'), col('delta', 'PHP', 'delta')], rows: [{name: 'A', delta: -50}, {name: 'B', delta: 120}, {name: 'C', delta: 30}]}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['diverging_bar']},
  {id: 'rule_total_composition', prompt: 'Bundle revenue by bundle and pet', source: {query: {metric: 'bundle_sales', dimension: 'bundle_by_pet', limit: 25}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['stacked_bar']},
  {id: 'rule_grouped', prompt: 'Revenue and units by item', source: {shape: {columns: [col('name', 'text', 'category'), col('a', 'PHP', 'measure'), col('b', 'PHP', 'measure')], rows: names(3).map((name, i) => ({name, a: 100 + i, b: 50 + i * 3}))}}, render: {tool: 'render_chart', y: ['a', 'b']}, blocks: ['chart'], forms: ['grouped_bar']},
  {id: 'rule_whole_not_pie', prompt: 'How do the four pets split revenue', source: {shape: {columns: [col('pet', 'text', 'category'), col('value', 'PHP', 'measure'), col('share', 'percent', 'share')], rows: [{pet: 'dog', value: 300, share: 30}, {pet: 'cat', value: 500, share: 50}, {pet: 'both', value: 200, share: 20}], measure: 'revenue'}}, render: {tool: 'render_chart'}, blocks: ['chart'], forms: ['stacked_bar']},

  // tier A: honored as asked
  {id: 'tierA_stacked_100', prompt: 'Show bundle revenue by pet as percentages of the whole (stacked 100%)', source: {query: {metric: 'bundle_sales', dimension: 'pet_type', limit: 25}}, render: {tool: 'render_chart', kind: 'stacked_bar_100'}, blocks: ['chart'], forms: ['stacked_bar_100'], tier: 'A', mode: 'user'},
  {id: 'tierA_line_over_time', prompt: 'Daily revenue as a line', source: {query: {metric: 'offline_revenue', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'line'}, blocks: ['chart'], forms: ['line'], tier: 'A', mode: 'user'},
  {id: 'tierA_area_over_time', prompt: 'Daily revenue as an area chart', source: {query: {metric: 'offline_revenue', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'area'}, blocks: ['chart'], forms: ['area'], tier: 'A', mode: 'user'},
  {id: 'tierA_bar_over_categories', prompt: 'Top 5 products as a bar chart', source: {query: {metric: 'top_products', range: 'last_week', limit: 5}}, render: {tool: 'render_chart', kind: 'bar'}, blocks: ['chart'], forms: ['bar'], tier: 'A', mode: 'user'},
  {id: 'tierA_vertical', prompt: 'Make the top 25 vertical', source: {query: {metric: 'top_products', limit: 25}}, render: {tool: 'render_chart', orientation: 'vertical'}, blocks: ['chart', 'table'], forms: ['bar'], orientation: 'vertical', tier: 'A'},

  // tier B: honored with an adjusted look and a note
  {id: 'tierB_pie_close_slices', prompt: 'Show the split as a pie', source: {shape: cats(4, [100, 98, 97, 96])}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['pie'], tier: 'B', note: /close in size/},

  // tier C: the nearest valid form, with a reason
  {id: 'tierC_line_over_categories', prompt: 'Show the top products as a line', source: {shape: cats(4)}, render: {tool: 'render_chart', kind: 'line'}, blocks: ['chart'], forms: ['bar'], tier: 'C', note: /You asked for line, but a line implies an order and these categories have none, so I used bar\./},
  {id: 'tierC_pie_of_negatives', prompt: 'Show the changes as a pie', source: {shape: {columns: [col('name', 'text', 'category'), col('revenue', 'PHP', 'measure')], rows: [{name: 'A', revenue: 100}, {name: 'B', revenue: -40}, {name: 'C', revenue: 60}]}}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['bar'], tier: 'C', note: /cannot show negative values/},
  {id: 'tierC_pie_of_non_parts', prompt: 'Show average order value by day as a pie', source: {shape: {columns: [col('name', 'text', 'category'), col('aov', 'PHP', 'measure')], rows: names(3).map((name, i) => ({name, aov: 400 + i})), measure: 'aov', measures: [{key: 'aov', label: 'AOV', kind: 'derived', unit: 'PHP', method: 'x'}]}}, render: {tool: 'render_chart', kind: 'pie'}, blocks: ['chart'], forms: ['bar'], tier: 'C', note: /do not add up to a whole/},
  {id: 'tierC_chart_of_one_number', prompt: 'Show total revenue as a bar chart', source: {query: {metric: 'offline_revenue', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'bar'}, blocks: ['kpi'], tier: 'C', note: /single number is a stat tile/},
  {id: 'tierC_area_of_several', prompt: 'Show revenue and orders per day as an area', source: {shape: {columns: [col('day', 'date', 'time'), col('a', 'PHP', 'measure'), col('b', 'PHP', 'measure')], rows: DAYS.map((day, i) => ({day, a: i, b: i * 2}))}}, render: {tool: 'render_chart', kind: 'area', y: ['a', 'b']}, blocks: ['chart'], forms: ['line'], tier: 'C', note: /hides the lower ones/},
  {id: 'tierC_grouped_of_one_measure', prompt: 'Show the top products side by side', source: {shape: cats(4)}, render: {tool: 'render_chart', kind: 'grouped_bar'}, blocks: ['chart'], forms: ['bar'], tier: 'C', note: /need two or more measures/},
  {id: 'tierC_diverging_without_baseline', prompt: 'Show the top products as a diverging bar', source: {shape: cats(4)}, render: {tool: 'render_chart', kind: 'diverging_bar'}, blocks: ['chart'], forms: ['bar'], tier: 'C', note: /needs values above and below a baseline/},
  {id: 'tierC_mixed_units', prompt: 'Show revenue and orders on one chart as bars', source: {query: {metric: 'offline_aov', dimension: 'day', range: 'last_week'}}, render: {tool: 'render_chart', kind: 'bar', y: ['revenue', 'orders']}, blocks: ['chart', 'chart'], forms: ['bar', 'bar'], tier: 'C', note: /different scales/},
];

// ---- running a row ------------------------------------------------------------------------------------------------------------

type Out = {ok?: boolean; error?: string; block?: string; blocks?: string[]; chosen?: {form: string; orientation: string | null; adjustments: string[]; mode: string}; also?: {form: string}[]};

async function run(c: VizCase): Promise<{out: Out; blocks: ChatBlock[]}> {
  const blocks: ChatBlock[] = [];
  const session = createReportSession();
  const ex = createExecutors({data: async () => goldenData(), now: EVAL_NOW, user: null, emitBlock: (b) => blocks.push(b), report: session});
  let source = 'r1';
  if ('query' in c.source) {
    const r = (await ex.query_metric?.({...BASE, limit: 5, ...c.source.query})) as {id: string; error?: string};
    if (r.error) throw new Error(`${c.id}: ${r.error}`);
    source = r.id;
  } else {
    const {columns, rows, measure, measures} = c.source.shape;
    const result: MetricResult = {
      id: 'r1', metric: 'top_products', dimension: 'none', columns, rows,
      meta: {
        source: 'live', range: {from: '2026-09-01', to: '2026-09-30', label: 'Sep 1 to Sep 30, 2026'}, dataFrom: null, dataTo: null, rowCount: rows.length, coverage: 'full', coveredFrom: null, coveredTo: null,
        caveats: [], share_basis: null, measure: measure ?? 'revenue', measures: measures ?? [], insights: [], checks: [], reliable: true,
      },
    };
    session.remember('r1', {...BASE}, result);
  }
  const r = c.render;
  const out =
    r.tool === 'render_table'
      ? await ex.render_table?.({block: 'new', source, columns: r.columns ?? ['auto'], title: 'T'})
      : r.tool === 'render_kpi'
        ? await ex.render_kpi?.({block: 'new', source, value: r.value, label: 'L', format: 'peso'})
        : await ex.render_chart?.({block: 'new', source, kind: r.kind ?? 'auto', orientation: r.orientation ?? 'auto', x: r.x ?? 'auto', y: r.y ?? ['auto'], title: 'T'});
  return {out: out as Out, blocks};
}

const FORM_WORDS = /\b(pies?|lines?|area|bars?|stacked|diverging|grouped|donut|percentages?|side by side)\b/i;
const DIRECTION_WORDS = /\b(horizontal|vertical|sideways)\b/i;

describe('viz-choice cases (Slice 6 #4)', () => {
  it('the table covers every design row and every recommendView rule and tier', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(35);
    const ids = new Set(CASES.map((c) => c.id));
    for (const id of ['daily_revenue', 'daily_revenue_and_orders', 'top5_by_revenue', 'payment_mix', 'total_revenue_tile', 'revenue_by_12_skus', 'bundles_by_pet', 'payment_mix_pie', 'sku_pie_12', 'one_chart', 'make_it_horizontal', 'everything_as_table']) expect(ids.has(id), id).toBe(true);
    expect(new Set(CASES.filter((c) => c.tier).map((c) => c.tier))).toEqual(new Set(['A', 'B', 'C']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const {out, blocks} = await run(c);
    expect(out.error, 'the render call was refused').toBeUndefined();
    expect(blocks.map((b) => b.kind)).toEqual(c.blocks);
    const charts = blocks.filter((b): b is ChartBlock => b.kind === 'chart');
    if (c.forms) expect(charts.map((b) => b.chosen.form)).toEqual(c.forms);
    // what the model is told equals what is drawn: the chart forms, then the table that carries the full list
    if (c.forms) expect([out.chosen?.form, ...(out.also ?? []).map((a) => a.form)]).toEqual([...c.forms, ...(c.blocks.includes('table') ? ['table'] : [])]);
    const first = charts[0];
    if (c.orientation) expect(first.chosen.orientation).toBe(c.orientation);
    if (c.mode) expect(first.chosen.mode).toBe(c.mode);
    if (c.note) expect((first?.chosen.adjustments ?? out.chosen?.adjustments ?? []).join(' ')).toMatch(c.note);
    if (c.folded !== undefined) expect(first.chart.folded).toEqual({count: c.folded, into: 'Other'});
    // a folded bar keeps a table twin with every row: the drawn head plus the folded tail
    if (first && c.folded !== undefined && first.chart.form === 'bar') expect(first.twin.rows).toHaveLength(first.chart.rows.length - 1 + c.folded);
  });

  it('kind and orientation are "auto" in every case whose prompt names no form or direction', () => {
    for (const c of CASES.filter((x) => x.render.tool === 'render_chart')) {
      const namesForm = FORM_WORDS.test(c.prompt);
      const namesDirection = DIRECTION_WORDS.test(c.prompt);
      if (namesForm) expect(c.render.kind ?? 'auto', `${c.id} names a form but passes auto`).not.toBe('auto');
      else expect(c.render.kind ?? 'auto', `${c.id}: "${c.prompt}" names no form`).toBe('auto');
      if (namesDirection) expect(c.render.orientation ?? 'auto', `${c.id} names a direction but passes auto`).not.toBe('auto');
      else expect(c.render.orientation ?? 'auto', `${c.id}: "${c.prompt}" names no direction`).toBe('auto');
    }
    // the auto cases really are most of the table
    expect(CASES.filter((c) => (c.render.kind ?? 'auto') === 'auto').length).toBeGreaterThanOrEqual(20);
  });

  it('the explicit forms in the table are the only ones that ask for a mode "user" chart', async () => {
    for (const c of CASES.filter((x) => x.render.tool === 'render_chart' && x.forms)) {
      const {blocks} = await run(c);
      const first = blocks.find((b): b is ChartBlock => b.kind === 'chart');
      expect(first?.chosen.mode, c.id).toBe((c.render.kind ?? 'auto') === 'auto' ? 'auto' : 'user');
    }
  });

  it('a standout category is accented (the top share is at least 40% and 1.5x the runner-up), and only then', () => {
    const emphasis = (shape: Shape) => {
      const result = {id: 'r1', metric: 'top_products', dimension: 'none', columns: shape.columns, rows: shape.rows, meta: {source: 'live', range: {from: '', to: '', label: ''}, dataFrom: null, dataTo: null, rowCount: shape.rows.length, coverage: 'full', coveredFrom: null, coveredTo: null, caveats: [], share_basis: null, measure: 'revenue', measures: [], insights: [], checks: [], reliable: true}} as MetricResult;
      const d = recommendView(result, {kind: 'auto', orientation: 'auto'}).decisions[0];
      return d.block === 'chart' ? d.emphasis : 'not a chart';
    };
    expect(emphasis(cats(5, [500, 100, 90, 80, 70]))).toBe('Item A');
    expect(emphasis(cats(5, [200, 190, 180, 170, 160]))).toBeNull();
  });
});
