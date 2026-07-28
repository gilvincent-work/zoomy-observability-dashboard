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

export interface DigestDocument {
  window: { label: string; from: string; to: string };
  degraded: boolean;
  headline: string;
  themes: DigestTheme[];
  figures: DigestFigure[];
  recommendations: string[];
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
