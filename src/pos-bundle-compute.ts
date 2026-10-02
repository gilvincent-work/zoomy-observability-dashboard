// Pure bundle maths: exact centavo allocation, bundle revenue by pet, and the per-pick
// allocation of a bundle's paid price. Money is summed in integer centavos so parts add to
// the whole exactly. Reusable by the pages and by the Ask Coop metrics registry.
import type {PosOrder, PosOrderLine} from './pos-sales-types';
import {priceAt, type PriceHistory} from './pos-price-history';

const toC = (pesos: number): number => Math.round(pesos * 100);
const toPesos = (centavos: number): number => centavos / 100;
const isVoided = (o: PosOrder): boolean => o.status === 'voided';

const WEIGHT_SCALE = 1_000_000;

/** Split pesos by weight in whole centavos (largest remainder; ties to the earlier index). */
export function allocateByWeights(totalPesos: number, weights: number[]): {amounts: number[]; equalSplit: boolean} {
  if (!Number.isFinite(totalPesos) || totalPesos < 0) throw new RangeError('totalPesos must be a finite number >= 0');
  const n = weights.length;
  if (n === 0) return {amounts: [], equalSplit: false};
  const total = BigInt(toC(totalPesos));
  let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? BigInt(Math.round(x * WEIGHT_SCALE)) : BigInt(0)));
  let sum = w.reduce((a, b) => a + b, BigInt(0));
  const equalSplit = sum === BigInt(0);
  if (equalSplit) {
    w = weights.map(() => BigInt(1));
    sum = BigInt(n);
  }
  const base = w.map((x) => (total * x) / sum);
  const rem = w.map((x) => (total * x) % sum);
  let left = Number(total - base.reduce((a, b) => a + b, BigInt(0)));
  const order = rem.map((r, i) => ({r, i})).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const cents = base.map((b) => Number(b));
  for (let k = 0; k < order.length && left > 0; k++, left--) cents[order[k].i] += 1;
  return {amounts: cents.map(toPesos), equalSplit};
}

export type PetBucket = 'dog' | 'cat' | 'both' | 'untagged';
const BUCKETS: PetBucket[] = ['dog', 'cat', 'both', 'untagged'];
const petOf = (o: PosOrder): PetBucket => o.pet_type ?? 'untagged';
const UNNAMED = 'Unnamed bundle (no bundle record)';

export interface BundlePetRow {
  bundle_id: string | null;
  bundle: string;
  dog: number;
  cat: number;
  both: number;
  untagged: number;
  total: number;
  orders: number;
}

export interface BundlePetMatrix {
  rows: BundlePetRow[];
  totals: Record<PetBucket, number>;
  orders: Record<PetBucket, number>;
  bundleRevenue: number;
  namedRevenue: number;
  unnamedRevenue: number;
  negativeResidualOrders: number;
}

const zeroBuckets = (): Record<PetBucket, number> => ({dog: 0, cat: 0, both: 0, untagged: 0});
const isHeader = (l: PosOrderLine): boolean => l.product_id == null && !!l.bundle_id;

interface RowAcc {
  bundle_id: string | null;
  bundle: string;
  cents: Record<PetBucket, number>;
  orderIds: Set<string>;
}

/** Bundle revenue (order total minus its product lines) split by the order's pet tag and by bundle. */
export function bundleRevenueByPet(orders: PosOrder[]): BundlePetMatrix {
  const rows = new Map<string, RowAcc>();
  const totals = zeroBuckets();
  const orderCount = zeroBuckets();
  let namedC = 0;
  let unnamedC = 0;
  let negativeResidualOrders = 0;
  const add = (key: string, bundle_id: string | null, bundle: string, pet: PetBucket, cents: number, orderId: string) => {
    const acc = rows.get(key) ?? {bundle_id, bundle, cents: zeroBuckets(), orderIds: new Set<string>()};
    acc.cents[pet] += cents;
    acc.orderIds.add(orderId);
    rows.set(key, acc);
  };
  for (const o of orders) {
    if (isVoided(o)) continue;
    let productC = 0;
    for (const l of o.items) if (l.product_id) productC += toC(l.line_total);
    const residual = toC(o.total) - productC;
    if (residual < 0) {
      negativeResidualOrders += 1;
      continue;
    }
    if (residual === 0) continue;
    const pet = petOf(o);
    let cap = residual;
    for (const l of o.items) {
      if (!isHeader(l) || cap <= 0) continue;
      const take = Math.min(cap, Math.max(0, toC(l.line_total)));
      if (take <= 0) continue;
      cap -= take;
      namedC += take;
      totals[pet] += take;
      add(`n:${l.name}`, l.bundle_id ?? null, l.name, pet, take, o.id);
    }
    if (cap > 0) {
      unnamedC += cap;
      totals[pet] += cap;
      add('unnamed', null, UNNAMED, pet, cap, o.id);
    }
    orderCount[pet] += 1;
  }
  const out: BundlePetRow[] = [];
  for (const acc of rows.values()) {
    const total = BUCKETS.reduce((s, b) => s + acc.cents[b], 0);
    out.push({
      bundle_id: acc.bundle_id,
      bundle: acc.bundle,
      dog: toPesos(acc.cents.dog),
      cat: toPesos(acc.cents.cat),
      both: toPesos(acc.cents.both),
      untagged: toPesos(acc.cents.untagged),
      total: toPesos(total),
      orders: acc.orderIds.size,
    });
  }
  out.sort((a, b) => b.total - a.total || a.bundle.localeCompare(b.bundle));
  const totalsPesos = zeroBuckets();
  for (const b of BUCKETS) totalsPesos[b] = toPesos(totals[b]);
  return {
    rows: out,
    totals: totalsPesos,
    orders: orderCount,
    bundleRevenue: toPesos(namedC + unnamedC),
    namedRevenue: toPesos(namedC),
    unnamedRevenue: toPesos(unnamedC),
    negativeResidualOrders,
  };
}

export interface BundlePickRow {
  order_id: string;
  bundle_group: string;
  bundle_id: string | null;
  bundle: string;
  product_id: string;
  sku: string;
  pet: PetBucket;
  qty: number;
  list_value: number;
  allocated: number;
  created_at: string;
}

export interface BundlePicksResult {
  rows: BundlePickRow[];
  zeroValueLines: number;
  groupsWithoutHeader: number;
  groupsWithoutPicks: number;
  equalSplitGroups: number;
  paidTotal: number;
  allocatedTotal: number;
  unallocatedPaid: number;
}

/** One row per bundle pick, with the bundle's paid price allocated across its picks by list-price weight at the sale date. */
export function bundlePickRows(orders: PosOrder[], history: PriceHistory): BundlePicksResult {
  const rows: BundlePickRow[] = [];
  let zeroValueLines = 0;
  let groupsWithoutHeader = 0;
  let groupsWithoutPicks = 0;
  let equalSplitGroups = 0;
  let paidC = 0;
  let allocatedC = 0;
  let unallocatedC = 0;
  for (const o of orders) {
    if (isVoided(o)) continue;
    const groups = new Map<string, {headers: PosOrderLine[]; picks: PosOrderLine[]}>();
    for (const l of o.items) {
      if (!l.bundle_group) continue;
      const g = groups.get(l.bundle_group) ?? {headers: [], picks: []};
      if (l.product_id == null) g.headers.push(l);
      else g.picks.push(l);
      groups.set(l.bundle_group, g);
    }
    for (const [group, g] of groups) {
      if (g.headers.length === 0) {
        if (g.picks.length > 0) groupsWithoutHeader += 1;
        continue;
      }
      const groupPaidC = g.headers.reduce((s, h) => s + toC(h.line_total), 0);
      if (g.picks.length === 0) {
        groupsWithoutPicks += 1;
        unallocatedC += groupPaidC;
        continue;
      }
      const prices = g.picks.map((p) => priceAt(history, p.product_id as string, o.created_at));
      const weights = g.picks.map((p, i) => (prices[i] ?? 0) * p.qty);
      const {amounts, equalSplit} = allocateByWeights(toPesos(groupPaidC), weights);
      if (equalSplit) equalSplitGroups += 1;
      paidC += groupPaidC;
      const header = g.headers[0];
      g.picks.forEach((p, i) => {
        if (p.line_total === 0 && p.unit_price === 0) zeroValueLines += 1;
        allocatedC += toC(amounts[i]);
        rows.push({
          order_id: o.id,
          bundle_group: group,
          bundle_id: header.bundle_id ?? null,
          bundle: header.name,
          product_id: p.product_id as string,
          sku: p.name,
          pet: petOf(o),
          qty: p.qty,
          list_value: toPesos(toC((prices[i] ?? 0) * p.qty)),
          allocated: amounts[i],
          created_at: o.created_at,
        });
      });
    }
  }
  return {
    rows,
    zeroValueLines,
    groupsWithoutHeader,
    groupsWithoutPicks,
    equalSplitGroups,
    paidTotal: toPesos(paidC),
    allocatedTotal: toPesos(allocatedC),
    unallocatedPaid: toPesos(unallocatedC),
  };
}

export type PicksBy = 'sku' | 'sku_by_pet' | 'bundle_by_sku';
type PicksMeasure = 'revenue' | 'list_value' | 'units';

/** Group pick rows. Money sums in centavos and comes back in pesos; units sum as plain integers. */
export function aggregatePicks(rows: BundlePickRow[], by: PicksBy, measure: PicksMeasure): Record<string, string | number>[] {
  const unit = (r: BundlePickRow): number => (measure === 'units' ? r.qty : toC(measure === 'revenue' ? r.allocated : r.list_value));
  const out = (n: number): number => (measure === 'units' ? n : toPesos(n));
  const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);
  const grand = rows.reduce((s, r) => s + unit(r), 0);
  // Group by product, not by name: two products can share a name. Colliding names get a short id suffix.
  const idsByName = new Map<string, Set<string>>();
  for (const r of rows) idsByName.set(r.sku, (idsByName.get(r.sku) ?? new Set<string>()).add(r.product_id));
  const label = (r: BundlePickRow): string => ((idsByName.get(r.sku)?.size ?? 1) > 1 ? `${r.sku} (${r.product_id.slice(-6)})` : r.sku);

  if (by === 'sku') {
    const m = new Map<string, number>();
    for (const r of rows) m.set(label(r), (m.get(label(r)) ?? 0) + unit(r));
    return Array.from(m, ([sku, v]) => ({sku, v}))
      .sort((a, b) => b.v - a.v || a.sku.localeCompare(b.sku))
      .map(({sku, v}) => ({sku, value: out(v), share: pct(v, grand)}));
  }
  if (by === 'sku_by_pet') {
    const m = new Map<string, Record<PetBucket, number>>();
    for (const r of rows) {
      const cur = m.get(label(r)) ?? zeroBuckets();
      cur[r.pet] += unit(r);
      m.set(label(r), cur);
    }
    return Array.from(m, ([sku, c]) => ({sku, c, total: BUCKETS.reduce((s, b) => s + c[b], 0)}))
      .sort((a, b) => b.total - a.total || a.sku.localeCompare(b.sku))
      .map(({sku, c, total}) => ({
        sku,
        dog: out(c.dog),
        cat: out(c.cat),
        both: out(c.both),
        untagged: out(c.untagged),
        total: out(total),
        share: pct(total, grand),
      }));
  }
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const inner = m.get(r.bundle) ?? new Map<string, number>();
    inner.set(label(r), (inner.get(label(r)) ?? 0) + unit(r));
    m.set(r.bundle, inner);
  }
  const res: Record<string, string | number>[] = [];
  const bundles = Array.from(m.keys()).sort((a, b) => a.localeCompare(b));
  for (const bundle of bundles) {
    const inner = m.get(bundle) as Map<string, number>;
    const bundleTotal = Array.from(inner.values()).reduce((s, v) => s + v, 0);
    Array.from(inner, ([sku, v]) => ({sku, v}))
      .sort((a, b) => b.v - a.v || a.sku.localeCompare(b.sku))
      .forEach(({sku, v}) => res.push({bundle, sku, value: out(v), share_of_bundle: pct(v, bundleTotal)}));
  }
  return res;
}
