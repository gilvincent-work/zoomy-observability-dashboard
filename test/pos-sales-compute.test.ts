import {describe, it, expect} from 'vitest';
import {
  boundsFromMax,
  bundleSalesSummary,
  computeKpis,
  manilaDayKey,
  orderMethod,
  presentMethods,
  salesByDayAndMethod,
  topBundles,
  filterOrders,
  filterOrdersByRange,
  isFilterActive,
  isSalesRange,
  offlineChannelFacts,
  offlineCompareMetrics,
  paginate,
  parseOrdersFilter,
  parsePage,
  priceBounds,
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

describe('isSalesRange / rangeStart', () => {
  it('validates range strings', () => {
    expect(isSalesRange('7d')).toBe(true);
    expect(isSalesRange('nope')).toBe(false);
    expect(isSalesRange(undefined)).toBe(false);
  });
  it('computes an inclusive start, null for all', () => {
    expect(rangeStart('all', NOW)).toBeNull();
    // 'today' is the Manila calendar day: NOW is Sep 7 20:00 Manila, so the day
    // began Sep 7 00:00 Manila = Sep 6 16:00 UTC.
    expect(rangeStart('today', NOW)).toBe('2026-09-06T16:00:00.000Z');
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
  it('excludes voided sales from every total', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 500, items: [{product_id: 'A', name: 'A', qty: 2, unit_price: 250, line_total: 500}]}),
      order({id: '2', created_at: NOW.toISOString(), total: 900, status: 'voided', items: [{product_id: 'B', name: 'B', qty: 3, unit_price: 300, line_total: 900}]}),
    ];
    expect(computeKpis(orders)).toEqual({revenue: 500, orders: 1, units: 2, oversells: 0});
  });
});

describe('void exclusion in aggregations', () => {
  it('drops voided sales from salesByDay and topProducts', () => {
    const orders = [
      order({id: '1', created_at: '2026-09-07T09:00:00.000Z', total: 100, items: [{product_id: 'A', name: 'A', qty: 1, unit_price: 100, line_total: 100}]}),
      order({id: '2', created_at: '2026-09-07T10:00:00.000Z', total: 900, status: 'voided', items: [{product_id: 'A', name: 'A', qty: 9, unit_price: 100, line_total: 900}]}),
    ];
    expect(salesByDay(orders)).toEqual([{day: '2026-09-07', revenue: 100, orders: 1}]);
    expect(topProducts(orders)).toEqual([{product_id: 'A', name: 'A', revenue: 100, units: 1, bundledUnits: 0}]);
  });
});

describe('payment-method breakdown', () => {
  it('normalizes null/legacy payment_method to cash', () => {
    expect(orderMethod(order({id: '1', created_at: NOW.toISOString(), payment_method: null}))).toBe('cash');
    expect(orderMethod(order({id: '2', created_at: NOW.toISOString(), payment_method: 'gcash'}))).toBe('gcash');
  });

  it('lists present methods in canonical order, excluding voided', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), payment_method: 'gcash'}),
      order({id: '2', created_at: NOW.toISOString(), payment_method: null}), // cash
      order({id: '3', created_at: NOW.toISOString(), payment_method: 'card'}),
      order({id: '4', created_at: NOW.toISOString(), payment_method: 'maya', status: 'voided'}),
    ];
    expect(presentMethods(orders)).toEqual(['cash', 'gcash', 'card']);
  });

  it('splits revenue by Manila day and method, excluding voided', () => {
    const orders = [
      order({id: '1', created_at: '2026-09-07T09:00:00Z', total: 100, payment_method: 'cash'}), // Sep 7 Manila
      order({id: '2', created_at: '2026-09-07T10:00:00Z', total: 200, payment_method: 'gcash'}), // Sep 7 Manila
      order({id: '3', created_at: '2026-09-07T20:00:00Z', total: 50, payment_method: 'cash'}), // Sep 8 Manila (crosses midnight)
      order({id: '4', created_at: '2026-09-07T11:00:00Z', total: 999, payment_method: 'cash', status: 'voided'}),
    ];
    expect(salesByDayAndMethod(orders)).toEqual([
      {day: '2026-09-07', byMethod: {cash: 100, gcash: 200}},
      {day: '2026-09-08', byMethod: {cash: 50}},
    ]);
  });
});

describe('manilaDayKey', () => {
  it('returns the Manila calendar day for an instant', () => {
    expect(manilaDayKey('2026-09-07T09:00:00Z')).toBe('2026-09-07'); // 17:00 Manila
    expect(manilaDayKey('2026-09-07T20:00:00Z')).toBe('2026-09-08'); // 04:00 Manila next day
  });
});

describe('salesByDay', () => {
  it('groups by Manila calendar day ascending', () => {
    const orders = [
      order({id: '1', created_at: '2026-09-07T09:00:00.000Z', total: 100}), // Sep 7 17:00 Manila
      order({id: '2', created_at: '2026-09-07T20:00:00.000Z', total: 50}), // Sep 8 04:00 Manila (crosses midnight)
      order({id: '3', created_at: '2026-09-05T09:00:00.000Z', total: 200}), // Sep 5 17:00 Manila
    ];
    expect(salesByDay(orders)).toEqual([
      {day: '2026-09-05', revenue: 200, orders: 1},
      {day: '2026-09-07', revenue: 100, orders: 1},
      {day: '2026-09-08', revenue: 50, orders: 1},
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
      {product_id: 'B', name: 'Beta', revenue: 250, units: 5, bundledUnits: 0},
      {product_id: 'A', name: 'Alpha', revenue: 300, units: 3, bundledUnits: 0},
    ].sort((a, b) => b.revenue - a.revenue));
    expect(topProducts(orders, 1)).toHaveLength(1);
  });

  it('ranks by units when sortBy is "units" (revenue as tiebreak)', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), items: [
        {product_id: 'A', name: 'Alpha', qty: 1, unit_price: 1000, line_total: 1000}, // high revenue, low units
        {product_id: 'B', name: 'Beta', qty: 10, unit_price: 50, line_total: 500}, // low revenue, high units
      ]}),
    ];
    expect(topProducts(orders, 5, 'revenue').map((t) => t.product_id)).toEqual(['A', 'B']);
    expect(topProducts(orders, 5, 'units').map((t) => t.product_id)).toEqual(['B', 'A']);
  });

  it('counts ₱0 (bundle-pick) lines as units but not revenue', () => {
    // The Cat Grass case from prod: 5 sold at 170 (real revenue) + 4 given as
    // bundle picks at 0 -> 9 units, 850 revenue, 4 of them bundled.
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), items: [
        {product_id: 'CG', name: 'Cat Grass', qty: 5, unit_price: 170, line_total: 850},
      ]}),
      order({id: '2', created_at: NOW.toISOString(), total: 570, items: [
        {product_id: 'CG', name: 'Cat Grass', qty: 4, unit_price: 0, line_total: 0},
      ]}),
    ];
    expect(topProducts(orders)).toEqual([{product_id: 'CG', name: 'Cat Grass', revenue: 850, units: 9, bundledUnits: 4}]);
  });
});

describe('bundleSalesSummary', () => {
  it('reconciles itemized product revenue with the Revenue KPI', () => {
    const orders = [
      // à la carte: order total equals its line sum -> no bundle revenue
      order({id: '1', created_at: NOW.toISOString(), total: 850, items: [
        {product_id: 'CG', name: 'Cat Grass', qty: 5, unit_price: 170, line_total: 850},
      ]}),
      // a "Buy Any 4" bundle: 570 on the header, all component lines ₱0
      order({id: '2', created_at: NOW.toISOString(), total: 570, items: [
        {product_id: 'CG', name: 'Cat Grass', qty: 1, unit_price: 0, line_total: 0},
        {product_id: 'BL', name: 'Beef Liver', qty: 1, unit_price: 0, line_total: 0},
        {product_id: 'DB', name: 'Duck Breast', qty: 1, unit_price: 0, line_total: 0},
        {product_id: 'CH', name: 'Chicken', qty: 1, unit_price: 0, line_total: 0},
      ]}),
    ];
    const s = bundleSalesSummary(orders);
    expect(s).toEqual({itemizedRevenue: 850, bundleRevenue: 570, bundleOrders: 1, totalRevenue: 1420});
    // The invariant the reconciliation line relies on:
    expect(s.itemizedRevenue + s.bundleRevenue).toBe(s.totalRevenue);
  });

  it('excludes voided orders and reports no bundle revenue for pure à-la-carte data', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 200, items: [
        {product_id: 'A', name: 'A', qty: 1, unit_price: 200, line_total: 200},
      ]}),
      order({id: '2', created_at: NOW.toISOString(), total: 570, status: 'voided', items: [
        {product_id: 'A', name: 'A', qty: 1, unit_price: 0, line_total: 0},
      ]}),
    ];
    expect(bundleSalesSummary(orders)).toEqual({itemizedRevenue: 200, bundleRevenue: 0, bundleOrders: 0, totalRevenue: 200});
  });

  it('keeps bundle-line revenue out of itemized (post write-path fix)', () => {
    // A bundle recorded the new way: a bundle_id line carries the price, picks ride at ₱0.
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 570, items: [
        {product_id: null, bundle_id: 'buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
        {product_id: 'A', name: 'A', qty: 1, unit_price: 0, line_total: 0},
        {product_id: 'B', name: 'B', qty: 1, unit_price: 0, line_total: 0},
      ]}),
    ];
    // itemized excludes the bundle line, so bundleRevenue lands on the bundle, not products.
    expect(bundleSalesSummary(orders)).toEqual({itemizedRevenue: 0, bundleRevenue: 570, bundleOrders: 1, totalRevenue: 570});
  });
});

describe('topBundles', () => {
  it('ranks bundles by revenue from bundle_id lines, ignoring product and voided lines', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 570, items: [
        {product_id: null, bundle_id: 'buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
        {product_id: 'A', name: 'A', qty: 1, unit_price: 0, line_total: 0},
      ]}),
      order({id: '2', created_at: NOW.toISOString(), total: 550, items: [
        {product_id: null, bundle_id: 'buy-any-2', name: 'Buy Any 2', qty: 1, unit_price: 550, line_total: 550},
      ]}),
      order({id: '3', created_at: NOW.toISOString(), total: 570, items: [
        {product_id: null, bundle_id: 'buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
      ]}),
      order({id: '4', created_at: NOW.toISOString(), total: 570, status: 'voided', items: [
        {product_id: null, bundle_id: 'buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
      ]}),
    ];
    expect(topBundles(orders)).toEqual([
      {bundle_id: 'buy-any-4', name: 'Buy Any 4', revenue: 1140, orders: 2},
      {bundle_id: 'buy-any-2', name: 'Buy Any 2', revenue: 550, orders: 1},
    ]);
  });

  it('is empty when no order has a bundle line (pre-fix / offline data)', () => {
    const orders = [
      order({id: '1', created_at: NOW.toISOString(), total: 850, items: [
        {product_id: 'CG', name: 'Cat Grass', qty: 5, unit_price: 170, line_total: 850},
      ]}),
    ];
    expect(topBundles(orders)).toEqual([]);
  });
});

describe('paginate', () => {
  it('derives clamped page + range indices', () => {
    expect(paginate(60, 1, 25)).toEqual({page: 1, pageSize: 25, totalPages: 3, from: 0, to: 24});
    expect(paginate(60, 2, 25)).toEqual({page: 2, pageSize: 25, totalPages: 3, from: 25, to: 49});
    expect(paginate(60, 3, 25)).toEqual({page: 3, pageSize: 25, totalPages: 3, from: 50, to: 74});
  });
  it('clamps out-of-range pages into [1, totalPages]', () => {
    expect(paginate(60, 99, 25).page).toBe(3);
    expect(paginate(60, 0, 25).page).toBe(1);
    expect(paginate(60, -5, 25).page).toBe(1);
  });
  it('always has at least one page, even with zero rows', () => {
    expect(paginate(0, 1, 25)).toEqual({page: 1, pageSize: 25, totalPages: 1, from: 0, to: 24});
  });
});

describe('parsePage', () => {
  it('parses positive integers, defaults to 1 otherwise', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-2')).toBe(1);
    expect(parsePage('abc')).toBe(1);
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
    category: 'Freeze Dried',
    subcategory: null,
    emoji: null,
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

describe('parseOrdersFilter', () => {
  it('defaults unknown/blank params to no filter', () => {
    expect(parseOrdersFilter({})).toEqual({method: 'all', status: 'all', startDate: null, endDate: null, minPrice: null, maxPrice: null});
    expect(parseOrdersFilter({method: 'bitcoin', status: 'huh', from: 'never'})).toEqual({
      method: 'all',
      status: 'all',
      startDate: null,
      endDate: null,
      minPrice: null,
      maxPrice: null,
    });
  });
  it('keeps a valid method, status, date range, and prices', () => {
    expect(parseOrdersFilter({
      method: 'gcash',
      status: 'voided',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-09T23:59:59.999Z',
      min: '50',
      max: '500',
    })).toEqual({
      method: 'gcash',
      status: 'voided',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-09T23:59:59.999Z',
      minPrice: 50,
      maxPrice: 500,
    });
  });
  it('rejects malformed dates', () => {
    const f = parseOrdersFilter({from: 'not-a-date', to: 'nope'});
    expect(f.startDate).toBeNull();
    expect(f.endDate).toBeNull();
  });
  it('swaps a reversed instant range', () => {
    const f = parseOrdersFilter({from: '2026-09-09T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z'});
    expect(f.startDate).toBe('2026-09-01T00:00:00.000Z');
    expect(f.endDate).toBe('2026-09-09T00:00:00.000Z');
  });
  it('swaps a reversed price range', () => {
    const f = parseOrdersFilter({min: '500', max: '50'});
    expect(f.minPrice).toBe(50);
    expect(f.maxPrice).toBe(500);
  });
  it('ignores negative or non-numeric prices', () => {
    const f = parseOrdersFilter({min: '-10', max: 'abc'});
    expect(f.minPrice).toBeNull();
    expect(f.maxPrice).toBeNull();
  });
});

describe('isFilterActive', () => {
  it('is false only for the all-defaults filter', () => {
    expect(isFilterActive({method: 'all', status: 'all', startDate: null, endDate: null, minPrice: null, maxPrice: null})).toBe(false);
    expect(isFilterActive({method: 'cash', status: 'all', startDate: null, endDate: null, minPrice: null, maxPrice: null})).toBe(true);
    expect(isFilterActive({method: 'all', status: 'voided', startDate: null, endDate: null, minPrice: null, maxPrice: null})).toBe(true);
    expect(isFilterActive({method: 'all', status: 'all', startDate: '2026-09-01T00:00:00.000Z', endDate: null, minPrice: null, maxPrice: null})).toBe(true);
    expect(isFilterActive({method: 'all', status: 'all', startDate: null, endDate: null, minPrice: 20, maxPrice: null})).toBe(true);
  });
});

describe('filterOrders', () => {
  const orders = [
    order({id: 'cash', created_at: '2026-09-07T10:00:00.000Z', total: 100, payment_method: 'cash'}),
    order({id: 'gcash', created_at: '2026-09-06T10:00:00.000Z', total: 300, payment_method: 'gcash'}),
    order({id: 'legacy', created_at: '2026-08-01T10:00:00.000Z', total: 500, payment_method: null}),
    order({id: 'card', created_at: '2026-09-07T09:00:00.000Z', total: 900, payment_method: 'card'}),
  ];
  const base = {method: 'all', status: 'all', startDate: null, endDate: null, minPrice: null, maxPrice: null};

  it('matches cash including legacy null rows', () => {
    const ids = filterOrders(orders, {...base, method: 'cash'}).map((o) => o.id);
    expect(ids.sort()).toEqual(['cash', 'legacy']);
  });
  it('filters by status (voided only)', () => {
    const withVoid = [...orders, order({id: 'void', created_at: '2026-09-07T11:00:00.000Z', total: 200, status: 'voided'})];
    expect(filterOrders(withVoid, {...base, status: 'voided'}).map((o) => o.id)).toEqual(['void']);
    expect(filterOrders(withVoid, {...base, status: 'completed'}).map((o) => o.id).sort()).toEqual(['card', 'cash', 'gcash', 'legacy']);
  });
  it('filters by a specific method', () => {
    const ids = filterOrders(orders, {...base, method: 'card'}).map((o) => o.id);
    expect(ids).toEqual(['card']);
  });
  it('filters by price range (inclusive)', () => {
    const ids = filterOrders(orders, {...base, minPrice: 100, maxPrice: 500}).map((o) => o.id);
    expect(ids.sort()).toEqual(['cash', 'gcash', 'legacy']);
  });
  it('filters by an inclusive instant range', () => {
    const ids = filterOrders(orders, {
      ...base,
      startDate: '2026-09-06T00:00:00.000Z',
      endDate: '2026-09-07T23:59:59.999Z',
    }).map((o) => o.id);
    expect(ids.sort()).toEqual(['card', 'cash', 'gcash']);
    expect(ids).not.toContain('legacy');
  });
  it('includes an order at the end-of-day boundary', () => {
    const ids = filterOrders(orders, {
      ...base,
      startDate: '2026-09-07T00:00:00.000Z',
      endDate: '2026-09-07T23:59:59.999Z',
    }).map((o) => o.id);
    expect(ids.sort()).toEqual(['card', 'cash']);
  });
  it('combines filters (AND)', () => {
    const ids = filterOrders(orders, {...base, minPrice: 200, maxPrice: 400}).map((o) => o.id);
    expect(ids).toEqual(['gcash']);
  });
});

describe('price bounds', () => {
  it('rounds the max up to a clean ceiling', () => {
    expect(boundsFromMax(6767)).toEqual({min: 0, max: 6800});
    expect(boundsFromMax(0)).toEqual({min: 0, max: 100});
    expect(boundsFromMax(100)).toEqual({min: 0, max: 100});
  });
  it('derives bounds from the highest order total', () => {
    expect(priceBounds([order({id: 'a', created_at: '2026-09-07T10:00:00.000Z', total: 250})])).toEqual({min: 0, max: 300});
  });
});
