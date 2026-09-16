// Pure helpers for the merged Inventory page: monthly sell-through rollups (the
// "This month / Last month / 3mo / trend" columns) and the default Category sort
// order (matching the Line/Type filter pills). Kept free of server/client
// concerns so it's unit-testable, mirroring pos-forecast-compute.ts.

import {POS_CATEGORIES, POS_SUBCATEGORIES} from './pos-format';
import type {PosOrder} from './pos-sales-types';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Manila calendar month (YYYY-MM) an ISO instant falls on. */
export function manilaMonthKey(iso: string): string {
  return new Date(new Date(iso).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 7);
}

/** Whole months between two YYYY-MM keys (a - b), e.g. '2026-05' - '2026-03' = 2. */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return ay * 12 + am - (by * 12 + bm);
}

export interface MonthlySales {
  thisMonth: number;
  lastMonth: number;
  twoMonthsAgo: number;
  threeMonthTotal: number;
  trend: number[]; // [twoMonthsAgo, lastMonth, thisMonth] for the sparkline
}

const EMPTY: MonthlySales = {thisMonth: 0, lastMonth: 0, twoMonthsAgo: 0, threeMonthTotal: 0, trend: [0, 0, 0]};

/** A zeroed monthly-sales record (for products with no sales). */
export function emptyMonthlySales(): MonthlySales {
  return {...EMPTY, trend: [0, 0, 0]};
}

/**
 * Units sold per product over the trailing three Manila months. Counts item lines
 * (product_id set) of completed orders only; bundle picks ride as their own ₱0
 * component lines, so they're included by product. Pass `venueEventIds` to restrict
 * to sales tagged to a venue (a Set of event_ids); pass the special `UNATTRIBUTED`
 * set-of-null to count only sales with no event. Omit to count all sales.
 */
export function salesByProductMonth(
  orders: PosOrder[],
  now: Date = new Date(),
  venueEventIds?: Set<string> | 'unattributed' | null,
): Map<string, MonthlySales> {
  const cur = manilaMonthKey(now.toISOString());
  const out = new Map<string, MonthlySales>();

  for (const o of orders) {
    if (o.status === 'voided') continue;
    if (venueEventIds === 'unattributed') {
      if (o.event_id) continue;
    } else if (venueEventIds) {
      if (!o.event_id || !venueEventIds.has(o.event_id)) continue;
    }
    const ago = monthsBetween(cur, manilaMonthKey(o.created_at));
    if (ago < 0 || ago > 2) continue; // outside the 3-month window

    for (const line of o.items) {
      if (!line.product_id) continue; // skip bundle header lines
      const qty = Number(line.qty ?? 0);
      if (!(qty > 0)) continue;
      const rec = out.get(line.product_id) ?? emptyMonthlySales();
      if (ago === 0) rec.thisMonth += qty;
      else if (ago === 1) rec.lastMonth += qty;
      else rec.twoMonthsAgo += qty;
      rec.threeMonthTotal += qty;
      rec.trend = [rec.twoMonthsAgo, rec.lastMonth, rec.thisMonth];
      out.set(line.product_id, rec);
    }
  }
  return out;
}

// ── Default Category sort (matches the Line/Type filter pills) ────────────────
const UNCATEGORIZED_RANK = POS_CATEGORIES.length; // sorts after all known lines

/** Sort rank for a product line; unknown/null lands in the Uncategorized bucket (last). */
export function categoryRank(category: string | null): number {
  const i = POS_CATEGORIES.indexOf(category as (typeof POS_CATEGORIES)[number]);
  return i === -1 ? UNCATEGORIZED_RANK : i;
}

/** Sort rank for a subcategory; unknown/null sorts after the known subcategories. */
export function subcategoryRank(subcategory: string | null): number {
  const i = POS_SUBCATEGORIES.indexOf(subcategory as (typeof POS_SUBCATEGORIES)[number]);
  return i === -1 ? POS_SUBCATEGORIES.length : i;
}

/**
 * Default comparator: group by category order (Freeze Dried first), then by
 * subcategory order within a line, then by name. Uncategorized products sort last
 * (never dropped). Stable and total.
 */
export function compareByCategory(
  a: {category: string | null; subcategory: string | null; name: string},
  b: {category: string | null; subcategory: string | null; name: string},
): number {
  const c = categoryRank(a.category) - categoryRank(b.category);
  if (c !== 0) return c;
  const s = subcategoryRank(a.subcategory) - subcategoryRank(b.subcategory);
  if (s !== 0) return s;
  return a.name.localeCompare(b.name);
}
