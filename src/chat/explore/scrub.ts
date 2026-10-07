// The value scanner (spec 2.2, layer 4): the one layer that does not trust names. Before result rows reach the model or the stored
// result, secret-SHAPED values are replaced with [hidden]: JWTs, common API key formats, PEM blocks, password hashes, credential URLs,
// token query strings, long hex, long mixed letter-digit and base64 runs, and any JSON value under a secret-named key, whether the JSON
// arrives parsed (jsonb) or as TEXT (jsonb::text, ->> of an object, a row cast). Pure.
// Runs are bounded by "not a letter or digit" (never \b: `_` is a word character, so `key_<hex>` would slip past, Task 7 review).
// False positives are accepted on purpose (a 32-hex device id), but the shapes are chosen so ordinary data is never hit: a uuid's
// hex groups are short, digit-only strings (order numbers, phones) need a letter, SKUs are upper-case, and dashes break a run.
// The scanner bounds ACCIDENTAL exposure only: SQL string functions can cut a value into pieces below every threshold
// (knowledge/best-practices/chat-direct-read-access.md section 7). The name rule and the column review are the real controls.
import {isSecretName} from './secret-names';

export const HIDDEN = '[hidden]';

const B = '(?<![A-Za-z0-9])'; // start of a run: not after a letter or digit
const E = '(?![A-Za-z0-9])'; // end of a run
/** Query-string names that are secrets although no whole word part says so (glued or short forms). */
const GLUED_QS = /^(?:sig|sign|signature|passwd|pwd|apikey|accesstoken|authtoken)$/i;

type Rule = {re: RegExp; replace: (m: string, ...g: string[]) => string | null}; // null = keep the match as it is
const whole = (re: RegExp): Rule => ({re, replace: () => HIDDEN});

const RULES: readonly Rule[] = [
  // structure-keeping rules first: they hide the value and keep the name, so the row still reads
  {re: /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s@/]+@/gi, replace: (_m, scheme) => `${scheme}${HIDDEN}@`}, // scheme://user:pass@
  {
    // a "name": value pair under a secret-named key, in JSON text that could not be parsed whole (wrapped, cut, or a row cast with "")
    re: /(""?)([A-Za-z0-9_.\- ]{1,64})\1(\s*:\s*)(?:(""?)(.*?)\4(?=\s*(?:[,}\])]|$))|(-?[^\s,}\])"]+))/g,
    replace: (m, q, name, sep, vq, quoted, bare) => {
      if (!isSecretName(name)) return null;
      const v = vq !== undefined ? quoted : bare;
      if (v === '' || v === 'null' || v === undefined) return null; // nothing to hide (same as the parsed rule)
      return vq !== undefined ? `${q}${name}${q}${sep}${vq}${HIDDEN}${vq}` : `${q}${name}${q}${sep}${HIDDEN}`;
    },
  },
  {
    re: /(^|[?&;\s])([A-Za-z][A-Za-z0-9_.-]*)=([^&\s#"']+)/g, // ?access_token=..., token=..., &sign=...
    replace: (_m, pre, name) => (isSecretName(name) || GLUED_QS.test(name) ? `${pre}${name}=${HIDDEN}` : null),
  },
  whole(/\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{40,}/g), // bcrypt
  whole(/\$argon2(?:id|i|d)\$[^\s"']{10,}/g), // argon2
  whole(/\$[156]\$(?:rounds=\d+\$)?[^\s$]{1,16}\$[./A-Za-z0-9]{20,}/g), // crypt md5 / sha256 / sha512
  whole(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g), // JWT
  whole(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g), // any PEM block (a truncated one is hidden to the end)
  whole(new RegExp(`${B}(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}`, 'g')), // Stripe-style
  whole(new RegExp(`${B}sk-[A-Za-z0-9_-]{16,}`, 'g')), // OpenAI / Anthropic style
  whole(new RegExp(`${B}sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}`, 'g')), // Supabase
  whole(new RegExp(`${B}(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}`, 'g')), // GitHub
  whole(new RegExp(`${B}shp(?:at|ss|ca|pa)_[A-Za-z0-9]{16,}`, 'g')), // Shopify Admin / app tokens
  whole(new RegExp(`${B}re_(?=[A-Za-z0-9_]*\\d)[A-Za-z0-9_]{16,}`, 'g')), // Resend (a digit required: re_order_settings stays)
  whole(new RegExp(`${B}AIza[0-9A-Za-z_-]{30,}`, 'g')), // Google API key
  whole(new RegExp(`${B}GOCSPX-[A-Za-z0-9_-]{20,}`, 'g')), // Google OAuth client secret
  whole(new RegExp(`${B}glpat-[A-Za-z0-9_-]{20,}`, 'g')), // GitLab
  whole(new RegExp(`${B}xox[abeprs]-[A-Za-z0-9-]{10,}`, 'g')), // Slack
  whole(new RegExp(`${B}AKIA[0-9A-Z]{16}${E}`, 'g')), // AWS access key id
  whole(new RegExp(`${B}(?=[A-Za-z0-9+/]*\\d)(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9/]*\\+|[A-Za-z0-9+/]{40,}=)[A-Za-z0-9+/]{40,}={0,2}`, 'g')), // base64 with + or =
  whole(new RegExp(`${B}(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{32,}${E}`, 'g')), // raw hex tokens and hashes (a-f letter needed: digit strings stay)
  whole(new RegExp(`${B}(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]{32,}${E}`, 'g')), // 32+ with a digit and a lower-case letter (app secrets)
  whole(new RegExp(`${B}(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{40,}${E}`, 'g')), // long opaque tokens (Lazada style)
];

function scrubPlain(s: string): {value: string; hidden: number} {
  let hidden = 0;
  let out = s;
  for (const {re, replace} of RULES) {
    out = out.replace(re, (m: string, ...g: unknown[]) => {
      const r = replace(m, ...(g.slice(0, -2) as string[])); // drop offset and input
      if (r === null) return m;
      hidden += 1;
      return r;
    });
  }
  return {value: out, hidden};
}

function scrubText(s: string): {value: string; hidden: number} {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      parsed = undefined; // not JSON as a whole: the text rules below still see "name": value pairs
    }
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      const r = scrubValue(parsed);
      if (r.hidden > 0) return {value: JSON.stringify(r.value), hidden: r.hidden};
    }
  }
  return scrubPlain(s);
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
