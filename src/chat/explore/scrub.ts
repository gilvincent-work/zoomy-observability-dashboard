// The value scanner (spec 2.2, layer 4): the one layer that does not trust names. Before result rows reach the model or the stored
// result, secret-SHAPED values are replaced with [hidden]: JWTs, common API key formats, PEM blocks, password hashes, credential URLs,
// token query strings, long hex, long mixed letter-digit and base64 runs, and any JSON value under a secret-named key. Pure.
// JSON is judged STRUCTURALLY wherever it can be (Task 7 re-review R2, the default-deny lesson: no regex standing in for a parser):
// every complete JSON object, array or string literal inside a text value is found by a bracket scan that respects string literals and
// escapes, JSON.parse'd, and scrubbed by the key rule on the parsed value (the WHOLE value under a secret key is hidden, objects and
// arrays included; \u-escaped keys are decoded by the parse). A string literal that holds JSON (double-encoded) is decoded and scanned
// again, up to MAX_JSON_DEPTH. The "name": value text rules remain only as the fallback for JSON that is cut short or not parseable.
// The scan is bounded (MAX_SCAN_CHARS, MAX_STEPS, MAX_SPANS per cell) so a hostile value cannot make it slow; past a bound the text
// rules still run. Secret JSON keys use isSecretJsonKey (camelCase aware, Task 7 re-review R1).
// Runs are bounded by "not a letter or digit" (never \b: `_` is a word character, so `key_<hex>` would slip past, Task 7 review).
// False positives are accepted on purpose (a 32-hex device id), but the shapes are chosen so ordinary data is never hit: a uuid's
// hex groups are short, digit-only strings (order numbers, phones) need a letter, SKUs are upper-case, and dashes break a run.
// The scanner bounds ACCIDENTAL exposure only: SQL string functions can cut a value into pieces below every threshold
// (knowledge/best-practices/chat-direct-read-access.md section 7). The name rule and the column review are the real controls.
import {isSecretJsonKey} from './secret-names';

export const HIDDEN = '[hidden]';

const B = '(?<![A-Za-z0-9])'; // start of a run: not after a letter or digit
const E = '(?![A-Za-z0-9])'; // end of a run

/** Structural-scan bounds, per cell. */
const MAX_SCAN_CHARS = 100_000; // longer text skips the structural pass (the text rules still run)
const MAX_STEPS = 1_000_000; // characters the bracket matching and parsing may visit in total
const MAX_SPANS = 200; // JSON spans parsed
const MAX_JSON_DEPTH = 5; // JSON inside a JSON string inside ... (deeper: text rules only)

/** A JSON key in text: plain characters or \uXXXX escapes (decoded before judging, as JSON.parse would). */
const KEY = String.raw`((?:[A-Za-z0-9_.\- ]|\\u[0-9a-fA-F]{4}){1,64})`;
const decodeKey = (k: string): string => k.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Fallback pair rule. q is the quote ("" in a row literal); an object or array value that could not be parsed is hidden to the end. */
const pairReplace = (q: string) => (_m: string, name: string, sep: string, quoted?: string, objArr?: string, bare?: string): string | null => {
  if (!isSecretJsonKey(decodeKey(name))) return null;
  if (quoted !== undefined) return quoted === '' || quoted === HIDDEN ? null : `${q}${name}${q}${sep}${q}${HIDDEN}${q}`;
  if (objArr !== undefined) return `${q}${name}${q}${sep}${HIDDEN}`;
  return bare === undefined || bare === 'null' ? null : `${q}${name}${q}${sep}${HIDDEN}`;
};

type Rule = {re: RegExp; replace: (m: string, ...g: string[]) => string | null}; // null = keep the match as it is
const whole = (re: RegExp): Rule => ({re, replace: () => HIDDEN});

const RULES: readonly Rule[] = [
  // structure-keeping rules first: they hide the value and keep the name, so the row still reads
  {re: /([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s@/]+@/gi, replace: (_m, scheme) => `${scheme}${HIDDEN}@`}, // scheme://user:pass@
  {
    // fallback: a "name": value pair in JSON text that is cut short or not parseable (the quoted value is escape-aware)
    re: new RegExp(String.raw`(?<!")"${KEY}"(\s*:\s*)(?:"((?:\\.|[^"\\])*)"|([{[][\s\S]*)|(-?[^\s,}\])"]+))`, 'g'),
    replace: pairReplace('"'),
  },
  {
    // the same in a row literal, where every quote is doubled: ("{""token"": ""x""}")
    re: new RegExp(String.raw`""${KEY}""(\s*:\s*)(?:""(.*?)""(?=\s*(?:[,}\])]|$))|([{[][\s\S]*)|(-?[^\s,}\])"]+))`, 'g'),
    replace: pairReplace('""'),
  },
  {
    re: /(^|[?&;\s])([A-Za-z][A-Za-z0-9_.-]*)=([^&\s#"']+)/g, // ?access_token=..., token=..., &sign=..., apiKey=...
    replace: (_m, pre, name) => (isSecretJsonKey(name) ? `${pre}${name}=${HIDDEN}` : null),
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

type Scrubbed = {value: unknown; hidden: number};
type Budget = {steps: number};

/** End index of the complete JSON object, array or string literal that starts at i, or -1 (unbalanced, or out of budget). */
function spanEnd(s: string, i: number, b: Budget): number {
  const stack: string[] = [];
  let inStr = s[i] === '"';
  if (!inStr) stack.push(s[i]);
  for (let j = i + 1; j < s.length; j++) {
    if (--b.steps < 0) return -1;
    const c = s[j];
    if (inStr) {
      if (c === '\\') j += 1;
      else if (c === '"') {
        inStr = false;
        if (stack.length === 0) return j; // the span was the string literal itself
      }
    } else if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      if (stack.pop() !== (c === '}' ? '{' : '[')) return -1;
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

function scrubText(s: string, depth: number, b: Budget): Scrubbed {
  let out = s;
  let hidden = 0;
  if (depth <= MAX_JSON_DEPTH && s.length <= MAX_SCAN_CHARS) {
    const parts: string[] = [];
    let last = 0;
    let spans = 0;
    for (let i = 0; i < s.length && b.steps > 0 && spans < MAX_SPANS; i++) {
      const c = s[i];
      if (c !== '{' && c !== '[' && c !== '"') continue;
      const end = spanEnd(s, i, b);
      if (end < 0) continue; // cut short: an inner span may still be complete
      const raw = s.slice(i, end + 1);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // not JSON (a row literal, prose in brackets): inner spans and the text rules still see it
      }
      b.steps -= raw.length;
      spans += 1;
      let r: Scrubbed;
      if (typeof parsed === 'string') {
        if (!/[{[]/.test(parsed)) {
          i = end; // a plain string literal: nothing structural inside
          continue;
        }
        r = scrubText(parsed, depth + 1, b); // a string holding JSON (double-encoded): decode and scan again
        if (r.hidden === 0) continue; // the quote may have been misread (row text): keep scanning inside it
      } else {
        r = scrub(parsed, depth + 1, b);
        if (r.hidden === 0) {
          i = end;
          continue;
        }
      }
      parts.push(s.slice(last, i), JSON.stringify(r.value));
      hidden += r.hidden;
      last = end + 1;
      i = end;
    }
    if (parts.length > 0) out = parts.join('') + s.slice(last);
  }
  const p = scrubPlain(out); // shape rules everywhere, and the pair fallback for JSON the parse could not take
  return {value: p.value, hidden: hidden + p.hidden};
}

function scrub(v: unknown, depth: number, b: Budget): Scrubbed {
  if (typeof v === 'string') return scrubText(v, depth, b);
  if (Array.isArray(v)) {
    let hidden = 0;
    const value = v.map((x) => {
      const r = scrub(x, depth, b);
      hidden += r.hidden;
      return r.value;
    });
    return {value, hidden};
  }
  if (v !== null && typeof v === 'object') {
    let hidden = 0;
    const value: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (isSecretJsonKey(k) && x !== null && x !== undefined && x !== '') {
        value[k] = HIDDEN;
        hidden += 1;
      } else {
        const r = scrub(x, depth, b);
        value[k] = r.value;
        hidden += r.hidden;
      }
    }
    return {value, hidden};
  }
  return {value: v, hidden: 0};
}

/** Scrub one value (a cell): a fresh scan budget per call. */
export const scrubValue = (v: unknown): Scrubbed => scrub(v, 0, {steps: MAX_STEPS});

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
