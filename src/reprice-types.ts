// Mirror of the marketplace_price_changes audit table written by the
// repricing batch job (sibling repo). One row per pricing decision.
export interface RepriceRow {
  id: string;
  runId: string;
  ranAt: string;
  dryRun: boolean;
  applied: boolean;
  marketplace: string;
  marketplaceSku: string;
  marketplaceTitle: string;
  referencePrice: number | null;
  referenceSource: string | null;
  listedPrice: number | null;
  specialPrice: number | null;
  shopifyVariantId: string | null;
  shopifyTitle: string | null;
  matchScore: number | null;
  matchBand: 'exact' | 'auto' | 'review' | 'none' | 'ambiguous' | null;
  targetPrice: number | null;
  floorPrice: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  guardrail: 'no-floor' | 'floor-clamp' | 'max-change-clamp' | 'no-op' | null;
  skipReason: 'listing-inactive' | 'sku-inactive' | 'no-reference-price' | 'unmatched' | 'needs-review' | 'ambiguous' | null;
}

export interface RepriceRun {
  runId: string;
  ranAt: string;
  dryRun: boolean;
  rows: RepriceRow[];
}

// Summary of the most recent run that actually applied a price change —
// used to surface "the interesting run" when the latest run did nothing.
export interface LastChangeSummary {
  ranAt: string;
  count: number;
}
