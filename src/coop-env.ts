// Coop environments (pure, unit-tested). Just two: Staging and Production — the
// develop branch deploys to Staging too, so there is no separate Development/QA.
// The list lives in code (public URLs, nothing secret), so no deployment needs extra
// settings: each one recognises itself from its own host. Anything that isn't the
// production host — localhost, Vercel previews, the staging alias — is Staging (they
// all read the Staging database).

export type CoopEnvKey = 'staging' | 'production';

export type CoopEnv = {
  key: CoopEnvKey;
  label: string;
  url: string; // canonical origin
  host: string;
  tone: string; // colour rail / pill
  dbLabel: string; // which Supabase it reads (masked project ref)
};

export const COOP_ENVS: readonly CoopEnv[] = [
  {
    key: 'staging',
    label: 'Staging',
    url: 'https://coop-brand-os-staging.vercel.app',
    host: 'coop-brand-os-staging.vercel.app',
    tone: 'oklch(0.62 0.15 250)', // blue
    dbLabel: 'Staging Supabase (syxw…wdvw)',
  },
  {
    key: 'production',
    label: 'Production',
    url: 'https://coop-brand-os.vercel.app',
    host: 'coop-brand-os.vercel.app',
    tone: 'oklch(0.6 0.2 305)', // purple
    dbLabel: 'Coop production Supabase (qkxb…wipi)',
  },
] as const;

export const envByKey = (key: CoopEnvKey): CoopEnv => COOP_ENVS.find((e) => e.key === key) as CoopEnv;

/** Which environment a request is on, from its host (port and case ignored). */
export function envForHost(host: string | null | undefined): CoopEnv {
  const h = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  return h === envByKey('production').host ? envByKey('production') : envByKey('staging');
}

/** The same page on another environment: its origin + this path + query + hash. */
export function switchHref(target: CoopEnvKey, path: string, search = '', hash = ''): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const q = search && !search.startsWith('?') ? `?${search}` : search;
  const h = hash && !hash.startsWith('#') ? `#${hash}` : hash;
  return `${envByKey(target).url}${p}${q}${h}`;
}

/** The word a Coop Admin types to confirm a risky admin action in production. */
export const PROD_CONFIRM_WORD = 'PRODUCTION';

/** Risky admin actions in production must be confirmed by typing PROD_CONFIRM_WORD. */
export const prodConfirmOk = (env: CoopEnvKey, typed: string | null | undefined) => env !== 'production' || (typed ?? '').trim() === PROD_CONFIRM_WORD;
