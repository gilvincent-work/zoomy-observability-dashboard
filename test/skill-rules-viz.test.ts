import {describe, expect, it} from 'vitest';
import {assignColors, colorFor, isNeutral} from '../src/chat/entity-colors';
import {KPI_MAX, PIE_MAX_SEGMENTS, SERIES_FOLD_AT, TABLE_MIN_CLASSES, recommendView, type BlockDecision} from '../src/chat/recommend-view';
import {bindBlock} from '../src/chat/bind';
import {CHART_FIRST_TEXT, createRenderExecutors} from '../src/chat/render-executors';
import {createReportSession} from '../src/chat/report-session';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import type {ViewRequest} from '../src/chat/block-types';
import type {ColumnRole, ColumnUnit, MetricResult, MetricRow, ResultColumn} from '../src/chat/result-types';

// One real-behaviour test per rule the skill marks as enforced by code (titles start with the rule id). Synthetic data.
const col = (key: string, unit: ColumnUnit, role: ColumnRole, label = key): ResultColumn => ({key, label, unit, role});
function mk(columns: ResultColumn[], rows: MetricRow[]): MetricResult {
  return {
    id: 'r1', metric: 'top_products', dimension: 'none', columns, rows,
    meta: {
      source: 'live', range: {from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026'}, dataFrom: null, dataTo: null, rowCount: rows.length, coverage: 'full', coveredFrom: null, coveredTo: null,
      caveats: [], share_basis: null, measure: 'revenue', measures: [], insights: [], checks: [], reliable: true,
    },
  };
}
const AUTO: ViewRequest = {kind: 'auto', orientation: 'auto'};
const ask = (kind: ViewRequest['kind']): ViewRequest => ({kind, orientation: 'auto'});
// Geometric values: no two neighbours are close, so a pie of them needs no "close slices" note.
const cats = (n: number, values = (i: number) => Math.round(1000 * 0.6 ** i)) =>
  mk([col('name', 'text', 'category'), col('revenue', 'PHP', 'measure')], Array.from({length: n}, (_, i) => ({name: `Item ${i + 1}`, revenue: values(i)})));
const chart = (d: BlockDecision) => {
  if (d.block !== 'chart') throw new Error(`expected a chart, got ${d.block}`);
  return d;
};
const one = (n: number) => mk(Array.from({length: n}, (_, i) => col(`m${i}`, 'count', 'measure')), [Object.fromEntries(Array.from({length: n}, (_, i) => [`m${i}`, i + 1]))]);

describe('skill rules enforced by code: viz-forms', () => {
  it('VIZ-01: one value is a stat tile, and at most KPI_MAX tiles make a row', () => {
    const tiles = recommendView(one(KPI_MAX), AUTO).decisions[0];
    expect(tiles.block).toBe('kpi');
    expect(tiles.block === 'kpi' && tiles.tiles).toHaveLength(KPI_MAX);
    expect(recommendView(one(KPI_MAX + 1), AUTO).decisions[0].block).toBe('table');
    expect(recommendView(one(1), ask('bar')).decisions[0].block).toBe('kpi'); // even when a chart was asked for
  });

  it('VIZ-02: the form follows the job (size, time, per-category measures, parts of a whole, change)', () => {
    expect(chart(recommendView(cats(4), AUTO).decisions[0]).chart.form).toBe('bar');
    const time = mk([col('day', 'date', 'time'), col('revenue', 'PHP', 'measure')], [{day: '2026-09-01', revenue: 1}, {day: '2026-09-02', revenue: 2}]);
    expect(chart(recommendView(time, AUTO).decisions[0]).chart.form).toBe('area');
    const two = mk([col('c', 'text', 'category'), col('a', 'count', 'measure'), col('b', 'count', 'measure')], [{c: 'x', a: 1, b: 2}, {c: 'y', a: 3, b: 1}]);
    expect(chart(recommendView(two, AUTO, {y: ['a', 'b']}).decisions[0]).chart.form).toBe('grouped_bar');
    const whole = mk([col('c', 'text', 'category'), col('v', 'PHP', 'measure'), col('s', 'percent', 'share')], [{c: 'a', v: 60, s: 60}, {c: 'b', v: 40, s: 40}]);
    expect(chart(recommendView(whole, AUTO).decisions[0]).chart.form).toBe('stacked_bar');
    const change = mk([col('c', 'text', 'category'), col('delta', 'PHP', 'delta')], [{c: 'a', delta: -5}, {c: 'b', delta: 9}]);
    expect(chart(recommendView(change, AUTO).decisions[0]).chart.form).toBe('diverging_bar');
  });

  it('VIZ-03: more than TABLE_MIN_CLASSES categories give a table of every row plus a chart of the top few', () => {
    const r = cats(TABLE_MIN_CLASSES + 5);
    const {decisions} = recommendView(r, AUTO);
    expect(decisions.map((d) => d.block)).toEqual(['chart', 'table']);
    expect(decisions[1].block === 'table' && decisions[1].rows).toHaveLength(r.rows.length);
    expect(chart(decisions[0]).chart.rows.filter((x) => x.name !== 'Other')).toHaveLength(TABLE_MIN_CLASSES);
    expect(recommendView(cats(TABLE_MIN_CLASSES), AUTO).decisions).toHaveLength(1); // exactly the limit stays one chart
  });

  it('VIZ-04: measures on different scales become two charts, and no tool schema has an axis option', () => {
    const r = mk([col('c', 'text', 'category'), col('units', 'units', 'measure'), col('revenue', 'PHP', 'measure')], [{c: 'a', units: 1, revenue: 10}, {c: 'b', units: 2, revenue: 5}]);
    const {decisions} = recommendView(r, AUTO, {y: ['units', 'revenue']});
    expect(decisions).toHaveLength(2);
    for (const d of decisions) expect(chart(d).chart.series).toHaveLength(1);
    const keys = CHAT_TOOLS.flatMap((t) => Object.keys(t.input_schema.properties));
    expect(keys.filter((k) => /axis|secondary|dual/i.test(k))).toEqual([]);
    expect(JSON.stringify(CHAT_TOOLS)).not.toMatch(/secondary|dual.?axis/i);
  });

  it('VIZ-05: color follows the entity, No tag and Other are gray, and a status color is never a series', () => {
    expect(assignColors(['cat', 'both', 'dog'])).toEqual(assignColors(['dog', 'cat', 'both']));
    expect(colorFor('dog')).toBe(colorFor('Dog'));
    for (const e of ['No tag', 'Other', 'Untagged', 'untagged']) {
      expect(isNeutral(e)).toBe(true);
      expect(colorFor(e)).toBe('chart-5');
    }
    const wide = mk(
      [col('b', 'text', 'category'), col('dog', 'PHP', 'measure'), col('cat', 'PHP', 'measure'), col('both', 'PHP', 'measure'), col('untagged', 'PHP', 'measure'), col('total', 'PHP', 'measure')],
      [{b: 'x', dog: 1, cat: 2, both: 3, untagged: 4, total: 10}, {b: 'y', dog: 2, cat: 2, both: 2, untagged: 2, total: 8}],
    );
    const series = chart(recommendView(wide, AUTO).decisions[0]).chart.series;
    for (const s of series) expect(s.color).not.toMatch(/status|good|warn|crit|#/);
    expect(series.find((s) => s.entity === 'untagged')?.color).toBe('chart-5');
  });

  it('VIZ-06: auto never draws a pie; an explicit pie follows PIE_MAX_SEGMENTS, and two slices are never silent', () => {
    const whole = mk([col('c', 'text', 'category'), col('v', 'PHP', 'measure'), col('s', 'percent', 'share')], [{c: 'a', v: 50, s: 50}, {c: 'b', v: 30, s: 30}, {c: 'c', v: 20, s: 20}]);
    for (const r of [whole, cats(3), cats(20)]) {
      for (const d of recommendView(r, AUTO).decisions) expect(d.block === 'chart' && d.chart.form).not.toBe('pie');
    }
    const six = chart(recommendView(cats(PIE_MAX_SEGMENTS), ask('pie')).decisions[0]);
    expect(six.chart.series).toHaveLength(PIE_MAX_SEGMENTS);
    expect(six.chosen.adjustments).toEqual([]);
    const many = chart(recommendView(cats(PIE_MAX_SEGMENTS + 4), ask('pie')).decisions[0]);
    expect(many.chart.series.length).toBeLessThanOrEqual(PIE_MAX_SEGMENTS);
    const two = chart(recommendView(cats(2, (i) => 70 - i * 40), ask('pie')).decisions[0]);
    expect(two.chosen.adjustments.length).toBeGreaterThan(0);
  });

  it('VIZ-07: up to SERIES_FOLD_AT series are drawn, past it the tail folds into Other', () => {
    const t = (n: number) => {
      const ks = Array.from({length: n}, (_, i) => `s${i}`);
      return {ks, r: mk([col('day', 'date', 'time'), ...ks.map((k) => col(k, 'count', 'measure'))], ['2026-09-01', '2026-09-02'].map((day) => ({day, ...Object.fromEntries(ks.map((k, i) => [k, i + 1]))})))};
    };
    for (const n of [1, 3, 4, SERIES_FOLD_AT]) {
      const {ks, r} = t(n);
      expect(chart(recommendView(r, AUTO, {y: ks}).decisions[0]).chart.series).toHaveLength(n);
    }
    const {ks, r} = t(SERIES_FOLD_AT + 1);
    const d = chart(recommendView(r, AUTO, {y: ks}).decisions[0]);
    expect(d.chart.series).toHaveLength(SERIES_FOLD_AT);
    expect(d.chart.series.at(-1)?.entity).toBe('Other');
    expect(d.chart.folded?.into).toBe('Other');
  });

  it('VIZ-08: every chart decision has a table twin with every row and column, whatever was folded', () => {
    const cases: [MetricResult, ViewRequest][] = [[cats(4), AUTO], [cats(20), AUTO], [cats(20), ask('pie')], [cats(9), ask('stacked_bar')], [cats(5), ask('line')]];
    for (const [r, req] of cases) {
      for (const d of recommendView(r, req).decisions) {
        expect(d.twin.rows).toEqual(r.rows);
        expect(d.twin.columns).toEqual(r.columns);
      }
    }
    const blocks = bindBlock('render_chart', {block: 'new', source: 'r1', kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: ''}, new Map([['r1', cats(20)]]), () => 'b1');
    expect('blocks' in blocks && blocks.blocks[0].kind === 'chart' && blocks.blocks[0].twin.rows).toHaveLength(20);
  });
});

describe('skill rules enforced by code: preferences', () => {
  it('PREF-01: a valid request (tier A) is honored as asked, with no adjustment', () => {
    for (const [r, kind] of [[cats(4), 'pie'], [cats(5), 'bar'], [cats(4), 'stacked_bar_100']] as [MetricResult, ViewRequest['kind']][]) {
      const d = chart(recommendView(r, ask(kind)).decisions[0]);
      expect(d.chart.form).toBe(kind);
      expect(d.chosen).toMatchObject({mode: 'user', adjustments: []});
    }
    const horizontal = chart(recommendView(cats(3), {kind: 'auto', orientation: 'horizontal'}).decisions[0]);
    const vertical = chart(recommendView(cats(12), {kind: 'bar', orientation: 'vertical'}).decisions[0]);
    expect([horizontal.chart.orientation, vertical.chart.orientation]).toEqual(['horizontal', 'vertical']);
  });

  it('PREF-02: a request that would be unreadable (tier B) is honored with a fold and a note, and the twin keeps all rows', () => {
    const r = cats(PIE_MAX_SEGMENTS + 6);
    const d = chart(recommendView(r, ask('pie')).decisions[0]);
    expect(d.chart.form).toBe('pie');
    expect(d.chart.series).toHaveLength(PIE_MAX_SEGMENTS);
    expect(d.chart.folded).toMatchObject({into: 'Other'});
    expect(d.chosen.adjustments.join(' ')).toMatch(/Other/);
    expect(d.twin.rows).toHaveLength(r.rows.length);
  });

  it('PREF-03: a request that cannot be drawn truthfully (tier C) is replaced by the nearest valid form with a reason', () => {
    const line = chart(recommendView(cats(5), ask('line')).decisions[0]);
    expect(line.chart.form).toBe('bar');
    expect(line.chosen.reason).toMatch(/You asked for line.*so I used bar/);
    const negatives = chart(recommendView(cats(4, (i) => 50 - i * 40), ask('pie')).decisions[0]);
    expect(negatives.chart.form).toBe('bar');
    expect(negatives.chosen.adjustments[0]).toMatch(/negative/);
    const single = recommendView(one(1), ask('pie')).decisions[0];
    expect(single.block).toBe('kpi');
    expect(single.chosen.adjustments[0]).toMatch(/stat tile/);
    const mixed = mk([col('c', 'text', 'category'), col('u', 'units', 'measure'), col('r', 'PHP', 'measure')], [{c: 'a', u: 1, r: 2}, {c: 'b', u: 2, r: 1}]);
    expect(recommendView(mixed, ask('bar'), {y: ['u', 'r']}).decisions).toHaveLength(2);
  });
});

describe('VIZ-12', () => {
  it('VIZ-12: the default is a visual: a table of chartable data comes after a chart, a table-only request is refused once then honored', async () => {
    const result = cats(5);
    const session = createReportSession();
    session.store.set('r1', result);
    const ex = createRenderExecutors({data: async () => ({}) as never, now: new Date('2026-10-01T04:00:00Z'), user: null}, session);
    const table = {block: 'new', source: 'r1', columns: ['auto'], title: 'T'};
    expect(await ex.render_table?.(table)).toEqual({error: CHART_FIRST_TEXT});
    expect(await ex.render_table?.(table)).toMatchObject({ok: true}); // the owner asked for only a table: repeated unchanged
    const ex2 = createRenderExecutors({data: async () => ({}) as never, now: new Date('2026-10-01T04:00:00Z'), user: null}, session);
    expect(await ex2.render_chart?.({block: 'new', source: 'r1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'C'})).toMatchObject({ok: true});
    expect(await ex2.render_table?.(table)).toMatchObject({ok: true}); // a companion after the chart
  });
});
