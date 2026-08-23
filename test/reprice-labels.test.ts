import {describe, expect, it} from 'vitest';
import {discountPct, guardrailLabel, nextAction, reasonFor, skipLabel, summarise} from '../src/reprice-labels';
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
    expect(guardrailLabel(null)).toBe('Priced 20% under Lazada');
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
