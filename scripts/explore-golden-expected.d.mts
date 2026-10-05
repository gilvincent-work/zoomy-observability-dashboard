// Types for the plain-JS golden reference runner (see explore-golden-expected.mjs).
export function parseReferenceSql(text: string): {key: string; sql: string}[];
export function computeExpected(env?: Record<string, string | undefined>): Record<string, Record<string, unknown>[]>;
