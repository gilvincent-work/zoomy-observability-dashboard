// Mirror of the DigestDocument contract produced by zoomy-observability
// (src/observability/digest.js). Cross-repo, cross-language, so it's duplicated
// here by necessity — keep it in sync with that source of truth. The dashboard
// only READS these shapes.

export type TimeBasis = 'window' | 'recurring' | 'allTime';

export interface DigestTheme {
  theme: string;
  displayName: string;
  quote: string;          // verbatim shopper quote
  conversationId: string;
}

export interface DigestFigure {
  label: string;
  value: number;
  timeBasis: TimeBasis;   // explicit — all-time is never shown as "this week"
}

// Sales/customers figures use only window|allTime (no 'recurring'), but reuse
// DigestFigure — the wider TimeBasis is a harmless superset here.

export interface DigestSalesProduct {
  title: string;
  revenue: number;
}
export interface DigestSalesWatch {
  title: string;
  note: string;
}
export interface DigestSales {
  headline: string;
  figures: DigestFigure[];
  topProducts: DigestSalesProduct[];   // title ∈ salesSignals.windowed.topProducts
  rising?: DigestSalesWatch[];         // momentum: title ∈ risingProducts. Optional — archived rows predating the enrichment lack it.
  watch: DigestSalesWatch[];           // title ∈ salesSignals.windowed.decliningProducts
  recommendations: string[];
}

export type OutreachList = 'vip' | 'atRisk' | 'new';
export interface DigestOutreach {
  name: string;            // masked server-side before it reaches the browser (see src/pii.ts)
  list: OutreachList;
  canEmail: boolean;       // MARKETING consent — not general reachability
  note: string;
}
export interface DigestCustomers {
  headline: string;
  figures: DigestFigure[];
  outreach: DigestOutreach[];
  recommendations: string[];
}

// Shopee marketplace channel (separate from the website). Fed from manual
// Seller-Center exports. One sub-section PER FACET (sales/ads/traffic/products),
// each its own mini-synthesis — present only when that facet's file was ingested.
export interface DigestShopeeFacet {
  headline: string;
  figures: DigestFigure[];
  // Diagnosis: plain-language findings reading the numbers, shown before the
  // action recommendations. Absent on older archived rows.
  assessment?: string[];
  recommendations: string[];
  // Real export date range for THIS facet (ads is a 14-day window; sales/traffic/
  // products are 30-day). Stamped from the export by the batch job — see
  // reconcileShopeeWindows. Absent on older archived rows.
  window?: {from: string | null; to: string | null; label: string | null} | null;
}
export interface DigestShopee {
  sales?: DigestShopeeFacet | null;
  ads?: DigestShopeeFacet | null;
  traffic?: DigestShopeeFacet | null;
  products?: DigestShopeeFacet | null;
}

export interface DigestLazadaFacet {
  headline: string;
  figures: DigestFigure[];
  assessment?: string[];
  recommendations: string[];
  window?: {from: string | null; to: string | null; label: string | null} | null;
}
export interface DigestLazada {
  sales?: DigestLazadaFacet | null;
  finance?: DigestLazadaFacet | null;
  inventory?: DigestLazadaFacet | null;
}

export interface DigestDocument {
  window: { label: string; from: string; to: string };
  degraded: boolean;
  headline: string;
  themes: DigestTheme[];
  figures: DigestFigure[];
  recommendations: string[];
  // Optional sections — present only when the batch job passed the corresponding
  // block; null (or absent, for older archived rows) otherwise.
  sales?: DigestSales | null;
  customers?: DigestCustomers | null;
  shopee?: DigestShopee | null;
  lazada?: DigestLazada | null;
}

// One row of the digest_archive table (bundle omitted — the dashboard doesn't
// need the heavy source bundle).
export interface DigestArchiveRow {
  window_from: string;
  window_to: string;
  digest: DigestDocument;
  created_at: string;
  emailed_at?: string | null; // not in the archive schema yet (added when email idempotency lands)
  bundle?: unknown;           // never fetched by the dashboard (holds verbatim quotes)
}
