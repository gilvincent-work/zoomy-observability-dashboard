// Multi-tenant foundation (P0): roles, memberships, and the app-level scoping
// that keeps each company's data walled off — including a DATA-BLIND Coop Admin.
//
// This module is import-safe from the edge (middleware/auth): it has no
// `server-only` guard and no Node-only imports, and the one network call uses
// the global `fetch` against PostgREST (same approach as auth.ts recordSignIn).
// The service-role env vars it reads are absent in the browser, so a client
// bundle could never actually fetch — but keep membership reads on the server.
//
// Why app-level scoping is the primary fence (not RLS): the dashboard reads
// Supabase with the service-role key, which BYPASSES row-level security. So
// isolation has to be enforced here, on every query, via the active company_id.
// RLS on company_users/companies is the backstop for the day someone forgets.

export type CompanyRole = 'coop_admin' | 'company_admin' | 'analyst' | 'store_manager';

/** One row from company_users. `companyId` is null only for coop_admin (cross-tenant). */
export type Membership = {
  companyId: string | null;
  role: CompanyRole;
  storeScope?: string[] | null;
};

/** The resolved tenant context for a request: which company is active and what it may do. */
export type ActiveContext = {
  /** The company whose data is in scope. null === cross-tenant operator view (no data). */
  companyId: string | null;
  role: CompanyRole;
  /** Coop Admin: provisions companies/people, sees NO business data. */
  isCoopAdmin: boolean;
  /** True only when a real company's data may be read (false for coop_admin). */
  canSeeData: boolean;
  /** store_manager is limited to these store codes; null/undefined = all stores. */
  storeScope?: string[] | null;
};

// --- pure helpers (unit-tested; no I/O) ------------------------------------

/** Coop Admin is data-blind by definition. Everyone else sees their own company. */
export function isCoopAdmin(role: CompanyRole): boolean {
  return role === 'coop_admin';
}

/** Can this role write data (upload + commit reviews, edit catalog/targets)? */
export function canEditData(role: CompanyRole): boolean {
  return role === 'company_admin' || role === 'store_manager';
}

/** Can this role manage its company's team (invite/suspend members)? */
export function canManageTeam(role: CompanyRole): boolean {
  return role === 'company_admin';
}

/**
 * Resolve the active tenant context from a user's memberships.
 *
 * - A coop_admin membership (companyId null) always resolves to the data-blind
 *   cross-tenant context, regardless of `requested` — the operator has no data view.
 * - Otherwise pick the requested company if the user is a member of it, else the
 *   first company membership (stable: callers should pass the user's chosen slug).
 * - Returns null when the user has no memberships (not allowed in).
 */
export function resolveActive(
  memberships: Membership[],
  requested?: string | null,
): ActiveContext | null {
  if (!memberships.length) return null;

  const coop = memberships.find((m) => m.role === 'coop_admin');
  if (coop) {
    return {companyId: null, role: 'coop_admin', isCoopAdmin: true, canSeeData: false};
  }

  const companyMemberships = memberships.filter((m) => m.companyId);
  if (!companyMemberships.length) return null;

  const chosen =
    (requested && companyMemberships.find((m) => m.companyId === requested)) ||
    companyMemberships[0];

  return {
    companyId: chosen.companyId,
    role: chosen.role,
    isCoopAdmin: false,
    canSeeData: true,
    storeScope: chosen.storeScope ?? null,
  };
}

/**
 * Store codes in `codes` that fall OUTSIDE a store_manager's scope. Empty array =
 * everything is allowed. A null/undefined `storeScope` (company_admin/analyst, or
 * an all-stores store_manager) means no restriction, so it always returns []. The
 * write path uses this to refuse an upload that reaches beyond the caller's stores
 * — the intra-tenant fence the type system advertises but DB `company_id` can't see.
 */
export function outOfScopeStores(storeScope: string[] | null | undefined, codes: string[]): string[] {
  if (!storeScope || storeScope.length === 0) return [];
  const allowed = new Set(storeScope);
  return [...new Set(codes.filter((c) => !allowed.has(c)))];
}

/** The companies a user may switch between (empty for a pure coop_admin).
 *  De-duplicated, so a stray duplicate membership row can't double an entry. */
export function switchableCompanies(memberships: Membership[]): string[] {
  const ids = memberships.filter((m) => m.companyId).map((m) => m.companyId as string);
  return [...new Set(ids)];
}

// --- membership read (server/edge; PostgREST + service role) ----------------

/** Company display names by id (edge-safe PostgREST; fail-soft []). Used by the
 *  switcher — a missing name falls back to the slug at the call site. */
export async function fetchCompanies(ids: string[]): Promise<{id: string; name: string}[]> {
  const url = process.env.SUPABASE_URL_ARCHIVE;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  if (!ids.length || !url || !key) return [];
  const inList = ids.map((i) => `"${i}"`).join(',');
  try {
    const res = await fetch(
      `${url}/rest/v1/companies?select=id,name&id=in.(${encodeURIComponent(inList)})`,
      {headers: {apikey: key, authorization: `Bearer ${key}`}},
    );
    if (!res.ok) return [];
    return (await res.json()) as {id: string; name: string}[];
  } catch {
    return [];
  }
}

/**
 * Fetch a user's memberships by email. Fail-soft: on any error returns [] so the
 * caller treats the user as unauthorized rather than crashing the auth flow.
 */
export async function fetchMemberships(email?: string | null): Promise<Membership[]> {
  const addr = email?.toLowerCase();
  const url = process.env.SUPABASE_URL_ARCHIVE;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
  if (!addr || !url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/company_users?select=company_id,role,store_scope&user_email=eq.${encodeURIComponent(addr)}`,
      {headers: {apikey: key, authorization: `Bearer ${key}`}},
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      company_id: string | null;
      role: CompanyRole;
      store_scope: string[] | null;
    }>;
    return rows.map((r) => ({companyId: r.company_id, role: r.role, storeScope: r.store_scope}));
  } catch {
    return [];
  }
}
