import {describe, it, expect} from 'vitest';
import {allocateByWeights, aggregatePicks, bundlePickRows, bundleRevenueByPet, type BundlePickRow, type PicksBy} from '../src/pos-bundle-compute';
import {buildPriceHistory} from '../src/pos-price-history';
import {bundleSalesSummary} from '../src/pos-sales-compute';
import {buildBundleFixture, CHANGES, mulberry32, PRICES, PRICE_2, PRICE_4} from './support/bundle-fixture';

const C = (pesos: number): number => Math.round(pesos * 100);
const sumC = (xs: number[]): number => xs.reduce((s, x) => s + C(x), 0);
const fx = buildBundleFixture();
const history = buildPriceHistory(PRICES, CHANGES);

describe('allocateByWeights', () => {
  it('sums exactly to the total in centavos for 1000 random weight vectors', () => {
    const rng = mulberry32(7);
    for (let t = 0; t < 1000; t++) {
      const n = 1 + Math.floor(rng() * 12);
      const weights = Array.from({length: n}, () => (rng() < 0.15 ? 0 : rng() * 500));
      const totalC = Math.floor(rng() * 5_000_000);
      const {amounts} = allocateByWeights(totalC / 100, weights);
      expect(amounts).toHaveLength(n);
      expect(sumC(amounts)).toBe(totalC);
      for (const a of amounts) expect(a).toBeGreaterThanOrEqual(0);
    }
  });
  it('gives the extra centavo to the largest remainder, earlier index on ties', () => {
    expect(allocateByWeights(1, [1, 1, 1]).amounts.map(C)).toEqual([34, 33, 33]);
    expect(allocateByWeights(0.02, [1, 2, 1]).amounts.map(C)).toEqual([1, 1, 0]);
    expect(allocateByWeights(650, [200, 100, 100, 100]).amounts).toEqual([260, 130, 130, 130]);
  });
  it('splits equally when every weight is zero, negative or not finite', () => {
    const r = allocateByWeights(10, [0, -5, NaN, Infinity]);
    expect(r.equalSplit).toBe(true);
    expect(r.amounts).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(allocateByWeights(1, [0, 0, 0]).amounts.map(C)).toEqual([34, 33, 33]);
    expect(allocateByWeights(10, [1, 0]).equalSplit).toBe(false);
  });
  it('treats negative weights as zero and handles empty input and a zero total', () => {
    expect(allocateByWeights(10, [-3, 1]).amounts).toEqual([0, 10]);
    expect(allocateByWeights(10, [])).toEqual({amounts: [], equalSplit: false});
    expect(allocateByWeights(0, [1, 2]).amounts).toEqual([0, 0]);
  });
  it('throws RangeError for a negative or non-finite total', () => {
    expect(() => allocateByWeights(-1, [1])).toThrow(RangeError);
    expect(() => allocateByWeights(NaN, [1])).toThrow(RangeError);
    expect(() => allocateByWeights(Infinity, [1])).toThrow(RangeError);
  });
});

describe('bundleRevenueByPet', () => {
  const m = bundleRevenueByPet(fx.orders);
  it('matches the totals known by construction', () => {
    expect(C(m.bundleRevenue)).toBe(fx.expected.bundleRevenueC);
    expect(C(m.totals.dog)).toBe(fx.expected.byPetC.dog);
    expect(C(m.totals.cat)).toBe(fx.expected.byPetC.cat);
    expect(C(m.totals.both)).toBe(fx.expected.byPetC.both);
    expect(C(m.totals.untagged)).toBe(fx.expected.byPetC.untagged);
    const byName = Object.fromEntries(m.rows.map((r) => [r.bundle, C(r.total)]));
    expect(byName['Buy Any 4']).toBe(fx.expected.byBundleC['Buy Any 4']);
    expect(byName['Buy Any 2']).toBe(fx.expected.byBundleC['Buy Any 2']);
    expect(byName['Unnamed bundle (no bundle record)']).toBe(fx.expected.byBundleC.unnamed);
  });
  it('keeps the invariants: rows = bundle = pets = named + unnamed', () => {
    expect(sumC(m.rows.map((r) => r.total))).toBe(C(m.bundleRevenue));
    expect(sumC(Object.values(m.totals))).toBe(C(m.bundleRevenue));
    expect(C(m.namedRevenue) + C(m.unnamedRevenue)).toBe(C(m.bundleRevenue));
    for (const r of m.rows) expect(sumC([r.dog, r.cat, r.both, r.untagged])).toBe(C(r.total));
  });
  it('equals bundleSalesSummary on a discount-free fixture', () => {
    expect(C(m.bundleRevenue)).toBe(C(bundleSalesSummary(fx.orders).bundleRevenue));
    expect(m.negativeResidualOrders).toBe(0);
  });
  it('excludes voided orders entirely', () => {
    expect(fx.expected.voidedBundleOrders).toBeGreaterThan(0);
    const voidedOnly = fx.orders.filter((o) => o.status === 'voided');
    const r = bundleRevenueByPet(voidedOnly);
    expect(r.bundleRevenue).toBe(0);
    expect(r.rows).toEqual([]);
    expect(Object.values(r.orders)).toEqual([0, 0, 0, 0]);
  });
  it('counts orders with bundle revenue per bucket and sorts rows by total then name', () => {
    expect(Object.values(m.orders).reduce((a, b) => a + b, 0)).toBe(fx.expected.bundleOrders);
    for (let i = 1; i < m.rows.length; i++) expect(m.rows[i - 1].total).toBeGreaterThanOrEqual(m.rows[i].total);
    const named = m.rows.find((r) => r.bundle === 'Buy Any 4');
    expect(named?.bundle_id).toBe('b4');
    expect(m.rows.find((r) => r.bundle_id === null)?.bundle).toBe('Unnamed bundle (no bundle record)');
  });
  it('omits the unnamed row when every bundle is named', () => {
    const r = bundleRevenueByPet(fx.orders.filter((o) => o.items.some((l) => l.bundle_id)));
    expect(r.unnamedRevenue).toBe(0);
    expect(r.rows.some((x) => x.bundle_id === null)).toBe(false);
  });
  it('counts a negative-residual (discounted itemized) order and contributes 0 for it', () => {
    const r = bundleRevenueByPet([...fx.orders, fx.special.discountedItemized]);
    expect(r.negativeResidualOrders).toBe(1);
    expect(C(r.bundleRevenue)).toBe(fx.expected.bundleRevenueC);
  });
  it('caps the named part at the discounted order total', () => {
    const r = bundleRevenueByPet([fx.special.discountedBundle]);
    expect(r.bundleRevenue).toBe(600);
    expect(r.namedRevenue).toBe(600);
    expect(r.unnamedRevenue).toBe(0);
    expect(r.totals.dog).toBe(600);
  });
  it('counts a header with no picks as bundle revenue', () => {
    const r = bundleRevenueByPet([fx.special.headerOnly]);
    expect(r.bundleRevenue).toBe(PRICE_4);
    expect(r.totals.untagged).toBe(PRICE_4);
  });
});

describe('bundlePickRows', () => {
  const r = bundlePickRows(fx.orders, history);
  it('allocates each group exactly to its paid price', () => {
    const byGroup = new Map<string, {paid: number; alloc: number}>();
    for (const row of r.rows) {
      const g = byGroup.get(row.bundle_group) ?? {paid: row.bundle === 'Buy Any 4' ? C(PRICE_4) : C(PRICE_2), alloc: 0};
      g.alloc += C(row.allocated);
      byGroup.set(row.bundle_group, g);
    }
    expect(byGroup.size).toBeGreaterThan(20);
    for (const g of byGroup.values()) expect(g.alloc).toBe(g.paid);
  });
  it('balances paidTotal and allocatedTotal and matches construction', () => {
    expect(C(r.paidTotal)).toBe(C(r.allocatedTotal));
    expect(C(r.paidTotal)).toBe(fx.expected.paidC);
    expect(sumC(r.rows.map((x) => x.allocated))).toBe(C(r.allocatedTotal));
    expect(r.rows).toHaveLength(fx.expected.pickLines);
    expect(r.zeroValueLines).toBe(fx.expected.pickLines);
    expect(r.groupsWithoutHeader).toBe(fx.expected.groupsWithoutHeader);
    expect(r.groupsWithoutPicks).toBe(0);
    expect(r.unallocatedPaid).toBe(0);
  });
  it('skips voided orders and headerless groups', () => {
    const voidedIds = new Set(fx.orders.filter((o) => o.status === 'voided').map((o) => o.id));
    expect(r.rows.some((x) => voidedIds.has(x.order_id))).toBe(false);
  });
  it('values a sale at its sale-date price (p1 170 -> 200 -> 240 -> 200)', () => {
    const mk = (id: string, at: string) => ({
      ...fx.special.discountedBundle, id, created_at: at, pet_type: 'dog' as const,
      items: [
        {product_id: null, bundle_id: 'b2', bundle_group: 'g', name: 'Buy Any 2', qty: 1, unit_price: 550, line_total: 550},
        {product_id: 'p1', bundle_group: 'g', name: 'SKU 1', qty: 1, unit_price: 0, line_total: 0},
        {product_id: 'p2', bundle_group: 'g', name: 'SKU 2', qty: 2, unit_price: 0, line_total: 0},
      ],
    });
    const at = (iso: string) => bundlePickRows([mk('x', iso)], history).rows;
    const p2Price = 110; // 100 + 10 * index 1
    const expectList = (iso: string, p1: number) => {
      const rows = at(iso);
      expect(rows.find((x) => x.product_id === 'p1')?.list_value).toBe(p1);
      expect(rows.find((x) => x.product_id === 'p2')?.list_value).toBe(p2Price * 2);
    };
    expectList('2026-09-07T12:00:00+08:00', 170);
    expectList('2026-09-10T12:00:00+08:00', 200);
    expectList('2026-09-18T12:00:00+08:00', 240);
    expectList('2026-09-25T12:00:00+08:00', 200);
    // allocation follows the weights: 550 split 170 : 220 -> 239.74 / 310.26 on Sep 7
    const rows = at('2026-09-07T12:00:00+08:00');
    expect(rows.map((x) => C(x.allocated))).toEqual([23974, 31026]);
  });
  it('reports a header with no picks as unallocated, not allocated', () => {
    const res = bundlePickRows([fx.special.headerOnly], history);
    expect(res.rows).toEqual([]);
    expect(res.groupsWithoutPicks).toBe(1);
    expect(res.unallocatedPaid).toBe(PRICE_4);
    expect(res.paidTotal).toBe(0);
  });
  it('equal-splits a group whose picks have no known price', () => {
    const res = bundlePickRows([fx.special.unknownSku], history);
    expect(res.equalSplitGroups).toBe(1);
    expect(res.rows.map((x) => x.allocated)).toEqual([275, 275]);
    expect(res.rows.every((x) => x.list_value === 0)).toBe(true);
    expect(res.paidTotal).toBe(PRICE_2);
    expect(res.allocatedTotal).toBe(PRICE_2);
  });
  it('does not count a pick that has a real price as a zero-value line', () => {
    const o = {...fx.special.discountedBundle, items: [
      {product_id: null, bundle_id: 'b2', bundle_group: 'g', name: 'Buy Any 2', qty: 1, unit_price: 550, line_total: 550},
      {product_id: 'p2', bundle_group: 'g', name: 'SKU 2', qty: 1, unit_price: 110, line_total: 110},
    ]};
    expect(bundlePickRows([o], history).zeroValueLines).toBe(0);
  });
});

describe('aggregatePicks', () => {
  it('two different products with the same name are never merged into one SKU row', () => {
    const base = {order_id: 'o1', bundle_group: 'g1', bundle_id: 'b1', bundle: 'Buy Any 2', pet: 'dog' as const, qty: 1, list_value: 200, created_at: '2026-09-12T02:00:00Z'};
    const two: BundlePickRow[] = [
      {...base, product_id: 'SKU-AAAA01', sku: 'Duck Strips', allocated: 100},
      {...base, product_id: 'SKU-BBBB02', sku: 'Duck Strips', allocated: 150},
      {...base, product_id: 'SKU-CCCC03', sku: 'Beef Slices', allocated: 50},
    ];
    const agg = aggregatePicks(two, 'sku', 'revenue');
    expect(agg).toHaveLength(3);
    expect(agg.map((r) => r.value).sort((a, b) => (a as number) - (b as number))).toEqual([50, 100, 150]);
    // the colliding names are told apart; the unique name stays clean
    const labels = agg.map((r) => r.sku as string);
    expect(labels).toContain('Beef Slices');
    expect(labels.filter((l) => l.startsWith('Duck Strips ('))).toHaveLength(2);
    expect(new Set(labels).size).toBe(3);
    expect(aggregatePicks(two, 'sku_by_pet', 'units')).toHaveLength(3);
  });

  const rows: BundlePickRow[] = bundlePickRows(fx.orders, history).rows;
  const bys: PicksBy[] = ['sku', 'sku_by_pet', 'bundle_by_sku'];
  const measures = ['revenue', 'list_value', 'units'] as const;
  const field = {revenue: 'allocated', list_value: 'list_value', units: 'qty'} as const;
  for (const by of bys) {
    for (const measure of measures) {
      it(`${by} x ${measure}: totals equal the input totals exactly`, () => {
        const agg = aggregatePicks(rows, by, measure);
        const inputC = measure === 'units' ? rows.reduce((s, x) => s + x.qty, 0) : sumC(rows.map((x) => x[field[measure]]));
        const key = by === 'sku_by_pet' ? 'total' : 'value';
        const outC = measure === 'units' ? agg.reduce((s, x) => s + (x[key] as number), 0) : sumC(agg.map((x) => x[key] as number));
        expect(outC).toBe(inputC);
        expect(agg.length).toBeGreaterThan(0);
      });
    }
  }
  it('shares: sku shares add to 100 and per-bundle shares add to 100', () => {
    const sku = aggregatePicks(rows, 'sku', 'revenue');
    expect(sku.reduce((s, x) => s + (x.share as number), 0)).toBeCloseTo(100, 6);
    const long = aggregatePicks(rows, 'bundle_by_sku', 'units');
    for (const b of ['Buy Any 4', 'Buy Any 2']) {
      expect(long.filter((x) => x.bundle === b).reduce((s, x) => s + (x.share_of_bundle as number), 0)).toBeCloseTo(100, 6);
    }
  });
  it('sku_by_pet columns add to total and rows sort by total desc then sku', () => {
    const agg = aggregatePicks(rows, 'sku_by_pet', 'revenue');
    for (const x of agg) expect(sumC([x.dog, x.cat, x.both, x.untagged].map(Number))).toBe(C(x.total as number));
    for (let i = 1; i < agg.length; i++) expect(agg[i - 1].total as number).toBeGreaterThanOrEqual(agg[i].total as number);
  });
  it('returns an empty list for no rows and 0 shares for a zero grand total', () => {
    expect(aggregatePicks([], 'sku', 'revenue')).toEqual([]);
    const z = aggregatePicks([{...rows[0], allocated: 0}], 'sku', 'revenue');
    expect(z[0].share).toBe(0);
  });
});
