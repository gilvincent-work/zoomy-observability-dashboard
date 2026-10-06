// Live Ask Coop test 7 (G14): weekday + orders + revenue + share (7 rows, sorted by revenue) was drawn as ONE stacked bar with 7 weekday
// series, titled "Orders by Weekday". A result with one category column and several measures is a bar per category, ONE measure, row order kept.
import {describe, expect, it} from 'vitest';
import {bindBlock} from '../src/chat/bind';
import {shapeResult} from '../src/chat/explore/result';
import {DEFAULT_EXPLORE_LIMITS} from '../src/chat/explore/limits';

const DAYS: [string, number, number][] = [['Saturday', 31, 18200.5], ['Sunday', 26, 15100], ['Friday', 22, 11800], ['Wednesday', 15, 7400], ['Thursday', 14, 6900], ['Tuesday', 12, 5100], ['Monday', 9, 3500]];
const TOTAL = DAYS.reduce((s, d) => s + d[2], 0);
const live = () => {
  const raw = {
    columns: [{name: 'weekday', type: 'text' as const}, {name: 'orders_count', type: 'number' as const}, {name: 'revenue_php', type: 'number' as const}, {name: 'share_pct', type: 'number' as const}],
    rows: DAYS.map(([d, o, r]) => [d, o, r, Math.round((r / TOTAL) * 1000) / 10]), fetched: 7, ms: 1,
  };
  const out = shapeResult({raw, validated: {sql: 'select 1', relations: [], lints: []}, limits: DEFAULT_EXPLORE_LIMITS, id: 'x1'});
  if (!out.ok) throw new Error('shape');
  return out.result;
};
const chartOf = (title = '') => {
  const store = new Map([['x1', live()]]);
  const out = bindBlock('render_chart', {source: 'x1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title}, store, () => 'b1');
  if ('error' in out) throw new Error(out.error);
  return out.blocks;
};

describe('J2 one category column, several measures', () => {
  it('draws a bar per weekday in the SQL row order with ONE series: revenue (the peso measure), never the share', () => {
    const [b, ...rest] = chartOf();
    expect(rest).toEqual([]);
    if (b.kind !== 'chart') throw new Error('chart expected');
    expect(b.chart.form).toBe('bar');
    expect(b.chart.x.key).toBe('weekday');
    expect(b.chart.series.map((s) => s.key)).toEqual(['revenue_php']);
    expect(b.chart.rows.map((r) => r.weekday)).toEqual(DAYS.map((d) => d[0]));
    expect(b.title).toBe('Revenue (PHP) by Weekday');
    expect(b.twin.rows).toHaveLength(7);
  });

  it('a title that names a measure picks it', () => {
    const [b] = chartOf('Orders by weekday');
    if (b.kind !== 'chart') throw new Error('chart expected');
    expect(b.chart.series.map((s) => s.key)).toEqual(['orders_count']);
    expect(b.chart.rows.map((r) => r.weekday)).toEqual(DAYS.map((d) => d[0]));
  });
});
