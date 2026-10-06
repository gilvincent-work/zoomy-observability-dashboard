// A Postgres client (the `postgres` driver, EXPLORE_DATABASE_URL) is a client too: assertLocalPostgres is an accepted guard call.
// Pure scanner behind test/local-only.test.ts: which integration-test sources can build a Supabase client without calling the
// shared local-only guard first? Comments are stripped so a comment cannot stand in for the call.
const CLIENT_BUILDERS = [/\bcreateClient\s*\(/, /@supabase\/supabase-js/, /\bchatReadClient\s*\(/, /\bchatDigestClient\s*\(/, /\bposClient\s*\(/, /\bSUPABASE_URL/, /from ['"]postgres['"]/, /\bEXPLORE_DATABASE_URL/];
const GUARD_CALL = /\bassertLocal(Supabase|Postgres)\s*\(/;

const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export function buildsClient(src: string): boolean {
  const code = stripComments(src);
  return CLIENT_BUILDERS.some((re) => re.test(code));
}

export function callsLocalGuard(src: string): boolean {
  return GUARD_CALL.test(stripComments(src));
}

/** True when the source builds (or can build) a Supabase client and never calls assertLocalSupabase. */
export function unguardedClient(src: string): boolean {
  return buildsClient(src) && !callsLocalGuard(src);
}
