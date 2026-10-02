// Types for the plain-JS local-only guard (see local-only.mjs).
export const LOCAL_HOSTS: string[];
export function isLocalSupabaseUrl(url: string | undefined | null): boolean;
export function assertLocalSupabase(url: string | undefined | null): void;
