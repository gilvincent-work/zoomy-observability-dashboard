export const CSP_DIRECTIVES: string[];
export const CSP_VALUE: string;
export const securityHeaders: {key: string; value: string}[];
export function headerRules(): {source: string; headers: {key: string; value: string}[]}[];
