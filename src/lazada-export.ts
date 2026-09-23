/**
 * Pure helpers for the Lazada Seller-Center order export (the SMS-reminder
 * dashboard's data source).
 *
 * The export is one row per ORDER ITEM, so 600 rows can be ~270 orders from
 * ~230 customers. Everything here is a pure transform — spreadsheet rows in,
 * plain objects out — so it runs unchanged in the node test environment. The
 * DOM/ExcelJS-bound parsing lives in `lazada-export.client.js`; the Supabase
 * writes live in the route.
 *
 * Why these particular columns (verified against a real 604-row export):
 *  - `shippingPhone` / `billingPhone2` / `customerEmail` are ALWAYS EMPTY.
 *    `billingPhone` is the only contact number present.
 *  - `customerName` is the account holder: partially masked (`********123`) and
 *    disagrees with the recipient in ~70% of rows. `shippingName` is the
 *    recipient and is never masked, so it is preferred.
 *  - Phone values arrive as `63` + a local `09XXXXXXXXX` (13 digits) or as
 *    `639XXXXXXXXX` (12 digits). Both are the same number.
 */

import type {
  LazadaCustomer,
  LazadaOrderItem,
  LazadaSheetRow,
  LazadaParseStats,
  LazadaSkipped,
  LazadaTotals,
  LazadaUpload,
} from './lazada-types';

/** Header names we read out of the sheet. Everything else is ignored. */
export const REQUIRED_HEADERS = [
  'orderItemId',
  'orderNumber',
  'createTime',
  'status',
  'shippingName',
  'billingName',
  'customerName',
  'billingPhone',
  'billingCity',
  'shippingCity',
  'itemName',
  'variation',
  'paidPrice',
  'shippingFee',
  'payMethod',
];

/**
 * Order statuses excluded from reminders. Texting someone about an order that
 * was canceled, returned or scrapped is worse than not texting them at all.
 */
const EXCLUDED_STATUSES = new Set([
  'canceled',
  'cancelled',
  'returned',
  'package returned',
  'package scrapped',
  'failed delivery',
  'lost by 3pl',
  'damaged by 3pl',
]);

/** @param {unknown} status */
export function isExcludedStatus(status: unknown): boolean {
  return EXCLUDED_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

/** A value Lazada has partially redacted, e.g. `a**b` or `********123`. */
export function isMasked(value: unknown): boolean {
  return String(value ?? '').includes('*');
}

/**
 * Normalize a Lazada phone value to E.164 (`+639XXXXXXXXX`).
 *
 * Accepts `639XXXXXXXXX` (12 digits), `63` + `09XXXXXXXXX` (13 digits, the
 * common case — the country code kept in front of the local trunk zero), the
 * bare local `09XXXXXXXXX`, and any of those with spaces/dashes/leading `+`.
 * Returns null for anything that is not a PH mobile number, so junk is dropped
 * rather than texted.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;

  let local = null;
  if (digits.length === 13 && digits.startsWith('630')) {
    local = digits.slice(2); // 63 + 09XXXXXXXXX
  } else if (digits.length === 12 && digits.startsWith('639')) {
    local = `0${digits.slice(2)}`; // 63 + 9XXXXXXXXX
  } else if (digits.length === 11 && digits.startsWith('09')) {
    local = digits; // bare local
  } else if (digits.length === 10 && digits.startsWith('9')) {
    local = `0${digits}`;
  }
  if (!local || !/^09\d{9}$/.test(local)) return null;
  return `+63${local.slice(1)}`;
}

/**
 * The recipient's display name: `shippingName`, then `billingName`, then
 * `customerName` — skipping masked and empty values at each step.
 * @param {Record<string, any>} row
 * @returns {string | null}
 */
export function pickName(row: LazadaSheetRow): string | null {
  for (const key of ['shippingName', 'billingName', 'customerName']) {
    const value = String(row?.[key] ?? '').trim();
    if (value && !isMasked(value)) return value;
  }
  return null;
}

/** City: billing, falling back to shipping. */
export function pickCity(row: LazadaSheetRow): string | null {
  for (const key of ['billingCity', 'shippingCity']) {
    const value = String(row?.[key] ?? '').trim();
    if (value && !isMasked(value)) return value;
  }
  return null;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse the export's `createTime` — `"30 Jul 2026 14:35"` — into an ISO string.
 *
 * Parsed explicitly rather than handed to `new Date(string)`, whose handling of
 * this format is implementation-defined. Lazada PH timestamps are Manila local
 * time, so the offset is fixed at +08:00 and the result is deterministic
 * regardless of where the code runs.
 *
 * Also accepts a real Date (ExcelJS returns one when the cell is date-typed).
 *
 * @param {unknown} raw
 * @returns {string | null} ISO 8601, or null when unparseable
 */
export function parseLazadaDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  }
  const text = String(raw ?? '').trim();
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  if (!m) return null;
  const [, day, mon, year, hour = '00', min = '00'] = m;
  const month = (MONTHS as Record<string, string>)[mon.toLowerCase()];
  if (!month) return null;
  const iso = `${year}-${month}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${min}:00+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Turn raw sheet rows into storable order-item records, dropping rows that
 * cannot be used: excluded statuses, unusable phone numbers, unparseable dates,
 * and rows with no `orderItemId` (the storage key).
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {{items: Array<object>, skipped: {status: number, phone: number, date: number, id: number}}}
 */
export function rowsToOrderItems(
  rows: LazadaSheetRow[] = [],
): {items: LazadaOrderItem[]; skipped: LazadaSkipped} {
  const items: LazadaOrderItem[] = [];
  const skipped: LazadaSkipped = {status: 0, phone: 0, date: 0, id: 0};
  const seen = new Set<string>();

  for (const row of rows) {
    const orderItemId = String(row?.orderItemId ?? '').trim();
    if (!orderItemId) {
      skipped.id += 1;
      continue;
    }
    if (isExcludedStatus(row.status)) {
      skipped.status += 1;
      continue;
    }
    const phone = normalizePhone(row.billingPhone);
    if (!phone) {
      skipped.phone += 1;
      continue;
    }
    const orderedAt = parseLazadaDate(row.createTime);
    if (!orderedAt) {
      skipped.date += 1;
      continue;
    }
    // A single export can list the same order item twice; last write wins.
    if (seen.has(orderItemId)) continue;
    seen.add(orderItemId);

    items.push({
      order_item_id: orderItemId,
      order_number: String(row.orderNumber ?? '').trim() || null,
      ordered_at: orderedAt,
      status: String(row.status ?? '').trim() || null,
      customer_name: pickName(row),
      city: pickCity(row),
      phone,
      item_name: String(row.itemName ?? '').trim() || null,
      variation: cleanVariation(row.variation),
      paid_price: parseAmount(row.paidPrice),
      shipping_fee: parseAmount(row.shippingFee),
      pay_method: payMethodLabel(row.payMethod),
    });
  }

  return {items, skipped};
}

/**
 * Parse a Lazada money cell.
 *
 * The export ships amounts as STRINGS ('184.00'), occasionally with thousands
 * separators, and blank for absent values. Verified against a real export:
 * `paidPrice` is what the buyer actually paid for that item INCLUDING shipping
 * and after discounts — 139.00 unit + 45.00 shipping = 184.00 paid, and
 * 144.53 unit − 11.56 discount + 0.00 shipping = 132.97 paid. So summing
 * `paidPrice` gives a buyer's true outlay without double-counting.
 *
 * @param {unknown} raw
 * @returns {number | null} null when absent or unparseable
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? '').replace(/[^0-9.-]/g, '');
  if (!text || text === '-' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip the attribute name off a Lazada variation.
 *
 * The export stores the attribute and its value together — `Type:Chicken Breast`,
 * `Pet Food Flavors & Ingredients:Chicken`, `Flavor:B1T1 Salmon Cubes` — and the
 * attribute name differs per listing, so only the value is worth showing.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function cleanVariation(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const idx = text.indexOf(':');
  const value = (idx === -1 ? text : text.slice(idx + 1)).trim();
  return value || null;
}

/** Lazada payment codes → what a human calls them. */
const PAY_LABELS = {
  COD: 'COD',
  GCASH_PP: 'GCash',
  MIXEDCARD: 'Card',
  PAY_LATER: 'Pay Later',
  QRPH: 'QR Ph',
  PAYMENT_ACCOUNT: 'Lazada Wallet',
  WALLET_PAYMAYA2C2P: 'Maya',
};

/**
 * A readable payment-method label. Unknown codes are title-cased rather than
 * dropped, so a new Lazada payment type shows up as itself instead of blank.
 * @param {unknown} raw
 */
export function payMethodLabel(raw: unknown): string | null {
  const code = String(raw ?? '').trim();
  if (!code) return null;
  const known = (PAY_LABELS as Record<string, string>)[code.toUpperCase()];
  if (known) return known;
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Rank what is actually selling, at product + flavour grain.
 *
 * `orders` counts DISTINCT orders containing that variant, not line items, so a
 * shopper buying three bags in one order counts once — the same rule the customer
 * table uses, otherwise the two tables would disagree.
 *
 * @param {Array<object>} items rows as stored (snake_case)
 */
export function productRanking(
  items: Array<Partial<LazadaOrderItem>> = [],
) {
  const byKey = new Map();

  for (const it of items) {
    const product = (it.item_name ?? '').trim() || 'Unknown product';
    const variant = it.variation ?? null;
    const key = `${product}\u0000${variant ?? ''}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {product, variant, orders: new Set(), buyers: new Set(), items: 0, revenue: 0};
      byKey.set(key, rec);
    }
    rec.items += 1;
    rec.spend += Number(it.paid_price) || 0;
    if (it.order_number) rec.orders.add(it.order_number);
    if (it.phone) rec.buyers.add(it.phone);
    rec.revenue += Number(it.paid_price) || 0;
  }

  return [...byKey.values()]
    .map((r) => ({
      product: r.product,
      variant: r.variant,
      orders: r.orders.size || r.items,
      buyers: r.buyers.size,
      items: r.items,
      revenue: Math.round(r.revenue * 100) / 100,
    }))
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue || a.product.localeCompare(b.product));
}

/**
 * Count the buyers a status exclusion removes from the list entirely.
 *
 * Someone whose canceled order sits alongside a delivered one still appears in
 * the dashboard; someone whose ONLY orders were canceled or returned vanishes.
 * That second group is why the buyer count lands below a naive "distinct phone
 * numbers in the file" tally, and the difference is worth showing rather than
 * leaving to be rediscovered.
 *
 * Counted at parse time because excluded rows are deliberately never stored —
 * there is no reason to keep the PII of someone the list will never contact.
 *
 * @param {Array<Record<string, any>>} rows raw sheet rows
 * @returns {{excludedItems: number, excludedBuyers: number}}
 */
export function summarizeExclusions(rows: LazadaSheetRow[] = []) {
  const kept = new Set();
  const excluded = new Set();
  let excludedItems = 0;

  for (const row of rows) {
    const phone = normalizePhone(row?.billingPhone);
    if (!phone) continue; // unusable either way; counted under `skipped.phone`
    if (isExcludedStatus(row?.status)) {
      excludedItems += 1;
      excluded.add(phone);
    } else {
      kept.add(phone);
    }
  }

  let excludedBuyers = 0;
  for (const phone of excluded) if (!kept.has(phone)) excludedBuyers += 1;
  return {excludedItems, excludedBuyers};
}

/**
 * Collapse stored order items into one row per customer, keyed by phone.
 *
 * `orderCount` counts DISTINCT orders, not items — a 3-item order is one
 * purchase. Name/city/product come from the customer's most recent order, so
 * the dashboard shows their current details rather than whatever the oldest row
 * happened to say. `daysSince` is computed here (server-side) on purpose: doing
 * it at render time causes hydration mismatches.
 *
 * @param {Array<object>} items rows as stored (snake_case)
 * @param {number} now ms epoch, injected so tests are deterministic
 */
export function itemsToCustomers(items: LazadaOrderItem[] = [], now: number = Date.now()): LazadaCustomer[] {
  type Rollup = {
    phone: string;
    name: string | null;
    city: string | null;
    lastOrderAt: string;
    firstOrderAt: string;
    lastProduct: string | null;
    payMethod: string | null;
    spend: number;
    orders: Set<string>;
    items: number;
  };
  const byPhone = new Map<string, Rollup>();

  for (const it of items) {
    const phone = it.phone;
    if (!phone) continue;
    const at = it.ordered_at;
    let rec = byPhone.get(phone);
    if (!rec) {
      rec = {
        phone,
        name: it.customer_name ?? null,
        city: it.city ?? null,
        lastOrderAt: at,
        firstOrderAt: at,
        lastProduct: it.item_name ?? null,
        payMethod: it.pay_method ?? null,
        spend: 0,
        orders: new Set(),
        items: 0,
      };
      byPhone.set(phone, rec);
    }
    rec.items += 1;
    rec.spend += Number(it.paid_price) || 0;
    if (it.order_number) rec.orders.add(it.order_number);
    if (at < rec.firstOrderAt) rec.firstOrderAt = at;
    if (at > rec.lastOrderAt) {
      rec.lastOrderAt = at;
      rec.lastProduct = it.item_name ?? rec.lastProduct;
      rec.name = it.customer_name ?? rec.name;
      rec.city = it.city ?? rec.city;
      rec.payMethod = it.pay_method ?? rec.payMethod;
    }
  }

  const out = [...byPhone.values()].map((r) => {
    const orderCount = r.orders.size || (r.items > 0 ? 1 : 0);
    const totalSpent = Math.round(r.spend * 100) / 100;
    return {
      phone: r.phone,
      name: r.name,
      city: r.city,
      lastOrderAt: r.lastOrderAt,
      firstOrderAt: r.firstOrderAt,
      lastProduct: r.lastProduct,
      payMethod: r.payMethod,
      totalSpent,
      // Average per ORDER, not per item — the figure a merchant reasons about.
      avgOrder: orderCount ? Math.round((totalSpent / orderCount) * 100) / 100 : 0,
      orderCount,
      daysSince: Math.floor((now - new Date(r.lastOrderAt).getTime()) / 86_400_000),
    };
  });

  // Most overdue first — the reminder-worthy end of the list.
  out.sort((a, b) => b.daysSince - a.daysSince || String(a.name).localeCompare(String(b.name)));
  return out;
}

/**
 * The display form of a Lazada product title.
 *
 * Lazada titles are SEO-stuffed: the real name comes first, then keyword filler
 * after a pipe — "Zoomy! Freeze Dried Superfood Munchies | Beef Blueberry Chicken
 * Cranberry Pumpkin Duck Pear Apple | Pet Treats...". Four variants of one product
 * then render as four identical truncated strings, making the column dead weight
 * while the flavour column does all the disambiguating. Cutting at the first pipe
 * restores the actual name.
 *
 * Display only — exports keep the full title, which is the real data.
 *
 * @param {unknown} raw
 * @returns {string} the full title when there is no pipe, or it would empty out
 */
export function productDisplayName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const head = text.split('|')[0].trim();
  return head || text;
}

/**
 * How stale the loaded data is, from the newest order it contains.
 *
 * This matters more than it looks: an export whose window closed weeks ago makes
 * every buyer read as "overdue" regardless of behaviour, so a days-since
 * threshold ends up measuring the spreadsheet's age rather than the customer's.
 * Computed server-side for the same reason `daysSince` is — client-side date math
 * here trips a hydration mismatch.
 *
 * @param {string | null} newestOrderAt
 * @param {number} now ms epoch, injected so tests are deterministic
 * @returns {{ageDays: number, tone: 'fresh' | 'aging' | 'stale'} | null}
 */
export function dataFreshness(newestOrderAt: string | null | undefined, now: number = Date.now()) {
  if (!newestOrderAt) return null;
  const t = new Date(newestOrderAt).getTime();
  if (Number.isNaN(t)) return null;
  const ageDays = Math.max(0, Math.floor((now - t) / 86_400_000));
  // Past a fortnight the export is old enough to distort the overdue sort; past
  // the ~34-day median reorder cycle it can no longer speak to who has lapsed.
  const tone = ageDays <= 14 ? 'fresh' : ageDays <= 34 ? 'aging' : 'stale';
  return {ageDays, tone};
}

/**
 * Build the aggregate ledger row for an upload.
 *
 * Counts only — never names, phones or order IDs. `buyers` and `items_saved` are
 * recomputed from the payload rather than trusted from the client; the parse-time
 * figures that cannot be recomputed server-side (rows read, per-reason skips,
 * excluded buyers) are coerced to non-negative integers.
 *
 * @param {Array<{phone: string}>} items the records being saved
 * @param {any} stats client-reported parse statistics
 * @param {string | undefined} fileName
 */
export function buildUploadSummary(
  items: Array<Pick<LazadaOrderItem, 'phone'> & Partial<LazadaOrderItem>> = [],
  stats: LazadaParseStats = {},
  fileName?: string,
) {
  const int = (v: unknown): number => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const skipped: Partial<Record<keyof LazadaSkipped, unknown>> = stats?.skipped ?? {};
  return {
    file_name: typeof fileName === 'string' && fileName ? fileName.slice(0, 260) : null,
    rows_read: int(stats?.total),
    items_saved: items.length,
    buyers: new Set(items.map((i) => i?.phone).filter(Boolean)).size,
    skipped_status: int(skipped.status),
    skipped_phone: int(skipped.phone),
    skipped_date: int(skipped.date),
    skipped_id: int(skipped.id),
    excluded_buyers: int(stats?.exclusions?.excludedBuyers),
  };
}

/**
 * Classify a failure from the Supabase/PostgREST client into something the page
 * can act on.
 *
 * The table not existing is not an exceptional condition — it is the normal
 * state of a freshly-pointed environment, which always has `SUPABASE_URL` set
 * before anyone has run `supabase/lazada_orders.sql`. PostgREST answers an
 * unknown table with a 404 and a `PGRST205` code, so that case is separated out
 * and turned into an instruction rather than an error page.
 *
 * @param {unknown} err
 * @returns {{kind: 'missing-table' | 'unknown', message: string}}
 */
export function classifySupabaseError(err: unknown): {kind: 'missing-table' | 'unknown'; message: string} {
  const message = String((err as {message?: unknown})?.message ?? err ?? 'Unknown error');
  const missingTable =
    message.includes('PGRST205') ||
    /\b404\b/.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message);
  return {kind: missingTable ? 'missing-table' : 'unknown', message};
}

/**
 * Headline numbers for the stat tiles.
 * @param {Array<ReturnType<typeof itemsToCustomers>[number]>} customers
 */
export function summarize(
  customers: Array<
    // totalSpent stays optional: rows from an install predating the money
    // migration carry no spend, and the tiles must still add up.
    Pick<LazadaCustomer, 'city' | 'orderCount' | 'firstOrderAt' | 'lastOrderAt'> &
      Partial<LazadaCustomer>
  > = [],
): LazadaTotals {
  if (!customers.length) {
    return {customers: 0, orders: 0, repeatCustomers: 0, cities: 0, revenue: 0, oldestOrderAt: null, newestOrderAt: null};
  }
  let orders = 0;
  let repeat = 0;
  let revenue = 0;
  let oldest = customers[0].firstOrderAt;
  let newest = customers[0].lastOrderAt;
  const cities = new Set<string>();
  for (const c of customers) {
    orders += c.orderCount;
    revenue += Number(c.totalSpent) || 0;
    if (c.orderCount > 1) repeat += 1;
    if (c.city) cities.add(c.city.toLowerCase());
    if (c.firstOrderAt < oldest) oldest = c.firstOrderAt;
    if (c.lastOrderAt > newest) newest = c.lastOrderAt;
  }
  return {
    customers: customers.length,
    orders,
    repeatCustomers: repeat,
    cities: cities.size,
    revenue: Math.round(revenue * 100) / 100,
    oldestOrderAt: oldest,
    newestOrderAt: newest,
  };
}
