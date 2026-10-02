import {describe, expect, it} from 'vitest';
import {runMetric} from '../src/chat/query-metric';
import type {MetricData, MetricRequest, MetricResult} from '../src/chat/result-types';
import {buildBundleFixture, CHANGES, PRICES} from './support/bundle-fixture';
import {buildBundleReferenceFixture, REF_PRICES} from './support/bundle-reference-fixture';

// GAP-05 (S1#11, S1#12, S1#16, TTD01-c): the design's reference figures (section 5b) are PRODUCED by running the metrics over a
// synthetic fixture, never typed into the assertion of a result. The fixture in support/bundle-reference-fixture.ts is built by
// construction (its totals are summed from the cells it generates, not read from the code under test). The design's literal figures
// appear exactly once, in DESIGN below, and a test pins the constructed fixture to them.
// The older fixture (support/bundle-fixture.ts, 41 random orders) has DIFFERENT totals from the design's production figures
// (a few thousand pesos of bundle revenue, not 147,300), so on that one the INVARIANTS are asserted instead: parts sum to the total, shares sum to 100.0.

const NOW = new Date('2026-10-01T04:00:00Z');
const BASE: MetricRequest = {
  metric: 'bundle_sales', dimension: 'none', measure: 'default', range: 'all_available', from: '', to: '', channel: 'offline', event: 'all',
  pet: 'all', compare_to: 'none', sort: 'default', limit: 25,
};
function run(d: MetricData, over: Partial<MetricRequest>): MetricResult {
  const r = runMetric({...BASE, ...over}, d, NOW);
  if ('error' in r) throw new Error(r.error);
  return r;
}
const sum = (rows: MetricResult['rows'], key: string): number => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
const cell = (r: MetricResult, key: string, value: string, field: string): number => Number(r.rows.find((x) => x[key] === value)?.[field]);
const check = (r: MetricResult, code: string) => r.meta.checks.find((c) => c.code === code);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The design's reference figures (section 5b, criteria 11, 12 and 16). The ONLY place they are written down. */
const DESIGN = {
  bundleRevenue: 147_300, dog: 71_050, cat: 18_050, both: 17_850, untagged: 40_350, tagged: 106_950, named: 106_950, buyAny4: 99_250, buyAny2: 7_700,
  listValue: 139_360, discount: 32_410, discountPct: 23.3, shares: {dog: 66.4, cat: 16.9, both: 16.7}, dogOverCat: 3.9, buyAny4Share: 92.8, untaggedShare: 27.4,
};

describe('the design reference figures come out of the metrics (fixture built by construction)', () => {
  const fx = buildBundleReferenceFixture();
  const data: MetricData = {source: 'live', orders: fx.orders, events: [], prices: REF_PRICES, priceChanges: [], bulkReads: []};
  const e = fx.expected;

  it('the constructed fixture IS the design: its tracked totals equal the design figures', () => {
    expect(e.bundleRevenue).toBe(DESIGN.bundleRevenue);
    expect(e.byPet).toEqual({dog: DESIGN.dog, cat: DESIGN.cat, both: DESIGN.both, untagged: DESIGN.untagged});
    expect(e.tagged).toBe(DESIGN.tagged);
    expect(e.named).toBe(DESIGN.named);
    expect(e.byBundle).toEqual({'Buy Any 4': DESIGN.buyAny4, 'Buy Any 2': DESIGN.buyAny2, unnamed: DESIGN.untagged});
    expect(e.listValue).toBe(DESIGN.listValue);
    expect(e.discount).toBe(DESIGN.discount);
  });

  it('bundle_sales by pet_type: dog + cat + both + untagged = the bundle revenue, each pet equals what the fixture holds, reconciles at zero tolerance', () => {
    const r = run(data, {dimension: 'pet_type'});
    for (const p of ['dog', 'cat', 'both', 'untagged'] as const) expect(cell(r, 'pet', p, 'value'), p).toBe(e.byPet[p]);
    expect(sum(r.rows, 'value')).toBe(e.bundleRevenue);
    expect(sum(r.rows, 'value')).toBe(DESIGN.bundleRevenue);
    expect(check(r, 'reconciles')?.status).toBe('ok');
    expect(r.meta.share_basis).toBe('tagged bundle revenue');
  });

  it('the tagged shares are 66.4 / 16.9 / 16.7 and add to 100.0, computed from the fixture', () => {
    const r = run(data, {dimension: 'pet_type'});
    const share = (p: 'dog' | 'cat' | 'both') => cell(r, 'pet', p, 'share_of_tagged');
    expect(share('dog')).toBe(round1((e.byPet.dog / e.tagged) * 100));
    expect(share('cat')).toBe(round1((e.byPet.cat / e.tagged) * 100));
    expect(share('both')).toBe(round1((e.byPet.both / e.tagged) * 100));
    expect([share('dog'), share('cat'), share('both')]).toEqual([DESIGN.shares.dog, DESIGN.shares.cat, DESIGN.shares.both]);
    expect(round1(share('dog') + share('cat') + share('both'))).toBe(100);
    expect(r.rows.find((x) => x.pet === 'untagged')?.share_of_tagged).toBeNull();
  });

  it('the single-row KPI figures agree: revenue, untagged revenue and the three shares', () => {
    const row = run(data, {}).rows[0];
    expect(row.bundle_revenue).toBe(e.bundleRevenue);
    expect(row.untagged_revenue).toBe(e.byPet.untagged);
    expect([row.dog_share, row.cat_share, row.both_share]).toEqual([DESIGN.shares.dog, DESIGN.shares.cat, DESIGN.shares.both]);
    expect(row.dog_vs_cat_ratio).toBe(Math.round((e.byPet.dog / e.byPet.cat) * 100) / 100);
    expect(row.bundle_orders).toBe(e.bundleOrders);
  });

  it('bundle_sales by bundle: the named rows add to 106,950, the unnamed row holds the rest, named shares add to 100.0', () => {
    const r = run(data, {dimension: 'bundle'});
    expect(cell(r, 'bundle', 'Buy Any 4', 'value')).toBe(e.byBundle['Buy Any 4']);
    expect(cell(r, 'bundle', 'Buy Any 2', 'value')).toBe(e.byBundle['Buy Any 2']);
    const named = r.rows.filter((x) => !String(x.bundle).startsWith('Unnamed'));
    const unnamed = r.rows.find((x) => String(x.bundle).startsWith('Unnamed'));
    expect(sum(named, 'value')).toBe(e.named);
    expect(sum(named, 'value')).toBe(DESIGN.named);
    expect(unnamed?.value).toBe(e.byBundle.unnamed);
    expect(sum(r.rows, 'value')).toBe(e.bundleRevenue);
    expect(round1(sum(named, 'share_of_named'))).toBe(100);
    expect(check(r, 'reconciles')?.status).toBe('ok');
  });

  it('meta.insights carry the design wording, with the figures computed from the data', () => {
    const pets = run(data, {dimension: 'pet_type'}).meta.insights;
    const top = pets.find((i) => i.code === 'top_contributor');
    expect(top?.text).toBe(`Dog accounts for ${DESIGN.shares.dog}% of tagged bundle revenue, ${DESIGN.dogOverCat}× cat.`);
    expect(top?.values).toMatchObject({label: 'Dog', value: e.byPet.dog, runnerUp: 'Cat'});
    const untagged = pets.find((i) => i.code === 'untagged_share');
    expect(untagged?.text).toContain('₱40,350');
    expect(untagged?.text).toContain(`${DESIGN.untaggedShare}%`);
    // Design criterion 12 lists a `concentration` insight for Buy Any 4 (92.8% of named revenue). The code only emits `concentration` for
    // THREE or more named items (chat-insights "does not fire ... with only 2 items (it would repeat top_contributor)"), and the
    // design's own example has two named bundles, so the 92.8% reaches the model through `top_contributor` instead. Pinned here.
    const bundleInsights = run(data, {dimension: 'bundle'}).meta.insights;
    expect(bundleInsights.find((i) => i.code === 'concentration')).toBeUndefined();
    expect(bundleInsights.find((i) => i.code === 'top_contributor')?.text).toBe(`Buy Any 4 accounts for ${DESIGN.buyAny4Share}% of named bundle revenue, 12.9× Buy Any 2.`);
    expect(pets.find((i) => i.code === 'concentration')?.text).toBe('Dog accounts for 66.4% of tagged bundle revenue (₱71,050 of ₱106,950).');
    const matrix = run(data, {dimension: 'bundle_by_pet'}).meta.insights.find((i) => i.code === 'single_item_exclusive');
    expect(matrix?.text).toBe("All of cat's ₱18,050 is Buy Any 4.");
  });

  it('bundle_picks revenue (allocated) sums to the named total overall and to each pet, by SKU and by pet', () => {
    const r = run(data, {metric: 'bundle_picks', dimension: 'sku_by_pet', measure: 'revenue'});
    expect(sum(r.rows, 'total')).toBeCloseTo(e.named, 6);
    expect(sum(r.rows, 'dog')).toBeCloseTo(e.byPet.dog, 6);
    expect(sum(r.rows, 'cat')).toBeCloseTo(e.byPet.cat, 6);
    expect(sum(r.rows, 'both')).toBeCloseTo(e.byPet.both, 6);
    expect(sum(r.rows, 'total')).toBeCloseTo(DESIGN.named, 6);
    expect(check(r, 'reconciles')?.status).toBe('ok');
    expect(r.meta.checks.some((c) => c.status === 'fail')).toBe(false);
    // the headerless sales have no pick detail, so the SKU breakdown says how much it does not cover
    expect(r.meta.caveats.join(' ')).toMatch(/no pick detail/i);
    expect(r.meta.caveats.join(' ')).toContain('₱40,350');
  });

  it('bundle_picks list_value is 139,360 and the discount against the paid price is 32,410 (23.3%)', () => {
    const list = run(data, {metric: 'bundle_picks', dimension: 'sku', measure: 'list_value'});
    const paid = run(data, {metric: 'bundle_picks', dimension: 'sku', measure: 'revenue'});
    const listTotal = sum(list.rows, 'value');
    const paidTotal = sum(paid.rows, 'value');
    expect(listTotal).toBeCloseTo(e.listValue, 6);
    expect(listTotal).toBeCloseTo(DESIGN.listValue, 6);
    expect(listTotal - paidTotal).toBeCloseTo(e.discount, 6);
    expect(listTotal - paidTotal).toBeCloseTo(DESIGN.discount, 6);
    expect(round1(((listTotal - paidTotal) / listTotal) * 100)).toBe(DESIGN.discountPct);
  });

  it('the pet filter keeps each pet\'s figure and nothing else', () => {
    const cat = run(data, {dimension: 'pet_type', pet: 'cat'});
    expect(cell(cat, 'pet', 'cat', 'value')).toBe(e.byPet.cat);
    expect(cell(cat, 'pet', 'dog', 'value')).toBe(0);
  });
});

describe('the older random fixture has different totals, so the INVARIANTS are asserted on it', () => {
  const fx = buildBundleFixture();
  const data: MetricData = {source: 'live', orders: fx.orders, events: [], prices: PRICES, priceChanges: CHANGES, bulkReads: []};
  const pesos = (c: number): number => c / 100;

  it('its totals are not the design figures (this is why the reference fixture exists)', () => {
    expect(fx.expected.bundleRevenueC).not.toBe(DESIGN.bundleRevenue * 100);
    expect(fx.expected.byPetC.dog).not.toBe(DESIGN.dog * 100);
  });

  it('dog + cat + both + untagged = the bundle revenue taken from fx.expected; shares add to 100.0; named + unnamed = the whole', () => {
    const pets = run(data, {dimension: 'pet_type'});
    for (const p of ['dog', 'cat', 'both', 'untagged'] as const) expect(cell(pets, 'pet', p, 'value'), p).toBe(pesos(fx.expected.byPetC[p]));
    expect(sum(pets.rows, 'value')).toBe(pesos(fx.expected.bundleRevenueC));
    expect(Math.abs(sum(pets.rows.filter((x) => x.pet !== 'untagged'), 'share_of_tagged') - 100)).toBeLessThanOrEqual(0.1 + 1e-9);
    const bundles = run(data, {dimension: 'bundle'});
    expect(sum(bundles.rows, 'value')).toBe(pesos(fx.expected.bundleRevenueC));
    expect(cell(bundles, 'bundle', 'Buy Any 4', 'value')).toBe(pesos(fx.expected.byBundleC['Buy Any 4']));
    expect(Math.abs(sum(bundles.rows, 'share_of_named') - 100)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(check(pets, 'reconciles')?.status).toBe('ok');
    expect(check(bundles, 'reconciles')?.status).toBe('ok');
  });

  it('bundle_picks revenue sums to the paid price of the headed bundles, and the list value is a separate, unreconciled valuation', () => {
    const paid = run(data, {metric: 'bundle_picks', dimension: 'sku', measure: 'revenue'});
    const list = run(data, {metric: 'bundle_picks', dimension: 'sku', measure: 'list_value'});
    expect(sum(paid.rows, 'value')).toBeCloseTo(pesos(fx.expected.paidC), 6);
    expect(check(paid, 'reconciles')?.status).toBe('ok');
    expect(sum(list.rows, 'value')).toBeGreaterThan(0);
    expect(check(list, 'reconciles')).toBeUndefined();
  });
});
