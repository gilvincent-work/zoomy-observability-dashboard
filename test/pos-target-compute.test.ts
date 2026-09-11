import {describe, it, expect} from 'vitest';
import {manilaDayStart, progress, todaysRevenue} from '../src/pos-target-compute';
import type {PosOrder} from '../src/pos-sales-types';

function order(over: Partial<PosOrder> & {id: string; created_at: string}): PosOrder {
  return {
    client_uuid: `${over.id}-uuid`,
    subtotal: 100,
    discount: null,
    total: 100,
    oversold: false,
    device_id: 'pos',
    payment_method: 'cash',
    customer_handle: null,
    status: 'completed',
    remarks: null,
    items: [{product_id: 'A', name: 'A', qty: 1, unit_price: 100, line_total: 100}],
    ...over,
  };
}

describe('manilaDayStart', () => {
  // Asia/Manila is UTC+8, so a Manila calendar day begins at 16:00 UTC the
  // previous day, NOT at 00:00 UTC.
  it('returns 16:00 UTC of the previous day for a mid-morning Manila instant', () => {
    // 2026-09-11T02:00Z = 10:00 Manila on Sep 11
    expect(manilaDayStart(new Date('2026-09-11T02:00:00Z')).toISOString()).toBe('2026-09-10T16:00:00.000Z');
  });

  it('treats the 00:00-08:00 UTC window as the same Manila day, not the previous one', () => {
    // 07:59 UTC = 15:59 Manila Sep 11 -> still Sep 11's start (Sep 10 16:00Z)
    expect(manilaDayStart(new Date('2026-09-11T07:59:00Z')).toISOString()).toBe('2026-09-10T16:00:00.000Z');
    // Exactly at the boundary: 16:00Z = 00:00 Manila Sep 11
    expect(manilaDayStart(new Date('2026-09-10T16:00:00Z')).toISOString()).toBe('2026-09-10T16:00:00.000Z');
    // One minute before the boundary is the previous Manila day
    expect(manilaDayStart(new Date('2026-09-10T15:59:00Z')).toISOString()).toBe('2026-09-09T16:00:00.000Z');
  });
});

describe('todaysRevenue', () => {
  const NOW = new Date('2026-09-11T02:00:00Z'); // 10:00 Manila Sep 11; day start = Sep 10 16:00Z

  it('counts sales after the Manila day start and excludes earlier ones', () => {
    const orders = [
      order({id: 'a', created_at: '2026-09-10T16:30:00Z', total: 500}), // 00:30 Manila Sep 11 -> today
      order({id: 'b', created_at: '2026-09-11T01:00:00Z', total: 300}), // 09:00 Manila Sep 11 -> today
      order({id: 'c', created_at: '2026-09-10T15:30:00Z', total: 999}), // 23:30 Manila Sep 10 -> not today
    ];
    // A UTC "today" (00:00Z) would wrongly drop 'a' and keep nothing before 00:00Z;
    // the Manila-day version keeps a + b (800) and excludes c.
    expect(todaysRevenue(orders, NOW)).toBe(800);
  });

  it('excludes voided sales', () => {
    const orders = [
      order({id: 'a', created_at: '2026-09-11T01:00:00Z', total: 500}),
      order({id: 'b', created_at: '2026-09-11T01:30:00Z', total: 400, status: 'voided'}),
    ];
    expect(todaysRevenue(orders, NOW)).toBe(500);
  });

  it('is 0 when there are no sales today', () => {
    expect(todaysRevenue([order({id: 'x', created_at: '2026-09-01T00:00:00Z'})], NOW)).toBe(0);
  });
});

describe('progress', () => {
  it('is empty and untargeted when target is 0', () => {
    const p = progress(1234, 0);
    expect(p).toMatchObject({hasTarget: false, pct: 0, rawPct: 0, remaining: 0, reached: false, tier: 'low'});
  });

  it('reports the low tier below 40%', () => {
    const p = progress(1999, 5000); // 39.98%
    expect(p.tier).toBe('low');
    expect(p.remaining).toBe(3001);
    expect(p.reached).toBe(false);
  });

  it('crosses into the mid tier at 40%', () => {
    expect(progress(2000, 5000).tier).toBe('mid'); // exactly 40%
  });

  it('crosses into the high tier at 75%', () => {
    expect(progress(3749, 5000).tier).toBe('mid');
    expect(progress(3750, 5000).tier).toBe('high'); // exactly 75%
  });

  it('reaches the goal at 100% with remaining clamped to 0', () => {
    const p = progress(5000, 5000);
    expect(p).toMatchObject({tier: 'goal', reached: true, remaining: 0, pct: 100, rawPct: 100});
  });

  it('clamps the fill at 100% but keeps rawPct past the goal', () => {
    const p = progress(6000, 5000); // 120%
    expect(p.pct).toBe(100);
    expect(p.rawPct).toBe(120);
    expect(p.remaining).toBe(0);
    expect(p.reached).toBe(true);
    expect(p.tier).toBe('goal');
  });
});
