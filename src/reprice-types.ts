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

// One row per distinct Shopify variant that the repricer has ever applied a
// price to — the MOST RECENT applied row for that variant. This describes
// what the repricer last SET, not what Shopify holds now: someone could have
// edited the price by hand afterwards. Newest-first.
// A row that is fully matched and priced by the job but blocked only by a
// missing floor price in Shopify — the actionable "what could be repriced
// next" set, as opposed to what has already been repriced.
export interface ReadyCandidate {
  shopifyTitle: string | null;
  marketplaceTitle: string;
  marketplaceSku: string;
  referencePrice: number | null;
  oldPrice: number;
  targetPrice: number;
  firstRunPrice: number;
  capped: boolean;
  savingPct: number;
}

export interface RepricedVariant {
  shopifyVariantId: string;
  shopifyTitle: string | null;
  marketplaceTitle: string;
  marketplaceSku: string;
  referencePrice: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  discountPct: number | null;
  ranAt: string;
  // The CURRENT Shopify price — old_price from the LATEST run's row for this
  // variant, i.e. what the store reads today, independent of whether the
  // repricer's own audit trail recorded a successful write. Null when the
  // latest run has no row for this variant.
  currentPrice: number | null;
  // True when currentPrice disagrees with the last price the repricer
  // recorded setting (newPrice): either an applied write's audit row never
  // landed, or someone changed the price in Shopify directly.
  drifted: boolean;
}

// One audit event in a variant's price-change timeline, newest-first, capped
// at 20 events per variant by the caller.
export interface RepriceHistoryEvent {
  ranAt: string;
  dryRun: boolean;
  applied: boolean;
  referencePrice: number | null;
  targetPrice: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  guardrail: RepriceRow['guardrail'];
  skipReason: RepriceRow['skipReason'];
  matchBand: RepriceRow['matchBand'];
}
