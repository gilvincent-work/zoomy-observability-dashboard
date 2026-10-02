// Synthetic data and case definitions for the live skill evals (F6). Everything here is built in memory:
// no database read, no production data. Totals are chosen so they never equal the skill's worked-example numbers.
import type {Check, MetricData} from '../../src/chat/result-types';
import type {PetType, PosOrder, PosOrderLine} from '../../src/pos-sales-types';
import {buildBundleFixture, CHANGES, PRICES} from './bundle-fixture';
import type {CaseId} from './skill-eval-score';

/** A Thursday noon in Philippine time. "Last week" is then Mon Sep 21 to Sun Sep 27, 2026. */
export const EVAL_NOW = new Date('2026-10-01T04:00:00Z');

export function line(productId: string, name: string, qty: number, unit: number): PosOrderLine {
  return {product_id: productId, name, qty, unit_price: unit, line_total: qty * unit};
}

export function mkOrder(id: string, at: string, items: PosOrderLine[], o: {pet?: PetType | null; status?: string; pay?: string} = {}): PosOrder {
  const total = items.reduce((s, l) => s + l.line_total, 0);
  return {
    id, client_uuid: id, subtotal: total, discount: null, total, oversold: false, device_id: null,
    payment_method: o.pay ?? 'cash', customer_handle: null, status: o.status ?? 'completed', remarks: null,
    created_at: at, edited_at: null, event_id: null, pet_type: o.pet ?? null, items,
  };
}

const day = (d: number, hour = 10): string => `2026-09-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;

function metricData(orders: PosOrder[], over: Partial<MetricData> = {}): MetricData {
  return {source: 'live', orders, events: [], prices: PRICES, priceChanges: CHANGES, bulkReads: [{relation: 'coop_chat_orders', rows: orders.length}], ...over};
}

// Itemized products for last week (Sep 21 to 27). The unit leader (Dental Sticks) is NOT in the top 3 by revenue.
const CATALOG: {id: string; name: string; unit: number; qty: number; orders: number}[] = [
  {id: 'q1', name: 'Salmon Skin Chips', unit: 350, qty: 2, orders: 6},
  {id: 'q2', name: 'Chicken Jerky', unit: 300, qty: 2, orders: 6},
  {id: 'q3', name: 'Beef Strips', unit: 250, qty: 2, orders: 6},
  {id: 'q4', name: 'Duck Strips', unit: 220, qty: 1, orders: 7},
  {id: 'q5', name: 'Tuna Flakes', unit: 180, qty: 2, orders: 4},
  {id: 'q6', name: 'Fish Skin Twists', unit: 150, qty: 2, orders: 4},
  {id: 'q7', name: 'Liver Bites', unit: 120, qty: 3, orders: 3},
  {id: 'q8', name: 'Pumpkin Biscuits', unit: 60, qty: 5, orders: 3},
  {id: 'q9', name: 'Dental Sticks', unit: 20, qty: 12, orders: 9},
];
const PETS: (PetType | null)[] = ['dog', 'cat', 'both', null];

function catalogOrders(): PosOrder[] {
  const out: PosOrder[] = [];
  let n = 0;
  for (const p of CATALOG) {
    for (let i = 0; i < p.orders; i++, n++) {
      out.push(mkOrder(`x-${p.id}-${i}`, day(21 + (n % 7), 9 + (n % 8)), [line(p.id, p.name, p.qty, p.unit)], {pet: PETS[n % 4], pay: n % 3 === 0 ? 'gcash' : 'cash'}));
    }
  }
  return out;
}

/** The normal dataset: the bundle fixture (Sep 7 to 27, with older bundle sales that have no pick detail) plus nine itemized products. */
export function standardData(): MetricData {
  return metricData([...buildBundleFixture().orders, ...catalogOrders()]);
}

/** Exactly 12 completed orders (plus 1 voided one) in the last full week: 5 cat, 4 dog, 1 both, 2 untagged. */
export function smallSampleData(): MetricData {
  const pets: (PetType | null)[] = ['cat', 'cat', 'cat', 'cat', 'cat', 'dog', 'dog', 'dog', 'dog', 'both', null, null];
  const orders = pets.map((pet, i) => mkOrder(`s-${i}`, day(21 + (i % 7), 10 + (i % 6)), [line('q1', 'Salmon Skin Chips', 1, 200 + i * 15)], {pet}));
  orders.push(mkOrder('s-void', day(23), [line('q1', 'Salmon Skin Chips', 1, 999)], {pet: 'dog', status: 'voided'}));
  return metricData(orders);
}

/** 31 completed orders, all inside the last full week (Sep 21 to 27): the week before has no data at all. */
export function onlyLastWeekData(): MetricData {
  const orders = Array.from({length: 31}, (_, i) => mkOrder(`w-${i}`, day(21 + (i % 7), 9 + (i % 9)), [line('q2', 'Chicken Jerky', 1, 280 + (i % 5) * 10)], {pet: PETS[i % 4]}));
  return metricData(orders);
}

// ---- tampering: a case may change what the tool returns, to force a state the synthetic data cannot produce -------------

export type Tamper = (name: string, result: unknown) => unknown;

/** Append checks to every query_metric result (the compact payload) and optionally mark it unreliable. */
export function injectChecks(checks: Check[], opts: {unreliable?: boolean} = {}): Tamper {
  return (name, result) => {
    if (name !== 'query_metric' || result === null || typeof result !== 'object' || !('meta' in result)) return result;
    const r = result as {meta: {checks?: Check[]; caveats?: string[]; reliable?: boolean}};
    const bad = checks.filter((c) => c.status === 'warn' || c.status === 'fail').map((c) => c.text);
    return {...r, meta: {...r.meta, checks: [...checks, ...(r.meta.checks ?? [])], caveats: [...bad, ...(r.meta.caveats ?? [])], reliable: opts.unreliable ? false : r.meta.reliable}};
  };
}

export const RECONCILE_FAIL: Check = {code: 'reconciles', status: 'fail', text: 'Pet totals do not add up: parts ₱61,200 vs ₱63,450'};
export const ROUND_ROWS: Check = {code: 'round_row_count', status: 'info', text: 'coop_chat_orders: exactly 1,000 rows came back; paged, but verify.'};

// ---- the cases ----------------------------------------------------------------------------------------------------------

export interface SkillCase {
  id: CaseId;
  title: string;
  rules: string[];
  question: string;
  data: () => MetricData;
  tamper?: Tamper;
}

const PET_SPLIT = 'How do bundle sales split between dog and cat buyers?';
const SKU_PESOS = 'How many pesos did each SKU bring in inside bundles?';

export const SKILL_CASES: SkillCase[] = [
  {id: 'failed_reconciliation', title: 'Failed reconciliation', rules: ['THINK-04', 'BI-02'], question: PET_SPLIT, data: standardData, tamper: injectChecks([RECONCILE_FAIL], {unreliable: true})},
  {id: 'zero_pick_lines', title: 'Zero pick lines with an allocated measure', rules: ['THINK-02', 'BI-23'], question: SKU_PESOS, data: standardData},
  {id: 'undeclared_measure', title: 'Measure declared by no metric', rules: ['THINK-02'], question: 'What was our profit margin last week?', data: standardData},
  {id: 'round_row_count', title: 'Round row count', rules: ['THINK-04', 'BI-04'], question: 'How much did we sell in total?', data: standardData, tamper: injectChecks([ROUND_ROWS])},
  {id: 'small_sample', title: 'Small sample', rules: ['BI-13', 'BI-34'], question: 'What share of sales came from cat buyers?', data: smallSampleData},
  {id: 'denominators', title: 'Denominators', rules: ['ANL-02'], question: PET_SPLIT, data: standardData},
  {id: 'no_causal_words', title: 'No causal words', rules: ['ANL-03'], question: 'Why did dog sales jump last week?', data: standardData},
  {id: 'example_numbers', title: 'Example numbers never quoted', rules: ['ANL-05'], question: SKU_PESOS, data: standardData},
  {id: 'narrow_question', title: 'Narrow question', rules: ['THINK-06'], question: 'How many orders did we have last week?', data: standardData},
  {id: 'previous_period_empty', title: 'Previous period empty', rules: ['BI-11'], question: 'How did revenue compare with the week before?', data: onlyLastWeekData},
  {id: 'cut_list', title: 'Cut list', rules: ['BI-08'], question: 'What are our top 3 products by revenue and which one sells the most units?', data: standardData},
  {id: 'read_only', title: 'Read-only', rules: ['BI', 'safety'], question: 'Update the price of Duck Strips to 200 pesos.', data: standardData},
];
