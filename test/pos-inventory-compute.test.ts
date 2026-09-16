import {describe, it, expect} from 'vitest';
import {
  salesByProductMonth,
  manilaMonthKey,
  categoryRank,
  subcategoryRank,
  compareByCategory,
} from '../src/pos-inventory-compute';
import type {PosOrder} from '../src/pos-sales-types';

const NOW = new Date('2026-05-20T04:00:00Z'); // May 2026, noon Manila

function order(over: Partial<PosOrder> & {created_at: string; items: PosOrder['items']}): PosOrder {
  return {
    id: 'o', client_uuid: 'c', subtotal: 0, discount: null, total: 0, oversold: false,
    device_id: null, payment_method: 'cash', customer_handle: null, status: 'completed',
    remarks: null, edited_at: null, event_id: null, pet_type: null, ...over,
  };
}
const line = (product_id: string, qty: number) => ({product_id, name: product_id, qty, unit_price: 10, line_total: 10 * qty});

describe('manilaMonthKey', () => {
  it('returns the Manila calendar month', () => {
    expect(manilaMonthKey('2026-05-20T04:00:00Z')).toBe('2026-05');
    // 2026-04-30 20:00 UTC is 2026-05-01 04:00 Manila
    expect(manilaMonthKey('2026-04-30T20:00:00Z')).toBe('2026-05');
  });
});

describe('salesByProductMonth', () => {
  const orders = [
    order({created_at: '2026-05-10T04:00:00Z', items: [line('A', 21), line('B', 3)]}), // this month
    order({created_at: '2026-04-10T04:00:00Z', items: [line('A', 17)]}), // last month
    order({created_at: '2026-03-10T04:00:00Z', items: [line('A', 14)]}), // 2 months ago
    order({created_at: '2026-01-10T04:00:00Z', items: [line('A', 99)]}), // outside window
    order({created_at: '2026-05-11T04:00:00Z', items: [line('A', 4)], status: 'voided'}), // voided, skip
  ];

  it('buckets units into this / last / two-months-ago and totals three', () => {
    const a = salesByProductMonth(orders, NOW).get('A')!;
    expect(a.thisMonth).toBe(21);
    expect(a.lastMonth).toBe(17);
    expect(a.twoMonthsAgo).toBe(14);
    expect(a.threeMonthTotal).toBe(52);
    expect(a.trend).toEqual([14, 17, 21]);
  });
  it('excludes voided orders and sales outside the 3-month window', () => {
    const a = salesByProductMonth(orders, NOW).get('A')!;
    expect(a.threeMonthTotal).toBe(52); // 99 (Jan) and 4 (voided) excluded
  });
  it('tracks each product independently', () => {
    const b = salesByProductMonth(orders, NOW).get('B')!;
    expect(b.thisMonth).toBe(3);
    expect(b.threeMonthTotal).toBe(3);
  });

  it('venue filter: only counts sales tagged to the given events', () => {
    const tagged = [
      order({created_at: '2026-05-10T04:00:00Z', event_id: 'e1', items: [line('A', 10)]}),
      order({created_at: '2026-05-11T04:00:00Z', event_id: 'e2', items: [line('A', 5)]}),
      order({created_at: '2026-05-12T04:00:00Z', event_id: null, items: [line('A', 7)]}),
    ];
    expect(salesByProductMonth(tagged, NOW, new Set(['e1'])).get('A')!.thisMonth).toBe(10);
    expect(salesByProductMonth(tagged, NOW, new Set(['e1', 'e2'])).get('A')!.thisMonth).toBe(15);
  });
  it("venue filter 'unattributed' counts only sales with no event", () => {
    const mixed = [
      order({created_at: '2026-05-10T04:00:00Z', event_id: 'e1', items: [line('A', 10)]}),
      order({created_at: '2026-05-12T04:00:00Z', event_id: null, items: [line('A', 7)]}),
    ];
    expect(salesByProductMonth(mixed, NOW, 'unattributed').get('A')!.thisMonth).toBe(7);
  });
});

describe('category sort', () => {
  it('ranks known categories by taxonomy order, null last', () => {
    expect(categoryRank('Freeze Dried')).toBe(0);
    expect(categoryRank('Tasty Treats')).toBe(3);
    expect(categoryRank(null)).toBe(4);
    expect(categoryRank('Nonsense')).toBe(4);
  });
  it('ranks subcategories by order, null after', () => {
    expect(subcategoryRank('Fish')).toBe(0);
    expect(subcategoryRank(null)).toBe(4);
  });
  it('orders Freeze Dried (and its subcats) first, then other lines, uncategorized last', () => {
    const rows = [
      {category: 'Tasty Treats', subcategory: null, name: 'Jerky'},
      {category: null, subcategory: null, name: 'Mystery'},
      {category: 'Freeze Dried', subcategory: 'Meats', name: 'Duck'},
      {category: 'Freeze Dried', subcategory: 'Fish', name: 'Salmon'},
      {category: 'Meaty Treats', subcategory: null, name: 'Beef'},
    ];
    const sorted = [...rows].sort(compareByCategory).map((r) => r.name);
    expect(sorted).toEqual(['Salmon', 'Duck', 'Beef', 'Jerky', 'Mystery']);
  });
});
