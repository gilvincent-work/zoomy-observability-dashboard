import {describe, it, expect} from 'vitest';
import {periodDays, resolveCustomRange, websiteRangeMetrics, inRange} from '../src/custom-range';

// A period on PHT midnights (how the scheduled digest writes windows) and one on
// UTC midnights (how older archive rows were written — starts 08:00 PHT).
const PHT = {from: '2026-09-20T16:00:00.000Z', to: '2026-09-27T16:00:00.000Z'}; // Sep 21 .. Sep 27 PHT
const UTC = {from: '2026-08-13T00:00:00.000Z', to: '2026-09-13T00:00:00.000Z'}; // Aug 13 08:00 .. Sep 13 08:00 PHT

describe('periodDays', () => {
  it('is the first and last PH day the period touches', () => {
    expect(periodDays(PHT.from, PHT.to)).toEqual({min: '2026-09-21', max: '2026-09-27'});
    expect(periodDays(UTC.from, UTC.to)).toEqual({min: '2026-08-13', max: '2026-09-13'});
  });
});

describe('resolveCustomRange', () => {
  it('is null without both params, or with malformed ones', () => {
    expect(resolveCustomRange(PHT.from, PHT.to, undefined, '2026-09-23')).toBe(null);
    expect(resolveCustomRange(PHT.from, PHT.to, '2026-9-22', '2026-09-23')).toBe(null);
    expect(resolveCustomRange(PHT.from, PHT.to, 'nope', 'nope')).toBe(null);
  });

  it('turns PH days into an exclusive-end instant range', () => {
    expect(resolveCustomRange(PHT.from, PHT.to, '2026-09-22', '2026-09-23')).toEqual({
      from: '2026-09-21T16:00:00.000Z', to: '2026-09-23T16:00:00.000Z', fromDay: '2026-09-22', toDay: '2026-09-23',
    });
  });

  it('selecting the whole period reproduces the digest window exactly', () => {
    for (const w of [PHT, UTC]) {
      const {min, max} = periodDays(w.from, w.to);
      const r = resolveCustomRange(w.from, w.to, min, max);
      expect([r?.from, r?.to]).toEqual([w.from, w.to]);
    }
  });

  it('swaps a reversed range and clamps to the period', () => {
    const r = resolveCustomRange(PHT.from, PHT.to, '2026-09-30', '2026-09-25');
    expect([r?.from, r?.to, r?.fromDay, r?.toDay]).toEqual(['2026-09-24T16:00:00.000Z', PHT.to, '2026-09-25', '2026-09-27']);
  });

  it('is null when the range lies entirely outside the period', () => {
    expect(resolveCustomRange(PHT.from, PHT.to, '2026-10-01', '2026-10-05')).toBe(null);
  });
});

describe('websiteRangeMetrics (mirrors the batch sales.js formulas)', () => {
  const items = (arr: object[]) => JSON.stringify(arr);
  const orders = [
    // in range: 2 units @150 with a 20 line discount + 1 @100 → net 380, totalPrice 380
    {createdAt: '2026-09-22T02:00:00Z', totalPrice: '380.00', lineItems: items([
      {title: 'Beef Munchies', quantity: 2, price: '150.00', total_discount: '20.00'},
      {title: 'Cat Grass', quantity: 1, price: '100.00'},
    ])},
    // in range, order-level discount allocated to the line
    {createdAt: '2026-09-23T10:00:00Z', totalPrice: '135.50', lineItems: items([
      {title: 'Cat Grass', quantity: 1, price: '150.50', discount_allocations: [{amount: '15.00'}]},
    ])},
    // exactly at the exclusive end → out
    {createdAt: '2026-09-23T16:00:00.000Z', totalPrice: '999', lineItems: items([{title: 'X', quantity: 1, price: '999'}])},
    // before the start → out
    {createdAt: '2026-09-21T15:59:59Z', totalPrice: '999', lineItems: '[]'},
    // unparseable date / junk line items → ignored, never throws
    {createdAt: null, totalPrice: '5', lineItems: 'not json'},
  ];
  const range = {from: '2026-09-21T16:00:00.000Z', to: '2026-09-23T16:00:00.000Z'};

  it('computes revenue, orders, AOV = revenue ÷ orders, units', () => {
    expect(websiteRangeMetrics(orders, range).metrics).toEqual({
      revenue: 515.5, orders: 2, aov: 257.75, units: 4, adSpend: null, roas: null,
    });
  });

  it('ranks top products by net (discount-aware) revenue', () => {
    expect(websiteRangeMetrics(orders, range).topProducts).toEqual([
      {title: 'Beef Munchies', units: 2, revenue: 280},
      {title: 'Cat Grass', units: 2, revenue: 235.5},
    ]);
  });

  it('is null metrics (not zeros) when no order falls in range', () => {
    expect(websiteRangeMetrics(orders, {from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z'})).toEqual({metrics: null, topProducts: []});
  });

  it('inRange is [from, to)', () => {
    expect([inRange('2026-09-21T16:00:00.000Z', range), inRange('2026-09-23T16:00:00.000Z', range), inRange(null, range)]).toEqual([true, false, false]);
  });
});
