// Pure nav-gating helpers for the dashboard shell. Kept out of the (client) shell
// component and free of React so the critical "Zoomy sees no change" invariant is
// unit-testable and can't silently drift.

/**
 * Whether a company gets the Uploads inbox tab. Zoomy (and the single-tenant /
 * unknown fallback, which resolves to 'zoomy') does NOT — it ingests via the POS
 * app, not file uploads. Every other company (Goldline) does.
 */
export function showUploadsFor(companyId: string | null | undefined): boolean {
  return (companyId ?? 'zoomy') !== 'zoomy';
}
