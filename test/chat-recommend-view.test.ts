import {describe, expect, it} from 'vitest';
import {
  KPI_MAX, PIE_MAX_SEGMENTS, SERIES_FOLD_AT, STANDOUT_RATIO, STANDOUT_SHARE, TABLE_MIN_CLASSES, TIME_SINGLE_FORM, recommendView,
  type BlockDecision,
} from '../src/chat/recommend-view';
import type {ViewRequest} from '../src/chat/block-types';
import type {ColumnRole, ColumnUnit, MetricResult, MetricRow, ResultColumn} from '../src/chat/result-types';

// Synthetic results only (fictional names and figures).
const col = (key: string, unit: ColumnUnit, role: ColumnRole, label = key): ResultColumn => ({key, label, unit, role});
function mk(columns: ResultColumn[], rows: MetricRow[], over: Partial<MetricResult['meta']> = {}): MetricResult {
  return {
    id: 'r1', metric: 'top_products', dimension: 'none', columns, rows,
    meta: {
      source: 'live', range: {from: '2026-09-01', to: '2026-09-30', label: 'Sep 1 to Sep 30, 2026'}, dataFrom: null, dataTo: null, rowCount: rows.length, coverage: 'full',
      coveredFrom: null, coveredTo: null, caveats: [], share_basis: null, measure: 'revenue', measures: [], insights: [], checks: [], reliable: true, ...over,
    },
  };
}
const AUTO: ViewRequest = {kind: 'auto', orientation: 'auto'};
const ask = (kind: ViewRequest['kind'], orientation: ViewRequest['orientation'] = 'auto'): ViewRequest => ({kind, orientation});
const names = (n: number, prefix = 'Item') => Array.from({length: n}, (_, i) => `${prefix} ${String.fromCharCode(65 + i)}`);

const cat = (n: number, values?: number[], label = 'Item') =>
  mk([col('name', 'text', 'category'), col('revenue', 'PHP', 'measure', 'Revenue')], names(n, label).map((name, i) => ({name, revenue: values?.[i] ?? 1000 - i * 50})));

const first = (r: MetricResult, req: ViewRequest = AUTO, pick?: {x?: string; y?: string[]; title?: string}): BlockDecision => recommendView(r, req, pick).decisions[0];
const chartOf = (d: BlockDecision) => {
  if (d.block !== 'chart') throw new Error(`expected a chart, got ${d.block}`);
  return d;
};

describe('constants', () => {
  it('are the documented untuned estimates', () => {
    expect([KPI_MAX, PIE_MAX_SEGMENTS, TABLE_MIN_CLASSES, SERIES_FOLD_AT, STANDOUT_SHARE, STANDOUT_RATIO]).toEqual([4, 6, 7, 7, 0.4, 1.5]);
    expect(TIME_SINGLE_FORM).toBe('area');
  });
});

describe('one row -> stat tiles', () => {
  const one = mk(
    [col('rev', 'PHP', 'measure', 'Revenue'), col('orders', 'count', 'measure', 'Orders'), col('share', 'percent', 'share', 'Share')],
    [{rev: 12000, orders: 30, share: 41.5}],
  );
  it('auto draws tiles with the unit-derived format, never a chart', () => {
    const d = first(one);
    expect(d.block).toBe('kpi');
    if (d.block !== 'kpi') return;
    expect(d.tiles.map((t) => [t.key, t.value, t.format])).toEqual([['rev', 12000, 'peso'], ['orders', 30, 'count'], ['share', 41.5, 'percent']]);
    expect(d.chosen.form).toBe('kpi');
  });
  it('an explicit chart of one number becomes tiles with a reason (tier C)', () => {
    const d = first(one, ask('bar'));
    expect(d.block).toBe('kpi');
    expect(d.chosen.mode).toBe('user');
    expect(d.chosen.adjustments.join(' ')).toMatch(/single number is a stat tile/);
  });
  it('more than KPI_MAX numbers become a table', () => {
    const wide = mk(Array.from({length: KPI_MAX + 1}, (_, i) => col(`m${i}`, 'count', 'measure')), [Object.fromEntries(Array.from({length: KPI_MAX + 1}, (_, i) => [`m${i}`, i]))]);
    expect(first(wide).block).toBe('table');
  });
  it('a null value stays null (never 0)', () => {
    const d = first(mk([col('a', 'PHP', 'measure')], [{a: null}]));
    expect(d.block === 'kpi' && d.tiles[0].value).toBeNull();
  });
});

describe('time series', () => {
  const days = ['2026-09-03', '2026-09-01', '2026-09-02'];
  it('one series is an area, chronological', () => {
    const r = mk([col('day', 'date', 'time', 'Day'), col('revenue', 'PHP', 'measure', 'Revenue')], days.map((day, i) => ({day, revenue: 100 * (i + 1)})));
    const d = chartOf(first(r));
    expect(d.chart.form).toBe('area');
    expect(d.chart.rows.map((x) => x.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(d.chart.orientation).toBe('vertical');
  });
  it('two series (same unit) are lines', () => {
    const r = mk([col('day', 'date', 'time'), col('a', 'PHP', 'measure'), col('b', 'PHP', 'measure')], days.map((day, i) => ({day, a: i, b: i * 2})));
    const d = chartOf(first(r, AUTO, {y: ['a', 'b']}));
    expect(d.chart.form).toBe('line');
    expect(d.chart.series).toHaveLength(2);
  });
  it('uses the measure the query asked for when the result carries several units', () => {
    const r = mk([col('day', 'date', 'time'), col('orders', 'count', 'measure'), col('revenue', 'PHP', 'measure')], days.map((day, i) => ({day, orders: i, revenue: i * 100})));
    const d = chartOf(first(r));
    expect(d.chart.series.map((s) => s.key)).toEqual(['revenue']);
  });
});

describe('magnitude across categories', () => {
  it('5 short categories: a descending bar, vertical', () => {
    const d = chartOf(first(cat(5, [30, 50, 10, 40, 20])));
    expect(d.chart.form).toBe('bar');
    expect(d.chart.rows.map((r) => r.revenue)).toEqual([50, 40, 30, 20, 10]);
    expect(d.chart.orientation).toBe('vertical');
    expect(d.chart.series[0].color).toBe('chart-1');
  });
  it('more than 5 categories or a long label goes horizontal', () => {
    expect(chartOf(first(cat(6))).chart.orientation).toBe('horizontal');
    const long = mk([col('name', 'text', 'category'), col('revenue', 'PHP', 'measure')], [{name: 'A very long product name', revenue: 5}, {name: 'Short', revenue: 4}]);
    expect(chartOf(first(long)).chart.orientation).toBe('horizontal');
  });
  it('12 categories: a table of all rows plus a top-7 bar with "Other" and a note', () => {
    const r = cat(12);
    const {decisions} = recommendView(r, AUTO);
    expect(decisions.map((d) => d.block)).toEqual(['chart', 'table']);
    const c = chartOf(decisions[0]);
    expect(c.chart.rows).toHaveLength(TABLE_MIN_CLASSES + 1);
    expect(c.chart.rows[TABLE_MIN_CLASSES].name).toBe('Other');
    expect(c.chart.folded).toEqual({count: 5, into: 'Other'});
    expect(c.chosen.adjustments.join(' ')).toMatch(/all 12 rows/);
    expect(c.twin.rows).toHaveLength(12);
    expect(decisions[1].block === 'table' && decisions[1].rows).toHaveLength(12);
    const other = c.chart.rows[TABLE_MIN_CLASSES].revenue as number;
    expect(other).toBe(r.rows.slice(TABLE_MIN_CLASSES).reduce((s, x) => s + (x.revenue as number), 0));
  });
  it('a non-additive measure folds without an "Other" row', () => {
    const r = mk([col('name', 'text', 'category'), col('aov', 'PHP', 'measure')], names(10).map((name, i) => ({name, aov: 100 - i})), {
      measure: 'aov', measures: [{key: 'aov', label: 'AOV', kind: 'derived', unit: 'PHP', method: 'x'}],
    });
    const c = chartOf(first(r));
    expect(c.chart.rows).toHaveLength(TABLE_MIN_CLASSES);
    expect(c.chart.folded).toBeNull();
  });
  it('emphasis only for a standout: share and ratio thresholds', () => {
    expect(chartOf(first(cat(4, [700, 100, 100, 100]))).emphasis).toBe('Item A');
    expect(chartOf(first(cat(4, [300, 290, 280, 270]))).emphasis).toBeNull();
    expect(chartOf(first(cat(3, [45, 35, 20]))).emphasis).toBeNull(); // share 0.45 but only 1.29x the runner-up
  });
});

describe('part to whole', () => {
  const whole = mk(
    [col('pet', 'text', 'category', 'Pet'), col('value', 'PHP', 'measure', 'Revenue'), col('share', 'percent', 'share')],
    [{pet: 'dog', value: 650, share: 5}, {pet: 'cat', value: 10150, share: 78.4}, {pet: 'both', value: 2150, share: 16.6}, {pet: 'untagged', value: 6600, share: null}],
    {measure: 'revenue'},
  );
  it('auto is a horizontal stacked bar (never a pie): entity colors, and No tag as its own neutral bar', () => {
    const d = chartOf(first(whole));
    expect(d.chart.form).toBe('stacked_bar');
    expect(d.chart.orientation).toBe('horizontal');
    const colors = Object.fromEntries(d.chart.series.map((s) => [s.entity, s.color]));
    expect(colors.untagged).toBe('chart-5');
    expect(new Set([colors.dog, colors.cat, colors.both]).size).toBe(3);
    expect(d.chart.rows).toHaveLength(2);
    expect(d.chart.rows[0]).toMatchObject({dog: 650, cat: 10150, both: 2150});
    expect(d.chart.rows[1]).toMatchObject({untagged: 6600});
    expect(d.twin.rows).toHaveLength(4);
  });
  it('explicit pie on 4 segments is honored (tier A)', () => {
    const d = chartOf(first(whole, ask('pie')));
    expect(d.chart.form).toBe('pie');
    expect(d.chosen.mode).toBe('user');
    expect(d.chosen.adjustments).toEqual([]);
    expect(d.chart.rows).toHaveLength(1);
    expect(d.chart.series).toHaveLength(4);
  });
  it('explicit stacked_bar_100 is honored', () => {
    expect(chartOf(first(whole, ask('stacked_bar_100'))).chart.form).toBe('stacked_bar_100');
  });
  it('explicit pie on 12 categories folds to 5 + Other (6 slices), with a note, and the twin keeps all 12', () => {
    const d = chartOf(first(cat(12), ask('pie')));
    expect(d.chart.form).toBe('pie');
    expect(d.chart.series).toHaveLength(PIE_MAX_SEGMENTS);
    expect(d.chart.series.map((s) => s.entity)).toContain('Other');
    expect(d.chart.series.find((s) => s.entity === 'Other')?.color).toBe('chart-5');
    expect(d.chart.folded).toEqual({count: 7, into: 'Other'});
    expect(d.chosen.adjustments.join(' ')).toMatch(/Other/);
    expect(d.twin.rows).toHaveLength(12);
  });
  it('a pie of exactly 2 slices is honored with a note that a bar is clearer', () => {
    const d = chartOf(first(cat(2, [70, 30]), ask('pie')));
    expect(d.chart.form).toBe('pie');
    expect(d.chosen.adjustments.join(' ')).toMatch(/bar/);
  });
  it('a pie with close slices is honored with a note', () => {
    const d = chartOf(first(cat(4, [100, 99, 98, 20]), ask('pie')));
    expect(d.chart.form).toBe('pie');
    expect(d.chosen.adjustments.join(' ')).toMatch(/close/);
  });
  it('a pie of negatives or of non-parts becomes a bar with a reason (tier C)', () => {
    const neg = chartOf(first(cat(4, [100, -50, 30, 20]), ask('pie')));
    expect(neg.chart.form).toBe('bar');
    expect(neg.chosen.adjustments.join(' ')).toMatch(/negative/);
    const pct = mk([col('name', 'text', 'category'), col('rate', 'percent', 'measure')], names(4).map((name, i) => ({name, rate: 10 + i})));
    const d = chartOf(first(pct, ask('pie')));
    expect(d.chart.form).toBe('bar');
    expect(d.chosen.adjustments.join(' ')).toMatch(/add up to a whole/);
  });
});

describe('wide results', () => {
  const wide = mk(
    [col('bundle', 'text', 'category'), col('dog', 'PHP', 'measure'), col('cat', 'PHP', 'measure'), col('both', 'PHP', 'measure'), col('untagged', 'PHP', 'measure'), col('total', 'PHP', 'measure')],
    [
      {bundle: 'Buy Any 2', dog: 100, cat: 200, both: 50, untagged: 150, total: 500},
      {bundle: 'Buy Any 4', dog: 300, cat: 100, both: 100, untagged: 200, total: 700},
    ],
    {measure: 'total'},
  );
  it('measures that add up to a total are a stacked bar in absolute values, without the total as a series', () => {
    const d = chartOf(first(wide));
    expect(d.chart.form).toBe('stacked_bar');
    expect(d.chart.series.map((s) => s.key)).toEqual(['dog', 'cat', 'both', 'untagged']);
    expect(d.chart.series.find((s) => s.key === 'untagged')?.color).toBe('chart-5');
    expect(d.chart.rows.map((r) => r.bundle)).toEqual(['Buy Any 4', 'Buy Any 2']);
    expect(d.chart.rows[0]).not.toHaveProperty('total');
  });
  it('two or three series with no total are grouped bars', () => {
    const g = mk([col('m', 'text', 'category'), col('a', 'count', 'measure'), col('b', 'count', 'measure')], [{m: 'x', a: 1, b: 2}, {m: 'y', a: 3, b: 4}]);
    expect(chartOf(first(g, AUTO, {y: ['a', 'b']})).chart.form).toBe('grouped_bar');
  });
});

describe('change versus a baseline', () => {
  it('delta columns give a diverging bar', () => {
    const r = mk(
      [col('name', 'text', 'category'), col('revenue', 'PHP', 'measure'), col('delta', 'PHP', 'delta', 'Change'), col('delta_pct', 'percent', 'delta')],
      [{name: 'a', revenue: 5, delta: -20, delta_pct: -10}, {name: 'b', revenue: 9, delta: 40, delta_pct: 30}],
    );
    const d = chartOf(first(r));
    expect(d.chart.form).toBe('diverging_bar');
    expect(d.chart.series.map((s) => s.key)).toEqual(['delta']);
  });
});

describe('mixed units', () => {
  const r = mk([col('name', 'text', 'category'), col('units', 'units', 'measure'), col('revenue', 'PHP', 'measure')], names(4).map((name, i) => ({name, units: 10 - i, revenue: 900 - i * 100})));
  it('explicit y fields on different scales become two charts with no shared axis', () => {
    const {decisions} = recommendView(r, AUTO, {y: ['units', 'revenue']});
    expect(decisions.map((d) => d.block)).toEqual(['chart', 'chart']);
    const keys = decisions.map((d) => chartOf(d).chart.series.map((s) => s.key));
    expect(keys).toEqual([['units'], ['revenue']]);
    for (const d of decisions) expect(d.chosen.adjustments.join(' ')).toMatch(/different scales/);
    for (const d of decisions) expect(chartOf(d).twin.columns).toHaveLength(3);
  });
});

describe('unordered categories and other tier C', () => {
  it('an explicit line over categories becomes a bar with a reason', () => {
    const d = chartOf(first(cat(5), ask('line')));
    expect(d.chart.form).toBe('bar');
    expect(d.chosen.mode).toBe('user');
    expect(d.chosen.reason).toMatch(/line implies an order/);
  });
  it('an explicit line or area over time is honored', () => {
    const t = mk([col('day', 'date', 'time'), col('revenue', 'PHP', 'measure')], [{day: '2026-09-01', revenue: 1}, {day: '2026-09-02', revenue: 2}]);
    expect(chartOf(first(t, ask('line'))).chart.form).toBe('line');
    expect(chartOf(first(t, ask('area'))).chart.form).toBe('area');
    expect(chartOf(first(t, ask('line'))).chosen.adjustments).toEqual([]);
  });
  it('an explicit grouped bar of one measure becomes a bar with a reason', () => {
    expect(chartOf(first(cat(4), ask('grouped_bar'))).chart.form).toBe('bar');
  });
  it('an explicit diverging bar without a baseline becomes the auto form with a reason', () => {
    const d = chartOf(first(cat(4), ask('diverging_bar')));
    expect(d.chart.form).toBe('bar');
    expect(d.chosen.reason).toMatch(/above and below/);
  });
});

describe('orientation', () => {
  it('explicit orientation is always honored on bars, even when auto would choose the other', () => {
    expect(chartOf(first(cat(3), ask('auto', 'horizontal'))).chart.orientation).toBe('horizontal');
    expect(chartOf(first(cat(10), ask('bar', 'vertical'))).chart.orientation).toBe('vertical');
  });
  it('does not apply to a line, with a note', () => {
    const t = mk([col('day', 'date', 'time'), col('revenue', 'PHP', 'measure')], [{day: '2026-09-01', revenue: 1}, {day: '2026-09-02', revenue: 2}]);
    const d = chartOf(first(t, ask('line', 'horizontal')));
    expect(d.chart.orientation).toBe('vertical');
    expect(d.chosen.adjustments.join(' ')).toMatch(/does not apply/);
  });
});

describe('series ladder', () => {
  const series = (n: number) => Array.from({length: n}, (_, i) => `s${i}`);
  const t = (n: number) =>
    mk([col('day', 'date', 'time'), ...series(n).map((k) => col(k, 'count', 'measure'))], ['2026-09-01', '2026-09-02', '2026-09-03'].map((day, d) => ({day, ...Object.fromEntries(series(n).map((k, i) => [k, (i + 1) * (d + 1)]))})));
  it('up to SERIES_FOLD_AT series are drawn as they are', () => {
    const n = SERIES_FOLD_AT;
    const d = chartOf(first(t(n), AUTO, {y: series(n)}));
    expect(d.chart.series).toHaveLength(n);
    expect(d.chart.folded).toBeNull();
    expect(new Set(d.chart.series.map((s) => s.color)).size).toBe(n);
  });
  it('past SERIES_FOLD_AT the tail folds into Other (top 6 + Other) and the twin keeps every column', () => {
    const n = SERIES_FOLD_AT + 2;
    const d = chartOf(first(t(n), AUTO, {y: series(n)}));
    expect(d.chart.series).toHaveLength(SERIES_FOLD_AT);
    expect(d.chart.series.at(-1)?.entity).toBe('Other');
    expect(d.chart.series.at(-1)?.color).toBe('chart-5');
    expect(d.chart.folded).toEqual({count: 3, into: 'Other'});
    expect(d.twin.columns).toHaveLength(n + 1);
  });
});

describe('degenerate shapes', () => {
  it('no rows or no category is a table', () => {
    expect(first(cat(0)).block).toBe('table');
    expect(first(mk([col('a', 'count', 'measure')], [{a: 1}, {a: 2}])).block).toBe('table');
  });
  it('every chart carries a twin with ALL rows and columns', () => {
    for (const r of [cat(5), cat(12), cat(3)]) {
      for (const kind of ['auto', 'bar', 'pie', 'stacked_bar'] as const) {
        for (const d of recommendView(r, ask(kind)).decisions) {
          expect(d.twin.rows).toEqual(r.rows);
          expect(d.twin.columns).toEqual(r.columns);
        }
      }
    }
  });
});

describe('an explicit pie on a result with several measures (owner report: pie + AOV on channels)', () => {
  const channels = mk(
    [col('channel', 'text', 'category', 'Channel'), col('revenue', 'PHP', 'measure', 'Revenue'), col('orders', 'count', 'measure', 'Orders'), col('aov', 'PHP', 'measure', 'Average order value')],
    [{channel: 'Shopee', revenue: 18400.5, orders: 41, aov: 448.8}, {channel: 'Lazada', revenue: 26250, orders: 52, aov: 504.81}, {channel: 'Website', revenue: 9120, orders: 14, aov: 651.43}],
    {measure: 'revenue', measures: [{key: 'revenue', kind: 'measured'}, {key: 'orders', kind: 'measured'}, {key: 'aov', kind: 'derived'}] as never},
  );
  it('"a pie of the sales on each channel" gives ONE pie of revenue (the primary measure), not a grouped bar or two charts', () => {
    const out = recommendView(channels, ask('pie'));
    expect(out.decisions).toHaveLength(1);
    const d = chartOf(out.decisions[0]);
    expect(d.chart.form).toBe('pie');
    expect(d.chart.series.map((s) => s.label).sort()).toEqual(['Lazada', 'Shopee', 'Website']);
    expect(d.chart.series.map((s) => (s.unit))).toEqual(['PHP', 'PHP', 'PHP']); // revenue, never orders or AOV
  });
  it('naming the measure still wins, and a bar of AOV is its own chart', () => {
    expect(chartOf(first(channels, ask('pie'), {y: ['orders']})).chart.form).toBe('pie');
    const bar = chartOf(first(channels, ask('bar'), {y: ['aov']}));
    expect(bar.chart.form).toBe('bar');
    expect(bar.chart.series.map((s) => s.key)).toEqual(['aov']);
  });
});

// Live finding (Ask Coop G01, second live run): an Explore result with TWO dimensions (event, pet) and two measures drew ORDERS under a revenue title,
// every bar labelled with the repeated event name, and folded 8 rows into "Other". Shape below is exactly that result.
describe('two dimensions and two measures (Explore event by pet)', () => {
  const live = mk(
    [col('event', 'text', 'category', 'Event'), col('pet', 'text', 'category', 'Pet'), col('orders_count', 'count', 'measure', 'Orders'), col('revenue_php', 'PHP', 'measure', 'Revenue')],
    [
      {event: 'SM Aura Pet Fair', pet: 'dog', orders_count: 3, revenue_php: 2100},
      {event: 'SM Aura Pet Fair', pet: 'cat', orders_count: 2, revenue_php: 1300},
      {event: 'Circuit Makati Pet Day', pet: 'dog', orders_count: 2, revenue_php: 900},
      {event: 'Circuit Makati Pet Day', pet: 'cat', orders_count: 1, revenue_php: 450},
      {event: 'Modern Pet Expo', pet: 'dog', orders_count: 1, revenue_php: 600},
      {event: 'Modern Pet Expo', pet: 'cat', orders_count: 1, revenue_php: 500},
      {event: 'Greenhills Bazaar', pet: 'dog', orders_count: 1, revenue_php: 250},
      {event: 'Greenhills Bazaar', pet: null, orders_count: 1, revenue_php: 180},
    ],
    {measure: 'sql'},
  );

  it('plots the measure the title names, event on x, the second dimension as series, nothing folded', () => {
    const d = chartOf(first(live, AUTO, {title: 'Event revenue by pet tag'}));
    expect(['grouped_bar', 'stacked_bar']).toContain(d.chart.form);
    expect(d.chart.x.key).toBe('event');
    expect(d.chart.series.map((s) => s.label).sort()).toEqual(['No tag', 'cat', 'dog']);
    expect(d.chart.series.every((s) => s.unit === 'PHP')).toBe(true);
    expect(d.chart.folded).toBeNull();
    expect(d.chart.rows).toHaveLength(4);
    expect(JSON.stringify(d.chart.rows)).not.toContain('Other');
    const aura = d.chart.rows.find((r) => r.event === 'SM Aura Pet Fair')!;
    expect(aura.dog).toBe(2100);
    expect(aura.cat).toBe(1300);
    expect(recommendView(live, AUTO, {title: 'Event revenue by pet tag'}).decisions).toHaveLength(1);
  });

  it('without a title hint it prefers the first peso measure, never silently orders', () => {
    const d = chartOf(first(live));
    expect(d.chart.series.every((s) => s.unit === 'PHP')).toBe(true);
  });

  it('a title naming orders picks the orders measure', () => {
    const d = chartOf(first(live, AUTO, {title: 'Orders by event and pet'}));
    expect(d.chart.series.every((s) => s.unit === 'count')).toBe(true);
  });

  it('keeps every row of a long list in the table twin and folds only past the limit', () => {
    const many = mk(live.columns, Array.from({length: 9}, (_, i) => ({event: `Event ${i}`, pet: 'dog', orders_count: 1, revenue_php: 100 + i})).concat(Array.from({length: 9}, (_, i) => ({event: `Event ${i}`, pet: 'cat', orders_count: 1, revenue_php: 50 + i}))), {measure: 'sql'});
    const d = chartOf(first(many));
    expect(d.chart.rows.length).toBe(TABLE_MIN_CLASSES + 1);
    expect(d.chart.folded?.count).toBe(2);
    expect(d.twin.rows).toHaveLength(18);
  });

  it('an explicit x or a pie keeps the old single-dimension behaviour', () => {
    const d = chartOf(first(live, AUTO, {x: 'event', y: ['revenue_php']}));
    expect(d.chart.series).toHaveLength(1);
  });
});
