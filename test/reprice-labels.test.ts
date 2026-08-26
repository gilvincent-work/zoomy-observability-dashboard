import {describe, expect, it} from 'vitest';
import {UNDERCUT_PCT,averagePct, badgeText, currentDiscountPct, discountPct, guardrailLabel, isDrifted, nextAction, pluraliseCount, priceDelta, readyToReprice, reasonFor, skipLabel, summarise} from '../src/reprice-labels';
import type {RepriceRow} from '../src/reprice-types';

function row(overrides: Partial<RepriceRow>): RepriceRow {
  return {
    id: 'r',
    runId: 'run',
    ranAt: '2026-08-18T00:00:00.000Z',
    dryRun: true,
    applied: false,
    marketplace: 'lazada',
    marketplaceSku: 'SKU',
    marketplaceTitle: 'Title',
    referencePrice: null,
    referenceSource: null,
    listedPrice: null,
    specialPrice: null,
    shopifyVariantId: null,
    shopifyTitle: null,
    matchScore: null,
    matchBand: null,
    targetPrice: null,
    floorPrice: null,
    oldPrice: null,
    newPrice: null,
    guardrail: null,
    skipReason: null,
    ...overrides,
  };
}

describe('guardrailLabel', () => {
  it('maps every guardrail value to plain English', () => {
    expect(guardrailLabel('no-floor')).toBe('Waiting for a floor price');
    expect(guardrailLabel('floor-clamp')).toBe('Held at your floor price');
    expect(guardrailLabel('max-change-clamp')).toBe('Limited to a 10% move this run');
    expect(guardrailLabel('no-op')).toBe('Already at the target price');
    expect(guardrailLabel(null)).toBe(`Priced ${UNDERCUT_PCT}% under the marketplace price`);
  });
});

describe('skipLabel', () => {
  it('maps every skip reason to plain English', () => {
    expect(skipLabel('listing-inactive')).toBe('Not currently selling on Lazada');
    expect(skipLabel('sku-inactive')).toBe('This variation is paused on Lazada');
    expect(skipLabel('no-reference-price')).toBe('No Lazada price to compare against');
    expect(skipLabel('unmatched')).toBe('No matching website product found');
    expect(skipLabel('needs-review')).toBe('Match needs a human check');
    expect(skipLabel('ambiguous')).toBe("Couldn't tell which product this is");
    expect(skipLabel(null)).toBeNull();
  });
});

describe('reasonFor', () => {
  it('prefers the skip reason over the guardrail when both are present', () => {
    const r = row({skipReason: 'needs-review', guardrail: 'no-floor'});
    expect(reasonFor(r)).toBe('Match needs a human check');
  });
  it('falls back to the guardrail when there is no skip reason', () => {
    const r = row({skipReason: null, guardrail: 'floor-clamp'});
    expect(reasonFor(r)).toBe('Held at your floor price');
  });
});

describe('nextAction', () => {
  it('suggests setting a floor price for no-floor rows', () => {
    expect(nextAction(row({guardrail: 'no-floor'}))).toBe('Set a floor price on this variant in Shopify');
  });
  it('suggests matching the SKU for ambiguous or needs-review rows', () => {
    expect(nextAction(row({skipReason: 'ambiguous'}))).toBe('Set the variant SKU in Shopify to match the Lazada seller SKU');
    expect(nextAction(row({skipReason: 'needs-review'}))).toBe('Set the variant SKU in Shopify to match the Lazada seller SKU');
  });
  it('returns null for an applied row with no special guardrail', () => {
    expect(nextAction(row({applied: true, guardrail: null, skipReason: null}))).toBeNull();
  });
});

describe('summarise', () => {
  it('counts changed vs would-change and groups skips descending by count', () => {
    const rows = [
      row({applied: true, newPrice: 135}),
      row({applied: false, newPrice: 319}),
      row({applied: false, newPrice: null, guardrail: 'no-floor'}),
      row({applied: false, newPrice: null, guardrail: 'no-floor'}),
      row({applied: false, newPrice: null, skipReason: 'unmatched'}),
    ];
    const summary = summarise(rows);
    expect(summary.changed).toBe(1);
    expect(summary.wouldChange).toBe(1);
    expect(summary.considered).toBe(5);
    expect(summary.skipped[0]).toMatchObject({reason: 'Waiting for a floor price', count: 2});
    expect(summary.skipped[1]).toMatchObject({reason: 'No matching website product found', count: 1});
  });
});

describe('discountPct', () => {
  it('computes 20% for a 169 -> 135 change', () => {
    expect(discountPct(row({referencePrice: 169, newPrice: 135}))).toBe(20);
  });
  it('returns null when the reference price is missing', () => {
    expect(discountPct(row({referencePrice: null, newPrice: 135}))).toBeNull();
  });
});

describe('currentDiscountPct', () => {
  it('uses the current Shopify price when available', () => {
    expect(currentDiscountPct({currentPrice: 143, referencePrice: 169, fallbackDiscountPct: 20})).toBe(15);
  });
  it('falls back to the stored discount when current price is missing', () => {
    expect(currentDiscountPct({currentPrice: null, referencePrice: 169, fallbackDiscountPct: 20})).toBe(20);
  });
  it('falls back when reference price is missing', () => {
    expect(currentDiscountPct({currentPrice: 143, referencePrice: null, fallbackDiscountPct: 20})).toBe(20);
  });
  it('falls back when reference price is zero', () => {
    expect(currentDiscountPct({currentPrice: 143, referencePrice: 0, fallbackDiscountPct: 20})).toBe(20);
  });
});

describe('isDrifted', () => {
  it('is true when current price differs from the recorded new price', () => {
    expect(isDrifted(143, 135)).toBe(true);
  });
  it('is false when they match', () => {
    expect(isDrifted(135, 135)).toBe(false);
  });
  it('is false when either side is missing', () => {
    expect(isDrifted(null, 135)).toBe(false);
    expect(isDrifted(143, null)).toBe(false);
  });
});

describe('pluraliseCount', () => {
  it('uses the singular for exactly 1', () => {
    expect(pluraliseCount(1, 'price')).toBe('1 price');
  });
  it('uses the plural for 0 and >1', () => {
    expect(pluraliseCount(0, 'price')).toBe('0 prices');
    expect(pluraliseCount(3, 'price')).toBe('3 prices');
  });
  it('accepts an irregular plural', () => {
    expect(pluraliseCount(2, 'child', 'children')).toBe('2 children');
  });
});

describe('badgeText', () => {
  it('describes a dry run as writing nothing, regardless of count', () => {
    expect(badgeText(true, 0)).toBe('PREVIEW ONLY — this run wrote nothing');
  });
  it('describes an applied run with the exact, correctly-pluralised count', () => {
    expect(badgeText(false, 1)).toBe('APPLIED — this run wrote 1 price');
    expect(badgeText(false, 3)).toBe('APPLIED — this run wrote 3 prices');
  });
});

describe('priceDelta', () => {
  it('computes a downward move', () => {
    expect(priceDelta(149, 135)).toEqual({amount: 14, pct: 9, direction: 'down'});
  });
  it('computes an upward move', () => {
    expect(priceDelta(135, 149)).toEqual({amount: 14, pct: 10, direction: 'up'});
  });
  it('treats equal values as same', () => {
    expect(priceDelta(149, 149)).toEqual({amount: 0, pct: 0, direction: 'same'});
  });
  it('returns null when either input is missing', () => {
    expect(priceDelta(null, 135)).toBeNull();
    expect(priceDelta(149, null)).toBeNull();
  });
});

describe('readyToReprice', () => {
  it('applies the 10% max-change cap to the target price', () => {
    const result = readyToReprice([row({guardrail: 'no-floor', oldPrice: 139, targetPrice: 119, referencePrice: 149})]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({firstRunPrice: 125, capped: true});
  });

  it('leaves an uncapped target unchanged', () => {
    const result = readyToReprice([row({guardrail: 'no-floor', oldPrice: 149, targetPrice: 135})]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({firstRunPrice: 135, capped: false});
  });

  it('excludes a row whose target already equals its current price', () => {
    const result = readyToReprice([row({guardrail: 'no-floor', oldPrice: 279, targetPrice: 279})]);
    expect(result).toHaveLength(0);
  });

  it('excludes rows with any other guardrail or a null target', () => {
    const result = readyToReprice([
      row({guardrail: 'floor-clamp', oldPrice: 100, targetPrice: 90}),
      row({guardrail: 'max-change-clamp', oldPrice: 100, targetPrice: 90}),
      row({guardrail: 'no-op', oldPrice: 100, targetPrice: 90}),
      row({guardrail: null, oldPrice: 100, targetPrice: 90}),
      row({guardrail: 'no-floor', oldPrice: 100, targetPrice: null}),
      row({guardrail: 'no-floor', oldPrice: null, targetPrice: 90}),
    ]);
    expect(result).toHaveLength(0);
  });

  it('sorts by the size of the price drop, largest first', () => {
    const result = readyToReprice([
      row({guardrail: 'no-floor', oldPrice: 139, targetPrice: 119, marketplaceSku: 'SMALL-DROP'}),
      row({guardrail: 'no-floor', oldPrice: 500, targetPrice: 420, marketplaceSku: 'BIG-DROP'}),
    ]);
    expect(result.map((r) => r.marketplaceSku)).toEqual(['BIG-DROP', 'SMALL-DROP']);
  });
});

describe('averagePct', () => {
  it('rounds the mean of the given percentages', () => {
    expect(averagePct([20, 21])).toBe(21);
  });
  it('returns null for an empty list', () => {
    expect(averagePct([])).toBeNull();
  });
});
