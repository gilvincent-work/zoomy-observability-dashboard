import {describe, expect, it} from 'vitest';
import {formTimeliness, storeHealth, storeMovement, type Count} from './goldline-movement';
import type {InventoryRowIn} from './goldline-inventory';

const r = (item_code: string, onHand: number | null, delivery: number | null = null): InventoryRowIn => ({
  item_code,
  stockroom: onHand,
  drawer: null,
  selling_area: null,
  delivery,
  ending_on_hand: null,
});
const count = (start: string, end: string, rows: InventoryRowIn[]): Count => ({period_start: start, period_end: end, rows});

describe('storeMovement', () => {
  it('estimates sold per cycle from consecutive counts (+ delivery) and derives cover', () => {
    const m = storeMovement([
      count('2026-09-16', '2026-09-30', [r('A', 30)]),
      count('2026-09-01', '2026-09-15', [r('A', 50)]),
      count('2026-10-01', '2026-10-15', [r('A', 15, 5)]),
    ]);
    const a = m.items[0];
    expect(m.latest?.period_end).toBe('2026-10-15');
    expect(a.cyclesSold).toEqual([20, 20]); // 50→30, then 30+5→15
    expect(a.velocity).toBe(20);
    expect(a.coverDays).toBeCloseTo(15 / (20 / 15)); // 11.25 days
    expect(a.status).toBe('watch'); // ≥ 10 days, ≤ one 15-day cycle
    expect(a.stockOutDate).toBe('2026-10-26');
    expect(a.suggestedOrder).toBe(25); // 2 cycles × 20 − 15
  });

  it('flags reorder under 10 days and out at zero', () => {
    const m = storeMovement([count('2026-09-16', '2026-09-30', [r('A', 40), r('B', 10)]), count('2026-10-01', '2026-10-15', [r('A', 5), r('B', 0)])]);
    expect(m.items.find((i) => i.item_code === 'A')?.status).toBe('reorder');
    expect(m.items.find((i) => i.item_code === 'B')?.status).toBe('out');
  });

  it('needs two counts for history; blank is not counted', () => {
    const m = storeMovement([count('2026-10-01', '2026-10-15', [r('A', 12), r('B', null)])]);
    expect(m.items.find((i) => i.item_code === 'A')).toMatchObject({status: 'no_history', velocity: null, suggestedOrder: 0});
    expect(m.items.find((i) => i.item_code === 'B')?.status).toBe('not_counted');
  });

  it('spots dead stock, spikes, and counts that rose without a delivery', () => {
    const m = storeMovement([
      count('2026-09-01', '2026-09-15', [r('D', 9), r('S', 40), r('U', 10)]),
      count('2026-09-16', '2026-09-30', [r('D', 9), r('S', 36), r('U', 10)]),
      count('2026-10-01', '2026-10-15', [r('D', 9), r('S', 20), r('U', 18)]),
    ]);
    expect(m.items.find((i) => i.item_code === 'D')?.deadStock).toBe(true);
    expect(m.items.find((i) => i.item_code === 'S')?.anomaly).toEqual({kind: 'spike', sold: 16, usual: 4});
    expect(m.items.find((i) => i.item_code === 'U')?.anomaly).toEqual({kind: 'rose_without_delivery', by: 8});
  });
});

describe('formTimeliness', () => {
  it('on time within 3 days of the period end', () => {
    expect(formTimeliness('2026-10-15', '2026-10-18T09:00:00Z')).toBe('on_time');
    expect(formTimeliness('2026-10-15', '2026-10-20T09:00:00Z')).toBe('late');
    expect(formTimeliness(null, null)).toBe('missing');
  });
});

describe('storeHealth', () => {
  it('scores in-stock, cover, live stock and form timeliness', () => {
    const m = storeMovement([count('2026-09-16', '2026-09-30', [r('A', 40), r('B', 10)]), count('2026-10-01', '2026-10-15', [r('A', 30), r('B', 0)])]);
    const h = storeHealth(m, () => 100, 'on_time');
    expect(h.inStockRate).toBe(0.5);
    expect(h.out).toBe(1);
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThan(100);
  });
  it('has no score without a count for the period', () => {
    expect(storeHealth(storeMovement([]), () => 1, 'missing').score).toBeNull();
  });
});
