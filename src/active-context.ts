import 'server-only';
import {cookies} from 'next/headers';
import {auth} from '@/auth';
import {
  fetchCompanies,
  resolveActive,
  switchableCompanies,
  type ActiveContext,
  type CompanyRole,
  type Membership,
} from '@/src/company';

/** Cookie the switcher writes to pick the active company (a hint — always
 *  re-validated against real memberships by resolveActive). */
export const COMPANY_COOKIE = 'active_company';

async function cookieCompany(): Promise<string | null> {
  try {
    return (await cookies()).get(COMPANY_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

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
  // An explicit `requested` (a route/query hint) wins; otherwise fall back to the
  // switcher's cookie. resolveActive ignores a company the user isn't a member of.
  const pick = requested ?? (await cookieCompany());
  return resolveActive(memberships, pick);
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

/** Chrome for the app shell: the active company, the user's role, and the
 *  companies they can switch between (names resolved only when a switcher will
 *  actually show). Null when not signed in / no membership. */
export type NavContext = {
  companyId: string | null;
  role: CompanyRole;
  isCoopAdmin: boolean;
  companies: {id: string; name: string}[];
};

export async function getNavContext(): Promise<NavContext | null> {
  const session = await auth();
  if (!session) return null;
  const memberships = (session as {memberships?: Membership[]}).memberships ?? [];
  const active = resolveActive(memberships, await cookieCompany());
  if (!active) return null;
  const ids = switchableCompanies(memberships);
  // Always resolve names — the header pill shows the active company's name even
  // when there's only one (no switcher). Fail-soft falls back to the slug.
  const named = ids.length ? await fetchCompanies(ids) : [];
  const companies = ids.map((id) => named.find((c) => c.id === id) ?? {id, name: id});
  return {companyId: active.companyId, role: active.role, isCoopAdmin: active.isCoopAdmin, companies};
}
