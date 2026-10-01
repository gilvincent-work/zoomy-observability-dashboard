// Types for the zero-dependency pagination guard (scripts/check-pagination.mjs),
// so the vitest guard test can import it under `allowJs: false` (same pattern as
// import-spin-leads.d.mts).
export interface PaginationViolation {
  file: string;
  line: number;
  rule: 'A' | 'B';
  detail: string;
}

/** Scan src/ and scripts/ for unbounded Supabase reads. Empty array = clean. */
export function scan(root?: string): PaginationViolation[];
