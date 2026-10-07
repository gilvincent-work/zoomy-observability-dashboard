// The value scanner (spec 2.2, layer 4): the one layer that does not trust names. Before result rows reach the model or the stored
// result, secret-SHAPED values are replaced with [hidden]: JWTs, common API key formats, PEM blocks, long hex and long mixed
// letter-digit runs, and any JSON value under a secret-named key. Pure.
// False positives are accepted on purpose (a 32-hex device id), but the shapes are chosen so ordinary data is never hit: a uuid's
// hex groups are short, digit-only strings (order numbers, phones) need a letter to match, and underscores or dashes break a run.
import {isSecretName} from './secret-names';

export const HIDDEN = '[hidden]';

const PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, // any PEM block (a truncated one is hidden to the end)
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe-style
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g, // Supabase
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{32,}\b/g, // raw hex tokens and hashes (at least one a-f letter: digit strings stay)
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{40,}\b/g, // long opaque tokens (Lazada style)
];

function scrubText(s: string): {value: string; hidden: number} {
  let hidden = 0;
  let out = s;
  for (const re of PATTERNS) {
    out = out.replace(re, () => {
      hidden += 1;
      return HIDDEN;
    });
  }
  return {value: out, hidden};
}

export function scrubValue(v: unknown): {value: unknown; hidden: number} {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) {
    let hidden = 0;
    const value = v.map((x) => {
      const r = scrubValue(x);
      hidden += r.hidden;
      return r.value;
    });
    return {value, hidden};
  }
  if (v !== null && typeof v === 'object') {
    let hidden = 0;
    const value: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isSecretName(k) && x !== null && x !== undefined && x !== '') {
        value[k] = HIDDEN;
        hidden += 1;
      } else {
        const r = scrubValue(x);
        value[k] = r.value;
        hidden += r.hidden;
      }
    }
    return {value, hidden};
  }
  return {value: v, hidden: 0};
}

export function scrubRows(rows: unknown[][]): {rows: unknown[][]; hidden: number} {
  let hidden = 0;
  const out = rows.map((r) =>
    r.map((cell) => {
      const s = scrubValue(cell);
      hidden += s.hidden;
      return s.value;
    }),
  );
  return {rows: out, hidden};
}
