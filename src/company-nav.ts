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

/**
 * Whether a resolved context should be bounced OFF a Zoomy-only page (the legacy
 * Overview/Health/Inventory/… pages read Zoomy data with no company dimension, so a
 * non-Zoomy viewer would see Zoomy's data). Signed-out / no-membership (null ctx) is
 * left to the normal auth flow; Zoomy passes; everyone else — a Goldline user, or the
 * data-blind Coop Admin whose companyId is null — is redirected to their own home.
 */
export function shouldRedirectFromZoomy(ctx: {companyId: string | null} | null): boolean {
  return ctx !== null && ctx.companyId !== 'zoomy';
}
