// Pure list-price history: what a product cost on a given day, from the price-change log
// (never today's price). Used to value bundle picks at the price in effect when they sold.

export interface PriceChange {
  product_id: string;
  old_price: number | null; // null = the seed row (the first recorded price, not a real change)
  new_price: number;
  changed_at: string; // ISO
}

interface Stamped {
  at: number; // epoch ms
  old_price: number | null;
  new_price: number;
}

export interface PriceHistory {
  current: ReadonlyMap<string, number>;
  changes: ReadonlyMap<string, Stamped[]>; // ascending by time
  all: Stamped[]; // every change, any product, ascending
}

const DAY_MS = 86_400_000;

export function buildPriceHistory(prices: {product_id: string; price: number}[], changes: PriceChange[]): PriceHistory {
  const current = new Map<string, number>();
  for (const p of prices) current.set(p.product_id, p.price);
  const byProduct = new Map<string, Stamped[]>();
  const all: Stamped[] = [];
  for (const c of changes) {
    const at = Date.parse(c.changed_at);
    if (Number.isNaN(at)) continue;
    const s: Stamped = {at, old_price: c.old_price, new_price: c.new_price};
    const list = byProduct.get(c.product_id) ?? [];
    list.push(s);
    byProduct.set(c.product_id, list);
    all.push(s);
  }
  for (const list of byProduct.values()) list.sort((a, b) => a.at - b.at);
  all.sort((a, b) => a.at - b.at);
  return {current, changes: byProduct, all};
}

/** The price in effect at an instant: latest change at or before it; before the first change, the
 *  first change's old price (else its new price); no changes, today's price; unknown product, null. */
export function priceAt(history: PriceHistory, productId: string, atIso: string): number | null {
  const list = history.changes.get(productId);
  if (!list || list.length === 0) return history.current.get(productId) ?? null;
  const at = Date.parse(atIso);
  if (Number.isNaN(at)) return null;
  let found: Stamped | null = null;
  for (const c of list) {
    if (c.at <= at) found = c;
    else break;
  }
  if (found) return found.new_price;
  const first = list[0];
  return first.old_price ?? first.new_price;
}

/** Real list-price changes (seed rows excluded) inside [from, to], and the span in whole days (min 1). */
export function priceChangesInRange(history: PriceHistory, fromIso: string, toIso: string): {count: number; spanDays: number} {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return {count: 0, spanDays: 1};
  let count = 0;
  for (const c of history.all) {
    if (c.old_price === null) continue;
    if (c.at >= from && c.at <= to) count += 1;
  }
  return {count, spanDays: Math.max(1, Math.round((to - from) / DAY_MS))};
}
