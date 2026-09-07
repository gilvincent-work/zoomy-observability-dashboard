import {describe, it, expect} from 'vitest';
import {
  computeKpis,
  filterOrdersByRange,
  isSalesRange,
  offlineChannelFacts,
  offlineCompareMetrics,
  rangeStart,
  salesByDay,
  stockAlerts,
  topProducts,
} from '../src/pos-sales-compute';
import type {PosOrder} from '../src/pos-sales-types';
import type {PosProductRow} from '../src/pos-types';

const NOW = new Date('2026-09-07T12:00:00.000Z');

function order(over: Partial<PosOrder> & {id: string; created_at: string}): PosOrder {
  return {
    subtotal: 100,
    discount: null,
    total: 100,
    oversold: false,
    device_id: 'pos',
    items: [{product_id: 'A', name: 'A', qty: 1, unit_price: 100, line_total: 100}],
    ...over,
  };
}

describe('isSalesRange / rangeStart', () => {
  it('validates range strings', () => {
    expect(isSalesRange('7d')).toBe(true);
    expect(isSalesRange('nope')).toBe(false);
    expect(isSalesRange(undefined)).toBe(false);
  });
  it('computes an inclusive start, null for all', () => {
    expect(rangeStart('all', NOW)).toBeNull();
    expect(rangeStart('today', NOW)).toBe('2026-09-07T00:00:00.000Z');
    expect(rangeStart('7d', NOW)).toBe('2026-08-31T12:00:00.000Z');
    expect(rangeStart('30d', NOW)).toBe('2026-08-08T12:00:00.000Z');
  });
});

describe('filterOrdersByRange', () => {
  const orders = [
    order({id: '1', created_at: '2026-09-07T09:00:00.000Z'}), // today
    order({id: '2', created_at: '2026-09-02T09:00:00.000Z'}), // ~5d
    order({id: '3', created_at: '2026-07-01T09:00:00.000Z'}), // old
  ];
  it('today keeps only today', () => {
    expect(filterOrdersByRange(orders, 'today', NOW).map((o) => o.id)).toEqual(['1']);
  });
  it('7d keeps the last week', () => {
    expect(filterOrdersByRange(orders, '7d', NOW).map((o) => o.id)).toEqual(['1', '2']);
  });
  it('all keeps everything', () => {
    expect(filterOrdersByRange(orders, 'all', NOW)).toHaveLength(3);
  });
});

describe('computeKpis', () => {
  it('sums revenue, counts orders/units/oversells', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 540, items: [
        {product_id: 'A', name: 'A', qty: 2, unit_price: 200, line_total: 400},
        {product_id: 'B', name: 'B', qty: 1, unit_price: 140, line_total: 140},
      ]}),
      order({id: '2', created_at: NOW.toISOString(), total: 300, oversold: true, items: [
        {product_id: 'C', name: 'C', qty: 1, unit_price: 300, line_total: 300},
      ]}),
    ];
    expect(computeKpis(orders)).toEqual({revenue: 840, orders: 2, units: 4, oversells: 1});
  });
  it('handles no orders', () => {
    expect(computeKpis([])).toEqual({revenue: 0, orders: 0, units: 0, oversells: 0});
  });
});

describe('salesByDay', () => {
  it('groups by UTC day ascending', () => {
    const orders = [
      order({id: '1', created_at: '2026-09-07T09:00:00.000Z', total: 100}),
      order({id: '2', created_at: '2026-09-07T20:00:00.000Z', total: 50}),
      order({id: '3', created_at: '2026-09-05T09:00:00.000Z', total: 200}),
    ];
    expect(salesByDay(orders)).toEqual([
      {day: '2026-09-05', revenue: 200, orders: 1},
      {day: '2026-09-07', revenue: 150, orders: 2},
    ]);
  });
});

describe('topProducts', () => {
  it('ranks by revenue, skips SKU-less lines, respects limit', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), items: [
        {product_id: 'A', name: 'Alpha', qty: 1, unit_price: 100, line_total: 100},
        {product_id: null, name: 'Bundle', qty: 1, unit_price: 0, line_total: 0},
      ]}),
      order({id: '2', created_at: NOW.toISOString(), items: [
        {product_id: 'A', name: 'Alpha', qty: 2, unit_price: 100, line_total: 200},
        {product_id: 'B', name: 'Beta', qty: 5, unit_price: 50, line_total: 250},
      ]}),
    ];
    const top = topProducts(orders, 5);
    expect(top).toEqual([
      {product_id: 'B', name: 'Beta', revenue: 250, units: 5},
      {product_id: 'A', name: 'Alpha', revenue: 300, units: 3},
    ].sort((a, b) => b.revenue - a.revenue));
    expect(topProducts(orders, 1)).toHaveLength(1);
  });
});

describe('offlineChannelFacts', () => {
  it('builds a Website-shaped offline channel (no ROAS, no platform fee, ₱0 event cost, 0 buyers)', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 540}),
      order({id: '2', created_at: NOW.toISOString(), total: 300}),
    ];
    expect(offlineChannelFacts(orders)).toEqual({
      channel: 'offline',
      orders: 2,
      buyers: 0,
      revenue: 840,
      adSpend: null,
      adRevenue: null,
      platformFeeApplies: false,
      defaults: {cogsPct: 0.35, platformFeePct: 0, promos: 0, acqCost: 0},
    });
  });
  it('returns null when there are no orders', () => {
    expect(offlineChannelFacts([])).toBeNull();
  });
});

describe('offlineCompareMetrics', () => {
  it('builds compare-chart metrics with AOV, null adSpend/roas', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 400, items: [{product_id: 'A', name: 'A', qty: 2, unit_price: 200, line_total: 400}]}),
      order({id: '2', created_at: NOW.toISOString(), total: 200, items: [{product_id: 'B', name: 'B', qty: 1, unit_price: 200, line_total: 200}]}),
    ];
    expect(offlineCompareMetrics(orders)).toEqual({revenue: 600, orders: 2, aov: 300, units: 3, adSpend: null, roas: null});
  });
  it('returns null when there are no orders', () => {
    expect(offlineCompareMetrics([])).toBeNull();
  });
});

describe('stockAlerts', () => {
  const p = (over: Partial<PosProductRow> & {product_id: string; stock: number}): PosProductRow => ({
    name: over.product_id,
    product_line: 'FDR',
    active: true,
    price: 170,
    next_expiry: null,
    ...over,
  });
  it('buckets out / low / near-expiry', () => {
    const products = [
      p({product_id: 'OUT', stock: 0}),
      p({product_id: 'LOW', stock: 5}),
      p({product_id: 'OK', stock: 50}),
      p({product_id: 'EXP', stock: 20, next_expiry: '2026-09-20'}), // within 30d of NOW
      p({product_id: 'FAR', stock: 20, next_expiry: '2027-01-01'}), // beyond
    ];
    const a = stockAlerts(products, NOW);
    expect(a.out.map((x) => x.product_id)).toEqual(['OUT']);
    expect(a.low.map((x) => x.product_id)).toEqual(['LOW']);
    expect(a.nearExpiry.map((x) => x.product_id)).toEqual(['EXP']);
  });
  it('does not flag an out-of-stock item as near-expiry', () => {
    const products = [p({product_id: 'OUT', stock: 0, next_expiry: '2026-09-10'})];
    const a = stockAlerts(products, NOW);
    expect(a.nearExpiry).toHaveLength(0);
    expect(a.out.map((x) => x.product_id)).toEqual(['OUT']);
  });
});
