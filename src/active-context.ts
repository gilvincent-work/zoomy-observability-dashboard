import 'server-only';
import {auth} from '@/auth';
import {resolveActive, type ActiveContext, type Membership} from '@/src/company';

// Server-side seam for tenant scoping. A Server Component or route calls
// getActiveContext() to learn which company's data is in scope (and whether the
// caller may see data at all). The heavy lifting — and the data-blind Coop Admin
// rule — lives in the pure resolveActive() in src/company.ts, which is unit-tested;
// this file only bridges the next-auth session to it.

/**
 * Resolve the active tenant context for the current request, or null if the user
 * is not signed in / has no memberships. `requested` is the company slug the user
 * picked (e.g. from the switcher / `?company=`); ignored for a Coop Admin, who is
 * always cross-tenant and data-blind.
 */
export async function getActiveContext(requested?: string | null): Promise<ActiveContext | null> {
  const session = await auth();
  if (!session) return null;
  const memberships = (session as {memberships?: Membership[]}).memberships ?? [];
  return resolveActive(memberships, requested);
}

/**
 * Like getActiveContext but for data pages: returns a context that may read a
 * company's data, or null when the caller may not (not signed in, no membership,
 * or a data-blind Coop Admin). Callers treat null as "redirect / show no data".
 */
export async function getDataContext(requested?: string | null): Promise<ActiveContext | null> {
  const ctx = await getActiveContext(requested);
  if (!ctx || !ctx.canSeeData || !ctx.companyId) return null;
  return ctx;
}
