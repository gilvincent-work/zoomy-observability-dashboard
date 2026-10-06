// Pure nav/guard helper — free of React and I/O so the critical "a non-Zoomy viewer
// never sees Zoomy data / chrome" invariant is unit-testable and can't silently
// drift. Shared by the server guard (requireZoomyData) and the client shell.

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

/** Where a non-Zoomy active view lands when bounced off a Zoomy-only route: the
 *  data-blind Coop Admin goes to the role console, a company view to its overview. */
export function homeFor(ctx: {isCoopAdmin: boolean} | null): string {
  return ctx?.isCoopAdmin ? '/admin/users' : '/overview';
}
