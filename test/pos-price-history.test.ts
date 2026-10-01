import {describe, it, expect} from 'vitest';
import {buildPriceHistory, priceAt, priceChangesInRange} from '../src/pos-price-history';
import {CHANGES, PRICES} from './support/bundle-fixture';

const h = buildPriceHistory(PRICES, CHANGES);

describe('priceAt', () => {
  it('returns the seed price between the seed and the first real change', () => {
    expect(priceAt(h, 'p1', '2026-08-01T00:00:00+08:00')).toBe(170);
    expect(priceAt(h, 'p1', '2026-09-07T23:59:59+08:00')).toBe(170);
  });
  it('switches exactly at each change instant and holds until the next', () => {
    expect(priceAt(h, 'p1', '2026-09-08T00:00:00+08:00')).toBe(200);
    expect(priceAt(h, 'p1', '2026-09-14T23:59:59+08:00')).toBe(200);
    expect(priceAt(h, 'p1', '2026-09-15T00:00:00+08:00')).toBe(240);
    expect(priceAt(h, 'p1', '2026-09-21T23:59:59+08:00')).toBe(240);
    expect(priceAt(h, 'p1', '2026-09-22T00:00:00+08:00')).toBe(200);
    expect(priceAt(h, 'p1', '2027-01-01T00:00:00+08:00')).toBe(200);
  });
  it('before the earliest change uses its old price, or its new price when it is the seed', () => {
    expect(priceAt(h, 'p1', '2026-01-01T00:00:00+08:00')).toBe(170); // seed: old_price null -> new_price
    const h2 = buildPriceHistory([{product_id: 'x', price: 90}], [{product_id: 'x', old_price: 80, new_price: 90, changed_at: '2026-09-10T00:00:00Z'}]);
    expect(priceAt(h2, 'x', '2026-09-01T00:00:00Z')).toBe(80);
    expect(priceAt(h2, 'x', '2026-09-10T00:00:00Z')).toBe(90);
  });
  it('compares instants, not strings, across offsets', () => {
    // 2026-09-07T16:00:00Z is 2026-09-08T00:00:00+08:00 exactly
    expect(priceAt(h, 'p1', '2026-09-07T16:00:00Z')).toBe(200);
    expect(priceAt(h, 'p1', '2026-09-07T15:59:59Z')).toBe(170);
  });
  it('uses the current price when a product has no changes, null when unknown', () => {
    expect(priceAt(h, 'p3', '2026-09-10T00:00:00+08:00')).toBe(120);
    expect(priceAt(h, 'nope', '2026-09-10T00:00:00+08:00')).toBeNull();
  });
  it('sorts unordered change rows', () => {
    const shuffled = buildPriceHistory(PRICES, [CHANGES[2], CHANGES[0], CHANGES[3], CHANGES[1]]);
    expect(priceAt(shuffled, 'p1', '2026-09-16T00:00:00+08:00')).toBe(240);
  });
});

describe('priceChangesInRange', () => {
  it('counts real changes in the window and skips the seed row', () => {
    const all = priceChangesInRange(h, '2026-07-01T00:00:00+08:00', '2026-09-30T23:59:59+08:00');
    expect(all.count).toBe(3);
    expect(priceChangesInRange(h, '2026-09-01T00:00:00+08:00', '2026-09-10T00:00:00+08:00').count).toBe(1);
    expect(priceChangesInRange(h, '2026-09-23T00:00:00+08:00', '2026-09-30T00:00:00+08:00').count).toBe(0);
  });
  it('includes both ends and reports whole days, min 1', () => {
    expect(priceChangesInRange(h, '2026-09-08T00:00:00+08:00', '2026-09-15T00:00:00+08:00').count).toBe(2);
    expect(priceChangesInRange(h, '2026-09-01T00:00:00+08:00', '2026-09-20T00:00:00+08:00').spanDays).toBe(19);
    expect(priceChangesInRange(h, '2026-09-01T00:00:00+08:00', '2026-09-01T06:00:00+08:00').spanDays).toBe(1);
  });
});
