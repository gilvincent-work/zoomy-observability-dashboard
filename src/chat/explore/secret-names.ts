// The ONE secret-name rule for Ask Coop direct reads (spec 1.3; knowledge/best-practices/chat-direct-read-access.md section 3).
// Pure, no imports. The SQL copy lives in supabase/coop_chat_explore_direct.sql (schema coop_explore_admin); the test
// test/chat-explore-secret-names.test.ts fails when the two differ. A secret is a WHOLE word part (split on anything that is not
// a-z0-9), so shipping_fee and pinned stay readable while api_key and refresh_token do not. Glued names (apikey) escape it on
// purpose: the value scanner (scrub.ts) and the one-time column review cover them.
export const EXPLORE_SECRET_PARTS = ['password', 'token', 'secret', 'key', 'pin', 'hash', 'credential'] as const;
/** The tenant fence: Ask Coop is Zoomy-only (owner decision 2026-10-07). */
export const EXPLORE_TENANT_PREFIXES = ['gl_', 'company_'] as const;
export const EXPLORE_TENANT_TABLES = ['companies'] as const;
/** Reviewed `table.column` names that look secret but are not. Any addition is a reviewed diff (the test pins the list). */
export const EXPLORE_SECRET_COLUMN_EXCEPTIONS = ['pos_settings.key'] as const;

const FORMS: ReadonlySet<string> = new Set(EXPLORE_SECRET_PARTS.flatMap((p) => [p, `${p}s`, `${p}es`]));

export const nameParts = (name: string): string[] => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const isSecretName = (name: string): boolean => nameParts(name).some((w) => FORMS.has(w));

const isTenantTable = (name: string): boolean => {
  const n = name.toLowerCase();
  return (EXPLORE_TENANT_TABLES as readonly string[]).includes(n) || EXPLORE_TENANT_PREFIXES.some((p) => n.startsWith(p));
};

/** A table or view the login must never read: a secret name or another company's table. */
export const isClosedRelation = (name: string): boolean => isSecretName(name) || isTenantTable(name);

export const isSecretColumn = (table: string, column: string): boolean =>
  isSecretName(column) && !(EXPLORE_SECRET_COLUMN_EXCEPTIONS as readonly string[]).includes(`${table.toLowerCase()}.${column.toLowerCase()}`);
