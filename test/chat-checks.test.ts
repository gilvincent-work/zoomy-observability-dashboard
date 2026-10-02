import {describe, it, expect} from 'vitest';
import {ROUND_ROW_PAGE, SMALL_SAMPLE_N, SUDDEN_CHANGE_PCT, UNTAGGED_WARN_SHARE, runChecks} from '../src/chat/checks';
import type {ChecksInput} from '../src/chat/result-types';

const base: ChecksInput = {
  mockSource: false,
  bulkReads: [],
  reconcile: [],
  zeroValueLines: null,
  priceChanges: null,
  sampleSize: null,
  untagged: null,
  coverage: {from: '2026-09-07', to: '2026-09-27', dataFrom: '2026-09-01', dataTo: '2026-09-30'},
  change: null,
};
const codes = (i: Partial<ChecksInput>) => runChecks({...base, ...i}).map((c) => c.code);
const one = (i: Partial<ChecksInput>, code: string) => runChecks({...base, ...i}).find((c) => c.code === code);

describe('runChecks', () => {
  it('returns nothing for a clean input', () => {
    expect(runChecks(base)).toEqual([]);
  });
  it('constants', () => {
    expect([SMALL_SAMPLE_N, UNTAGGED_WARN_SHARE, SUDDEN_CHANGE_PCT, ROUND_ROW_PAGE]).toEqual([30, 0.1, 50, 1000]);
  });

  describe('reconciles', () => {
    it('ok on an exact peso match, with the formatted whole', () => {
      const c = one({reconcile: [{label: 'Pet totals vs bundle total', parts: [71050, 18050, 17850, 40350], whole: 147300}]}, 'reconciles');
      expect(c?.status).toBe('ok');
      expect(c?.text).toContain('₱147,300');
    });
    it('compares in whole centavos: float-noisy parts still reconcile', () => {
      const c = one({reconcile: [{label: 'x', parts: [0.1, 0.2], whole: 0.3}]}, 'reconciles');
      expect(c?.status).toBe('ok');
    });
    it('fails on a 1 centavo gap at the default zero tolerance and names label and gap', () => {
      const c = one({reconcile: [{label: 'Pet totals', parts: [100, 50.01], whole: 150}]}, 'reconciles');
      expect(c?.status).toBe('fail');
      expect(c?.text).toContain('Pet totals');
      expect(c?.text).toContain('₱0.01');
      expect(c?.values?.gap).toBeCloseTo(0.01, 9);
    });
    it('honours a peso tolerance and counts', () => {
      expect(one({reconcile: [{label: 'x', parts: [10], whole: 10.05, tolerance: 0.05}]}, 'reconciles')?.status).toBe('ok');
      expect(one({reconcile: [{label: 'orders', parts: [5, 6], whole: 12, format: 'count'}]}, 'reconciles')?.status).toBe('fail');
      expect(one({reconcile: [{label: 'orders', parts: [5, 6], whole: 11, format: 'count'}]}, 'reconciles')?.text).toContain('11');
    });
    it('percent uses 0.1 tolerance by default', () => {
      const r = (parts: number[]) => one({reconcile: [{label: 'shares', parts, whole: 100, format: 'percent'}]}, 'reconciles');
      expect(r([66.4, 33.6])?.status).toBe('ok');
      expect(r([66.4, 33.55])?.status).toBe('ok'); // gap 0.05
      expect(r([66.4, 33.4])?.status).toBe('fail'); // gap 0.2
      expect(r([66.4, 33.4])?.text).toContain('99.8%');
    });
    it('one check per entry', () => {
      expect(codes({reconcile: [{label: 'a', parts: [1], whole: 1}, {label: 'b', parts: [1], whole: 2}]})).toEqual(['reconciles', 'reconciles']);
    });
  });

  describe('round_row_count', () => {
    it('fires for 1000 and 2000, not for 999, 1500 or 0', () => {
      expect(one({bulkReads: [{relation: 'pos_orders', rows: 1000}]}, 'round_row_count')?.text).toContain('exactly 1,000 rows');
      expect(codes({bulkReads: [{relation: 'a', rows: 2000}]})).toEqual(['round_row_count']);
      expect(codes({bulkReads: [{relation: 'a', rows: 999}, {relation: 'b', rows: 1500}, {relation: 'c', rows: 0}]})).toEqual([]);
    });
    it('is info', () => {
      expect(one({bulkReads: [{relation: 'a', rows: 1000}]}, 'round_row_count')?.status).toBe('info');
    });
  });

  describe('zero_value_lines', () => {
    it('fires only with a count and an allocated measure in use', () => {
      expect(one({zeroValueLines: {count: 1043, allocatedMeasureUsed: true}}, 'zero_value_lines')?.text).toBe('1,043 bundle pick lines carry ₱0; allocated pesos used.');
      expect(codes({zeroValueLines: {count: 5, allocatedMeasureUsed: false}})).toEqual([]);
      expect(codes({zeroValueLines: {count: 0, allocatedMeasureUsed: true}})).toEqual([]);
    });
  });

  describe('price_changed_in_period', () => {
    it('fires when count > 0 only', () => {
      expect(one({priceChanges: {count: 37, spanDays: 19}}, 'price_changed_in_period')?.text).toBe('37 list-price changes in 19 days; each sale valued at its sale-date price.');
      expect(codes({priceChanges: {count: 0, spanDays: 19}})).toEqual([]);
    });
  });

  describe('small_sample', () => {
    it('warns under 30, not at exactly 30, not when null', () => {
      expect(one({sampleSize: 12}, 'small_sample')?.status).toBe('warn');
      expect(one({sampleSize: 12}, 'small_sample')?.text).toBe('Only 12 orders in this slice.');
      expect(codes({sampleSize: 29})).toEqual(['small_sample']);
      expect(codes({sampleSize: 30})).toEqual([]);
      expect(codes({sampleSize: null})).toEqual([]);
    });
  });

  describe('untagged_share', () => {
    it('warns above 10% with the counts in the text', () => {
      expect(one({untagged: {orders: 180, totalOrders: 524}}, 'untagged_share')?.text).toBe('34% of orders (180 of 524) have no pet tag.');
    });
    it('does not warn at exactly 10% or below, or with no orders', () => {
      expect(codes({untagged: {orders: 10, totalOrders: 100}})).toEqual([]);
      expect(codes({untagged: {orders: 11, totalOrders: 100}})).toEqual(['untagged_share']);
      expect(codes({untagged: {orders: 0, totalOrders: 0}})).toEqual([]);
    });
  });

  describe('partial_coverage', () => {
    it('does not fire when the range is inside the data', () => {
      expect(codes({})).toEqual([]);
    });
    it('warns when either edge sticks out and states what the data covers', () => {
      const c = one({coverage: {from: '2026-08-20', to: '2026-09-27', dataFrom: '2026-09-11', dataTo: '2026-09-27'}}, 'partial_coverage');
      expect(c?.status).toBe('warn');
      expect(c?.text).toBe('Data covers Sep 11, 2026 to Sep 27, 2026 only.');
      expect(codes({coverage: {from: '2026-09-11', to: '2026-10-05', dataFrom: '2026-09-11', dataTo: '2026-09-27'}})).toEqual(['partial_coverage']);
    });
    it('is a warn, not a fail, when the range has no data', () => {
      const c = one({coverage: {from: '2026-01-01', to: '2026-01-31', dataFrom: '2026-09-11', dataTo: '2026-09-27'}}, 'partial_coverage');
      expect(c?.status).toBe('warn');
      expect(c?.text).toContain('no data in that range');
    });
    it('says there is no data when dataFrom is null', () => {
      const c = one({coverage: {from: '2026-01-01', to: '2026-01-31', dataFrom: null, dataTo: null}}, 'partial_coverage');
      expect(c?.status).toBe('warn');
      expect(c?.text).toContain('no data');
    });
  });

  describe('sudden_change', () => {
    it('warns on a big move from a small base', () => {
      expect(one({change: {previous: 3, current: 9}}, 'sudden_change')?.text).toContain('rose from 3 to 9');
      expect(one({change: {previous: 10, current: 3}}, 'sudden_change')?.text).toContain('fell from 10 to 3');
    });
    it('does not warn at exactly 50%, on a base of 30 or more, or with no comparison', () => {
      expect(codes({change: {previous: 10, current: 15}})).toEqual([]);
      expect(codes({change: {previous: 30, current: 90}})).toEqual([]);
      expect(codes({change: null})).toEqual([]);
    });
    it('handles a zero base without dividing by zero', () => {
      expect(codes({change: {previous: 0, current: 2}})).toEqual(['sudden_change']);
      expect(codes({change: {previous: 0, current: 0}})).toEqual([]);
    });
  });

  describe('mock_source', () => {
    it('fails only for mock data', () => {
      const c = one({mockSource: true}, 'mock_source');
      expect(c?.status).toBe('fail');
      expect(c?.text).toBe('This is sample data.');
      expect(codes({mockSource: false})).toEqual([]);
    });
  });

  it('orders fail, warn, info, ok, then by code', () => {
    const out = runChecks({
      ...base,
      mockSource: true,
      sampleSize: 5,
      untagged: {orders: 50, totalOrders: 100},
      priceChanges: {count: 2, spanDays: 7},
      bulkReads: [{relation: 'a', rows: 1000}],
      reconcile: [{label: 'ok one', parts: [1], whole: 1}],
    });
    expect(out.map((c) => `${c.status}:${c.code}`)).toEqual([
      'fail:mock_source',
      'warn:small_sample',
      'warn:untagged_share',
      'info:price_changed_in_period',
      'info:round_row_count',
      'ok:reconciles',
    ]);
  });

  it('every check carries a values object', () => {
    const out = runChecks({
      ...base, mockSource: true, sampleSize: 5, untagged: {orders: 50, totalOrders: 100}, priceChanges: {count: 2, spanDays: 7},
      bulkReads: [{relation: 'a', rows: 1000}], reconcile: [{label: 'r', parts: [1], whole: 1}],
      zeroValueLines: {count: 3, allocatedMeasureUsed: true}, change: {previous: 3, current: 9},
      coverage: {from: '2026-01-01', to: '2026-01-02', dataFrom: null, dataTo: null},
    });
    expect(out).toHaveLength(9);
    for (const c of out) expect(c.values).toBeDefined();
  });

  it('is pure: the same input gives the same output', () => {
    const i = {...base, sampleSize: 3};
    expect(runChecks(i)).toEqual(runChecks(i));
  });
});
