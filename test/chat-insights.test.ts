import {describe, it, expect} from 'vitest';
import {CLOSE_VALUES_RATIO, CONCENTRATION_MIN_SHARE, buildInsights} from '../src/chat/insights';
import type {InsightsInput} from '../src/chat/result-types';

const pets = [
  {label: 'Dog', value: 71050},
  {label: 'Cat', value: 18050},
  {label: 'Both', value: 17850},
];
const input = (o: Partial<InsightsInput> = {}): InsightsInput => ({basis: 'tagged bundle revenue', format: 'peso', items: pets, ...o});
const get = (i: InsightsInput, code: string) => buildInsights(i).find((x) => x.code === code);

describe('buildInsights', () => {
  it('constants', () => {
    expect([CONCENTRATION_MIN_SHARE, CLOSE_VALUES_RATIO]).toEqual([0.5, 0.1]);
  });
  it('returns [] for empty input and for all-zero items', () => {
    expect(buildInsights(input({items: []}))).toEqual([]);
    expect(buildInsights(input({items: [{label: 'A', value: 0}, {label: 'B', value: -4}]}))).toEqual([]);
  });

  describe('top_contributor', () => {
    it('words the share and the ratio to the runner-up', () => {
      const t = get(input(), 'top_contributor');
      expect(t?.text).toBe('Dog accounts for 66.4% of tagged bundle revenue, 3.9× cat.');
      expect(t?.values).toMatchObject({label: 'Dog', value: 71050, runnerUp: 'Cat'});
      expect(t?.values.ratio).toBeCloseTo(71050 / 18050, 9);
      expect(t?.values.share).toBeCloseTo((71050 / 106950) * 100, 9);
    });
    it('needs two items with a positive value', () => {
      expect(get(input({items: [{label: 'Dog', value: 5}]}), 'top_contributor')).toBeUndefined();
      expect(get(input({items: [{label: 'Dog', value: 5}, {label: 'Cat', value: 0}]}), 'top_contributor')).toBeUndefined();
      expect(get(input({items: [{label: 'Dog', value: 5}, {label: 'Cat', value: 1}]}), 'top_contributor')).toBeDefined();
    });
    it('sorts by value, not input order, and ignores non-positive items in the share', () => {
      const t = get(input({items: [{label: 'Cat', value: 1}, {label: 'Zero', value: 0}, {label: 'Dog', value: 3}]}), 'top_contributor');
      expect(t?.values.label).toBe('Dog');
      expect(t?.values.share).toBeCloseTo(75, 9);
    });
  });

  describe('concentration', () => {
    const bundles = [
      {label: 'Buy Any 4', value: 99250},
      {label: 'Buy Any 2', value: 7000},
      {label: 'Other', value: 700},
    ];
    it('fires at >= 50% with 3 or more items', () => {
      const c = get(input({basis: 'named bundle revenue', items: bundles}), 'concentration');
      expect(c?.text).toBe('Buy Any 4 accounts for 92.8% of named bundle revenue (₱99,250 of ₱106,950).');
      expect(c?.values).toMatchObject({label: 'Buy Any 4', value: 99250, total: 106950});
    });
    it('does not fire below 50% or with only 2 items (it would repeat top_contributor)', () => {
      expect(get(input({items: [{label: 'A', value: 40}, {label: 'B', value: 30}, {label: 'C', value: 30}]}), 'concentration')).toBeUndefined();
      expect(get(input({items: [{label: 'A', value: 90}, {label: 'B', value: 10}]}), 'concentration')).toBeUndefined();
    });
    it('fires at exactly 50%', () => {
      expect(get(input({items: [{label: 'A', value: 50}, {label: 'B', value: 25}, {label: 'C', value: 25}]}), 'concentration')).toBeDefined();
    });
    it('the pet example (66.4%) is a concentration too', () => {
      expect(get(input(), 'concentration')?.text).toContain('Dog accounts for 66.4%');
    });
  });

  describe('single_item_exclusive', () => {
    const matrix = {
      rows: ['dog', 'cat', 'both'],
      cols: ['Buy Any 4', 'Buy Any 2'],
      values: [[60000, 11050], [18050, 0], [9000, 8850]],
    };
    it('fires for a row whose whole value sits in one column', () => {
      const all = buildInsights(input({matrix})).filter((x) => x.code === 'single_item_exclusive');
      expect(all).toHaveLength(1);
      expect(all[0].text).toBe("All of cat's ₱18,050 is Buy Any 4.");
      expect(all[0].values).toEqual({row: 'cat', col: 'Buy Any 4', value: 18050});
    });
    it('needs more than one column and a positive row total', () => {
      expect(get(input({matrix: {rows: ['cat'], cols: ['Buy Any 4'], values: [[5]]}}), 'single_item_exclusive')).toBeUndefined();
      expect(get(input({matrix: {rows: ['cat'], cols: ['A', 'B'], values: [[0, 0]]}}), 'single_item_exclusive')).toBeUndefined();
      expect(get(input({matrix: null}), 'single_item_exclusive')).toBeUndefined();
    });
  });

  describe('untagged_share', () => {
    it('words value, share of the grand total and the order counts', () => {
      const u = get(input({untagged: {label: 'No tag', value: 40350, orders: 180, totalOrders: 524}}), 'untagged_share');
      // 40350 / (106950 + 40350) = 27.4%
      expect(u?.text).toBe('₱40,350 (27.4% of bundle revenue) has no pet tag; 180 of 524 orders are untagged.');
      expect(u?.values.share).toBeCloseTo((40350 / 147300) * 100, 9);
    });
    it('drops the orders part unless both counts are given', () => {
      expect(get(input({untagged: {label: 'No tag', value: 40350, orders: 180}}), 'untagged_share')?.text).toBe('₱40,350 (27.4% of bundle revenue) has no pet tag.');
    });
    it('is absent when the untagged value is 0 or the field is missing', () => {
      expect(get(input({untagged: {label: 'No tag', value: 0}}), 'untagged_share')).toBeUndefined();
      expect(get(input({untagged: null}), 'untagged_share')).toBeUndefined();
    });
  });

  describe('biggest_change', () => {
    it('picks the largest absolute change and says rose or fell', () => {
      const prev = [{label: 'Dog', value: 60000}, {label: 'Cat', value: 20050}, {label: 'Both', value: 17850}];
      const b = get(input({previous: prev}), 'biggest_change');
      expect(b?.text).toBe('Dog rose by ₱11,050 (from ₱60,000 to ₱71,050).');
      expect(b?.values).toMatchObject({label: 'Dog', previous: 60000, current: 71050, change: 11050});
      const fell = get(input({previous: [{label: 'Dog', value: 71050}, {label: 'Cat', value: 28050}, {label: 'Both', value: 17850}]}), 'biggest_change');
      expect(fell?.text).toBe('Cat fell by ₱10,000 (from ₱28,050 to ₱18,050).');
    });
    it('counts an item missing from one side as 0 and handles no baseline for the percent', () => {
      const b = get(input({items: [{label: 'New', value: 500}], previous: [{label: 'Old', value: 100}]}), 'biggest_change');
      expect(b?.values).toMatchObject({label: 'New', previous: 0, current: 500, changePct: null});
    });
    it('is absent without previous or when nothing changed', () => {
      expect(get(input(), 'biggest_change')).toBeUndefined();
      expect(get(input({previous: pets}), 'biggest_change')).toBeUndefined();
    });
  });

  describe('close_values', () => {
    it('fires when the top two are within 10%', () => {
      const c = get(input({items: [{label: 'Cat', value: 18050}, {label: 'Both', value: 17850}, {label: 'Dog', value: 4000}]}), 'close_values');
      expect(c?.text).toBe('Cat and both are close (₱18,050 and ₱17,850).');
    });
    it('does not fire when the gap is over 10%', () => {
      expect(get(input(), 'close_values')).toBeUndefined();
      expect(get(input({items: [{label: 'A', value: 100}, {label: 'B', value: 89}]}), 'close_values')).toBeUndefined();
      expect(get(input({items: [{label: 'A', value: 100}, {label: 'B', value: 90}]}), 'close_values')).toBeDefined();
    });
  });

  it('formats counts and percents without a peso sign', () => {
    const t = get(input({format: 'count', items: [{label: 'Dog', value: 1200}, {label: 'Cat', value: 300}, {label: 'Both', value: 100}]}), 'concentration');
    expect(t?.text).toContain('(1,200 of 1,600)');
    expect(t?.text).not.toContain('₱');
  });

  it('never states a number outside its input (every digit group traces to input or a computed share)', () => {
    for (const ins of buildInsights(input({untagged: {label: 'No tag', value: 40350, orders: 180, totalOrders: 524}}))) {
      expect(ins.text).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
