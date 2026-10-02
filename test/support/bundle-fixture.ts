// Synthetic bundle-sales fixture. Totals are known by construction (tracked while generating),
// never derived from the code under test. No production data.
import type {PosOrder, PosOrderLine, PetType} from '../../src/pos-sales-types';
import type {PriceChange} from '../../src/pos-price-history';
import type {PetBucket} from '../../src/pos-bundle-compute';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SKUS = Array.from({length: 10}, (_, i) => ({product_id: `p${i + 1}`, name: `SKU ${i + 1}`}));
export const PRICE_4 = 650;
export const PRICE_2 = 550;
export const PRICE_LEGACY = 400;

/** p1: seed 170, then 200 (Sep 8), 240 (Sep 15), 200 (Sep 22). p2..p10 never change: 100 + 10 * index. */
export const CHANGES: PriceChange[] = [
  {product_id: 'p1', old_price: null, new_price: 170, changed_at: '2026-08-01T00:00:00+08:00'},
  {product_id: 'p1', old_price: 170, new_price: 200, changed_at: '2026-09-08T00:00:00+08:00'},
  {product_id: 'p1', old_price: 200, new_price: 240, changed_at: '2026-09-15T00:00:00+08:00'},
  {product_id: 'p1', old_price: 240, new_price: 200, changed_at: '2026-09-22T00:00:00+08:00'},
];
export const PRICES = SKUS.map((s, i) => ({product_id: s.product_id, price: i === 0 ? 200 : 100 + 10 * i}));

const PETS: (PetType | null)[] = ['dog', 'cat', 'both', null];
const bucket = (p: PetType | null): PetBucket => p ?? 'untagged';

function pick(group: string, sku: {product_id: string; name: string}): PosOrderLine {
  return {product_id: sku.product_id, name: sku.name, qty: 1, unit_price: 0, line_total: 0, bundle_group: group};
}
function header(group: string, id: string, name: string, price: number): PosOrderLine {
  return {product_id: null, bundle_id: id, bundle_group: group, name, qty: 1, unit_price: price, line_total: price};
}
function order(id: string, n: number, items: PosOrderLine[], total: number, pet: PetType | null, status = 'completed', discount: number | null = null): PosOrder {
  const dd = String(7 + (n % 21)).padStart(2, '0'); // Sep 7..27
  const hh = String(9 + (n % 9)).padStart(2, '0');
  return {
    id, client_uuid: id, subtotal: total + (discount ?? 0), discount, total, oversold: false, device_id: null,
    payment_method: 'cash', customer_handle: null, status, remarks: null,
    created_at: `2026-09-${dd}T${hh}:15:00+08:00`, edited_at: null, event_id: null, pet_type: pet, items,
  };
}

export interface BundleFixture {
  /** Clean orders: no discounts, no negative residual. */
  orders: PosOrder[];
  /** Hand-built edge cases, kept apart so the base totals stay exact. */
  special: {
    discountedBundle: PosOrder; // header 650, discount 50, total 600 (named part is capped at 600)
    discountedItemized: PosOrder; // no bundle; itemized 300, discount 30, total 270 (negative residual)
    headerOnly: PosOrder; // a 650 header with no picks
    unknownSku: PosOrder; // a 2-pick whose picks have no known price (equal split)
  };
  expected: {
    bundleRevenueC: number;
    byPetC: Record<PetBucket, number>;
    byBundleC: Record<string, number>; // 'Buy Any 4' | 'Buy Any 2' | 'unnamed'
    bundleOrders: number;
    voidedBundleOrders: number;
    pickLines: number; // pick lines inside headed groups (all carry 0 / 0)
    groupsWithoutHeader: number;
    paidC: number; // paid price of headed groups
    voidedCount: number;
  };
}

export function buildBundleFixture(): BundleFixture {
  const rng = mulberry32(20260901);
  const sku = () => SKUS[Math.floor(rng() * SKUS.length)];
  const orders: PosOrder[] = [];
  const e: BundleFixture['expected'] = {
    bundleRevenueC: 0, byPetC: {dog: 0, cat: 0, both: 0, untagged: 0},
    byBundleC: {'Buy Any 4': 0, 'Buy Any 2': 0, unnamed: 0},
    bundleOrders: 0, voidedBundleOrders: 0, pickLines: 0, groupsWithoutHeader: 0, paidC: 0, voidedCount: 0,
  };
  const count = (pet: PetType | null, key: string, price: number) => {
    e.bundleRevenueC += price * 100;
    e.byPetC[bucket(pet)] += price * 100;
    e.byBundleC[key] += price * 100;
  };
  for (let n = 0; n < 41; n++) {
    const id = `o-${n}`;
    const pet = PETS[Math.floor(rng() * PETS.length)];
    const k = n % 8;
    if (k === 0 || k === 1 || k === 2 || k === 7) {
      // A: Buy Any 4 at 650 (every 10th also carries a Buy Any 2 in a second group)
      const g1 = `${id}-1`;
      const items: PosOrderLine[] = [header(g1, 'b4', 'Buy Any 4', PRICE_4), ...[0, 1, 2, 3].map(() => pick(g1, sku()))];
      let total = PRICE_4;
      const voided = k === 7;
      if (n % 10 === 0 && !voided) {
        const g2 = `${id}-2`;
        items.push(header(g2, 'b2', 'Buy Any 2', PRICE_2), pick(g2, sku()), pick(g2, sku()));
        total += PRICE_2;
        count(pet, 'Buy Any 2', PRICE_2);
        e.pickLines += 2;
        e.paidC += PRICE_2 * 100;
      }
      orders.push(order(id, n, items, total, pet, voided ? 'voided' : 'completed'));
      if (voided) {
        e.voidedCount += 1;
        e.voidedBundleOrders += 1;
      } else {
        count(pet, 'Buy Any 4', PRICE_4);
        e.pickLines += 4;
        e.paidC += PRICE_4 * 100;
        e.bundleOrders += 1;
      }
    } else if (k === 3 || k === 4) {
      const g = `${id}-1`;
      orders.push(order(id, n, [header(g, 'b2', 'Buy Any 2', PRICE_2), pick(g, sku()), pick(g, sku())], PRICE_2, pet));
      count(pet, 'Buy Any 2', PRICE_2);
      e.pickLines += 2;
      e.paidC += PRICE_2 * 100;
      e.bundleOrders += 1;
    } else if (k === 5) {
      // Headerless legacy: bundle money only on the order total, picks grouped but no header line.
      const g = `${id}-1`;
      orders.push(order(id, n, [pick(g, sku()), pick(g, sku()), pick(g, sku())], PRICE_LEGACY, pet));
      count(pet, 'unnamed', PRICE_LEGACY);
      e.groupsWithoutHeader += 1;
      e.bundleOrders += 1;
    } else {
      // k === 6: no bundle at all. p4 x2 at 130 + p5 x1 at 140 = 400.
      const line = (i: number, qty: number): PosOrderLine => ({product_id: SKUS[i].product_id, name: SKUS[i].name, qty, unit_price: PRICES[i].price, line_total: PRICES[i].price * qty});
      orders.push(order(id, n, [line(3, 2), line(4, 1)], 400, pet));
    }
  }
  const sp = (id: string, n: number, items: PosOrderLine[], total: number, pet: PetType | null, discount: number | null) => order(id, n, items, total, pet, 'completed', discount);
  const special: BundleFixture['special'] = {
    discountedBundle: sp('s-1', 3, [header('s-1-1', 'b4', 'Buy Any 4', PRICE_4), pick('s-1-1', SKUS[1]), pick('s-1-1', SKUS[2])], 600, 'dog', 50),
    discountedItemized: sp('s-2', 4, [{product_id: 'p2', name: 'SKU 2', qty: 3, unit_price: 100, line_total: 300}], 270, 'cat', 30),
    headerOnly: sp('s-3', 5, [header('s-3-1', 'b4', 'Buy Any 4', PRICE_4)], PRICE_4, null, null),
    unknownSku: sp('s-4', 6, [header('s-4-1', 'b2', 'Buy Any 2', PRICE_2), pick('s-4-1', {product_id: 'zz1', name: 'Ghost A'}), pick('s-4-1', {product_id: 'zz2', name: 'Ghost B'})], PRICE_2, 'both', null),
  };
  return {orders, special, expected: e};
}
