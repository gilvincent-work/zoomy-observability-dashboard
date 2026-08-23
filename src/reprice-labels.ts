// Pure, presentation-free translation of the repricer's audit vocabulary into
// plain English. No React, no data-layer imports — safe to unit test in
// isolation and reuse anywhere the shape of a RepriceRow is known.
import type {RepriceRow} from './reprice-types';

export function guardrailLabel(g: RepriceRow['guardrail']): string {
  switch (g) {
    case 'no-floor':
      return 'Waiting for a floor price';
    case 'floor-clamp':
      return 'Held at your floor price';
    case 'max-change-clamp':
      return 'Limited to a 10% move this run';
    case 'no-op':
      return 'Already at the target price';
    case null:
      return 'Priced 20% under Lazada';
    default:
      return 'Priced 20% under Lazada';
  }
}

export function skipLabel(s: RepriceRow['skipReason']): string | null {
  switch (s) {
    case 'listing-inactive':
      return 'Not currently selling on Lazada';
    case 'sku-inactive':
      return 'This variation is paused on Lazada';
    case 'no-reference-price':
      return 'No Lazada price to compare against';
    case 'unmatched':
      return 'No matching website product found';
    case 'needs-review':
      return 'Match needs a human check';
    case 'ambiguous':
      return "Couldn't tell which product this is";
    case null:
      return null;
    default:
      return null;
  }
}

export function nextAction(row: RepriceRow): string | null {
  if (row.guardrail === 'no-floor') return 'Set a floor price on this variant in Shopify';
  if (row.skipReason === 'ambiguous' || row.skipReason === 'needs-review') {
    return 'Set the variant SKU in Shopify to match the Lazada seller SKU';
  }
  return null;
}

/** The single best human explanation for a row: what it was skipped for, else
 *  what guardrail shaped its price. */
export function reasonFor(row: RepriceRow): string {
  return skipLabel(row.skipReason) ?? guardrailLabel(row.guardrail);
}

export interface RepriceSkipGroup {
  reason: string;
  count: number;
  action: string | null;
}

export interface RepriceSummary {
  changed: number;
  wouldChange: number;
  considered: number;
  skipped: RepriceSkipGroup[];
}

export function summarise(rows: RepriceRow[]): RepriceSummary {
  let changed = 0;
  let wouldChange = 0;
  const skipGroups = new Map<string, {count: number; action: string | null}>();

  for (const row of rows) {
    if (row.applied) {
      changed++;
    } else if (row.newPrice != null) {
      wouldChange++;
    }
    if (row.newPrice == null) {
      const reason = reasonFor(row);
      const existing = skipGroups.get(reason);
      if (existing) existing.count++;
      else skipGroups.set(reason, {count: 1, action: nextAction(row)});
    }
  }

  const skipped: RepriceSkipGroup[] = Array.from(skipGroups.entries())
    .map(([reason, {count, action}]) => ({reason, count, action}))
    .sort((a, b) => b.count - a.count);

  return {changed, wouldChange, considered: rows.length, skipped};
}

/** % the new (or, absent that, target) price sits below the Lazada reference
 *  price. Null when either side of the comparison is missing. */
export function discountPct(row: RepriceRow): number | null {
  const price = row.newPrice ?? row.targetPrice;
  if (price == null || row.referencePrice == null || row.referencePrice === 0) return null;
  return Math.round((1 - price / row.referencePrice) * 100);
}

/** "1 price" / "3 prices" — pluralises a plain noun for a count. */
export function pluraliseCount(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The run badge's exact wording. Describes what THIS RUN did (wrote nothing
 *  vs. wrote N prices) — never a claim about the store's current state, which
 *  is what confused users when a later no-op dry run implied prices had never
 *  changed at all. */
export function badgeText(dryRun: boolean, appliedCount: number): string {
  return dryRun ? 'PREVIEW ONLY — this run wrote nothing' : `APPLIED — this run wrote ${pluraliseCount(appliedCount, 'price')}`;
}

/** The change from oldPrice to newPrice: amount and % moved, plus direction.
 *  Null when either input is missing — there's nothing to compare. */
export interface PriceDelta {
  amount: number;
  pct: number;
  direction: 'down' | 'up' | 'same';
}

export function priceDelta(oldPrice: number | null, newPrice: number | null): PriceDelta | null {
  if (oldPrice == null || newPrice == null) return null;
  const amount = Math.abs(Math.round(newPrice - oldPrice));
  const pct = oldPrice === 0 ? 0 : Math.round((Math.abs(newPrice - oldPrice) / oldPrice) * 100);
  const direction: PriceDelta['direction'] = newPrice === oldPrice ? 'same' : newPrice < oldPrice ? 'down' : 'up';
  return {amount, pct, direction};
}

/** Mean of a list of percentages, rounded to the nearest whole percent. Null
 *  when the list is empty (no repriced variants to average). */
export function averagePct(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
