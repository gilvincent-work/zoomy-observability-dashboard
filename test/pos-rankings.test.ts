import {describe, expect, it} from 'vitest';
import {filterByName, sortRows} from '../src/pos-rankings';
import {topBundles, topProducts} from '../src/pos-sales-compute';
import type {PosOrder, TopBundle, TopProduct} from '../src/pos-sales-types';

const P = (name: string, revenue: number, units: number, bundledUnits = 0): TopProduct => ({
  product_id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  revenue,
  units,
  bundledUnits,
});

const rows: TopProduct[] = [
  P('Duck Strips', 6160, 144, 115),
  P('Freeze-Dried Cat Grass Cubes', 8840, 120, 74),
  P('Freeze-Dried Duck Breast Cubes', 7110, 112, 73),
];

describe('filterByName', () => {
  it('matches case-insensitively on a substring', () => {
    expect(filterByName(rows, 'duck').map((r) => r.name)).toEqual(['Duck Strips', 'Freeze-Dried Duck Breast Cubes']);
  });

  it('trims and passes everything through on an empty query', () => {
    expect(filterByName(rows, '   ')).toHaveLength(3);
    expect(filterByName(rows, '')).toHaveLength(3);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterByName(rows, 'salmon')).toEqual([]);
  });

  it('does not mutate the input', () => {
    const before = [...rows];
    filterByName(rows, 'duck');
    expect(rows).toEqual(before);
  });
});

describe('sortRows', () => {
  it('sorts a numeric key descending for "top"', () => {
    expect(sortRows(rows, 'revenue', 'top').map((r) => r.name)).toEqual([
      'Freeze-Dried Cat Grass Cubes',
      'Freeze-Dried Duck Breast Cubes',
      'Duck Strips',
    ]);
  });

  it('sorts a numeric key ascending for "bottom"', () => {
    expect(sortRows(rows, 'units', 'bottom').map((r) => r.units)).toEqual([112, 120, 144]);
  });

  it('sorts a string key A→Z for "top" and Z→A for "bottom"', () => {
    expect(sortRows(rows, 'name', 'top').map((r) => r.name[0])).toEqual(['D', 'F', 'F']);
    expect(sortRows(rows, 'name', 'bottom').map((r) => r.name[0])).toEqual(['F', 'F', 'D']);
  });

  it('breaks numeric ties by name ascending (stable, deterministic)', () => {
    const tie = [P('Zeta', 100, 5), P('Alpha', 100, 5), P('Mid', 100, 5)];
    expect(sortRows(tie, 'revenue', 'top').map((r) => r.name)).toEqual(['Alpha', 'Mid', 'Zeta']);
    // Direction must not flip the tiebreak — ties stay name-ascending either way.
    expect(sortRows(tie, 'revenue', 'bottom').map((r) => r.name)).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('does not mutate the input', () => {
    const before = [...rows];
    sortRows(rows, 'revenue', 'top');
    expect(rows).toEqual(before);
  });

  it('sorts bundles by orders', () => {
    const bundles: TopBundle[] = [
      {bundle_id: 'a', name: 'A', revenue: 500, orders: 3},
      {bundle_id: 'b', name: 'B', revenue: 400, orders: 9},
    ];
    expect(sortRows(bundles, 'orders', 'top').map((r) => r.name)).toEqual(['B', 'A']);
  });
});

// Guards the "View all" contract: the Rankings page asks for the FULL list
// (limit Infinity), unlike the overview cards' top-5. A regression that reinstated
// a default cap would silently truncate the page.
describe('topProducts / topBundles with limit Infinity', () => {
  const order = (items: PosOrder['items']): PosOrder =>
    ({
      id: 1,
      client_uuid: 'u',
      created_at: '2026-09-20T00:00:00Z',
      status: 'completed',
      total: items.reduce((s, it) => s + it.line_total, 0),
      items,
    }) as unknown as PosOrder;

  const line = (product_id: string, qty: number, line_total: number) =>
    ({product_id, bundle_id: null, name: product_id, qty, unit_price: line_total / qty, line_total, bundle_group: null}) as PosOrder['items'][number];

  it('returns every product, not just the top 5', () => {
    const orders = [order(Array.from({length: 8}, (_, i) => line(`sku-${i}`, 1, (i + 1) * 10)))];
    expect(topProducts(orders, Infinity)).toHaveLength(8);
    expect(topProducts(orders)).toHaveLength(5); // default cap still applies for the cards
  });

  it('returns every bundle, not just the top 5', () => {
    const bl = (bundle_id: string, line_total: number) =>
      ({product_id: null, bundle_id, name: bundle_id, qty: 1, unit_price: line_total, line_total, bundle_group: bundle_id}) as PosOrder['items'][number];
    const orders = [order(Array.from({length: 7}, (_, i) => bl(`bundle-${i}`, (i + 1) * 100)))];
    expect(topBundles(orders, Infinity)).toHaveLength(7);
    expect(topBundles(orders)).toHaveLength(5);
  });
});
