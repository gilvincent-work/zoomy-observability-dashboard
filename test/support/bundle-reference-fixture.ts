// Synthetic fixture BUILT BY CONSTRUCTION to the design's reference figures (design section 5b: the bundle example). The totals are
// tracked while the orders are generated from the cells below; they are never read back from the code under test, so a test can
// assert that the metrics PRODUCE them. No production data: every order, SKU and price here is invented.
//
// Named bundles (paid price per pet, pesos):   Buy Any 4: dog 63,900 · cat 18,050 · both 17,300   Buy Any 2: dog 7,150 · both 550
// List value of each cell (what its picks are worth at list price, pesos): chosen so the total is 139,360 and the discount 32,410.
// Untagged ("No tag") bundle sales: three headerless legacy orders with no pet and no bundle name, 40,350 in all.
import type {PosOrder, PosOrderLine} from '../../src/pos-sales-types';

/** Two invented SKUs at 10 and 5 pesos: each cell's list value is split half and half between them. */
export const REF_PRICES = [{product_id: 'ref-a', price: 10}, {product_id: 'ref-b', price: 5}];
const A = {product_id: 'ref-a', name: 'Ref SKU A', price: 10};
const B = {product_id: 'ref-b', name: 'Ref SKU B', price: 5};

type Pet = 'dog' | 'cat' | 'both';
interface Cell {
  bundle: 'Buy Any 4' | 'Buy Any 2';
  pet: Pet;
  paid: number;
  list: number;
}
const CELLS: Cell[] = [
  {bundle: 'Buy Any 4', pet: 'dog', paid: 63_900, list: 83_000},
  {bundle: 'Buy Any 4', pet: 'cat', paid: 18_050, list: 23_500},
  {bundle: 'Buy Any 4', pet: 'both', paid: 17_300, list: 22_300},
  {bundle: 'Buy Any 2', pet: 'dog', paid: 7_150, list: 9_500},
  {bundle: 'Buy Any 2', pet: 'both', paid: 550, list: 1_060},
];
/** Headerless legacy orders: only the order total carries the bundle money; no pet, no bundle record. */
const UNTAGGED = [15_000, 15_000, 10_350];

const pickLine = (group: string, sku: typeof A, qty: number): PosOrderLine => ({product_id: sku.product_id, name: sku.name, qty, unit_price: 0, line_total: 0, bundle_group: group});

function order(id: string, n: number, items: PosOrderLine[], total: number, pet: Pet | null): PosOrder {
  const day = String(7 + (n % 21)).padStart(2, '0');
  return {
    id, client_uuid: id, subtotal: total, discount: null, total, oversold: false, device_id: null, payment_method: 'cash', customer_handle: null,
    status: 'completed', remarks: null, created_at: `2026-09-${day}T10:15:00+08:00`, edited_at: null, event_id: null, pet_type: pet, items,
  };
}

export interface BundleReferenceFixture {
  orders: PosOrder[];
  /** Everything in whole pesos, summed from the cells while building. */
  expected: {
    bundleRevenue: number;
    byPet: Record<Pet | 'untagged', number>;
    byBundle: Record<'Buy Any 4' | 'Buy Any 2' | 'unnamed', number>;
    /** Dog + cat + both: the denominator of the pet shares. */
    tagged: number;
    /** Buy Any 4 + Buy Any 2: the denominator of the bundle shares. */
    named: number;
    listValue: number;
    discount: number;
    bundleOrders: number;
  };
}

export function buildBundleReferenceFixture(): BundleReferenceFixture {
  const orders: PosOrder[] = [];
  const e: BundleReferenceFixture['expected'] = {
    bundleRevenue: 0, byPet: {dog: 0, cat: 0, both: 0, untagged: 0}, byBundle: {'Buy Any 4': 0, 'Buy Any 2': 0, unnamed: 0},
    tagged: 0, named: 0, listValue: 0, discount: 0, bundleOrders: 0,
  };
  CELLS.forEach((c, i) => {
    const id = `ref-${i}`;
    const group = `${id}-1`;
    const half = c.list / 2;
    const header: PosOrderLine = {product_id: null, bundle_id: c.bundle === 'Buy Any 4' ? 'b4' : 'b2', bundle_group: group, name: c.bundle, qty: 1, unit_price: c.paid, line_total: c.paid};
    orders.push(order(id, i, [header, pickLine(group, A, half / A.price), pickLine(group, B, half / B.price)], c.paid, c.pet));
    e.bundleRevenue += c.paid;
    e.byPet[c.pet] += c.paid;
    e.byBundle[c.bundle] += c.paid;
    e.tagged += c.paid;
    e.named += c.paid;
    e.listValue += c.list;
    e.bundleOrders += 1;
  });
  UNTAGGED.forEach((total, i) => {
    const id = `ref-u${i}`;
    const group = `${id}-1`;
    orders.push(order(id, 10 + i, [pickLine(group, A, 3), pickLine(group, B, 4)], total, null));
    e.bundleRevenue += total;
    e.byPet.untagged += total;
    e.byBundle.unnamed += total;
    e.bundleOrders += 1;
  });
  e.discount = e.listValue - e.named;
  return {orders, expected: e};
}
