#!/usr/bin/env node
// Regression guard against PostgREST's db-max-rows (1000) SILENT truncation.
//
// Every Supabase response — top-level or embedded — is capped at db.max_rows
// (default 1000) with NO error. An unbounded list read on a table past that size
// just returns fewer rows; that is how getPosOrders once zeroed Units and
// mis-booked sales as "bundles" (see CHANGELOG 2026-09-27). The durable fix is to
// page every bulk read (fetchAllRows applies .range + a stable unique .order).
//
// This scanner FAILS the build (exit 1) when it finds either:
//   A) a literal row limit > 1000 — a bare .limit(NNNN) or limit=NNNN with
//      NNNN > 1000 does NOT raise the cap (PostgREST returns min(limit, max_rows)),
//      so it reads as "bounded" while still silently truncating; and
//   B) a supabase-js read — a .from(<quoted table>) with a .select(...) — whose
//      statement carries no bound marker (.range( | .limit( | .maybeSingle( |
//      .single( | count: | head:). A paginated read via fetchAllRows includes
//      .range( in its makePage chain, so it passes.
//
// Statements are parsed by collapsing newlines and splitting on ";", so a sibling
// bound marker anywhere in the same statement (e.g. a Promise.all whose other
// member is paginated) clears the whole statement — matching how the fixes read.
//
// A line carrying a trailing "// pagination-ok: <reason>" comment is suppressed,
// for reads that are genuinely bounded (a single-key .eq, a hand-rolled pager) or
// otherwise vetted. Keep the reason honest — it is the audit trail.
import {readdirSync, readFileSync} from 'node:fs';
import {join, extname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_DIRS = ['src', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

// Presence of any one of these in a statement means the read is bounded.
const BOUND_MARKERS = ['.range(', '.limit(', '.maybeSingle(', '.single(', 'count:', 'head:'];
// A supabase read: .from('table') ... .select(...). Table name must be quoted so
// we only match real table reads, not Array.from / string .from.
const FROM_RE = /\.from\(\s*['"`][^'"`]+['"`]\s*\)/;
// Literal row limits that do not bypass the cap.
const LIMIT_CALL = /\.limit\(\s*(\d+)\s*\)/g;
const LIMIT_EQ = /\blimit=(\d+)/gi;
// A vetted/bounded read, documented inline.
const OK = /\/\/\s*pagination-ok:\s*.+$/;
const MAX = 1000;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return out; // a missing scan dir (e.g. no scripts/) is not an error
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (EXTS.has(extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

// Replace comment bytes with spaces (newlines kept) so a limit or a read written
// in prose never trips a rule, while string contents are preserved verbatim and
// every offset still maps to its original line. A tiny string/comment state
// machine — enough for this codebase, no tokenizer dependency.
function maskComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { out += '  '; i += 2; state = 'line'; continue; }
      if (c === '/' && c2 === '*') { out += '  '; i += 2; state = 'block'; continue; }
      if (c === "'") { state = 'sq'; } else if (c === '"') { state = 'dq'; } else if (c === '`') { state = 'tpl'; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { out += '\n'; i += 1; state = 'code'; continue; }
      out += ' '; i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out += '  '; i += 2; state = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1; continue;
    }
    // string states — copy verbatim, respecting escapes and the matching quote
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code';
    out += c; i += 1;
  }
  return out;
}

function lineStartsOf(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetToLine(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1; // 1-based
}

/** Scan the repo and return the list of violations (empty = clean). */
export function scan(root = ROOT) {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(root, d), files);
  files.sort();

  const violations = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const masked = maskComments(content); // comments → spaces, length preserved
    const lines = content.split('\n'); // original lines, for // pagination-ok lookups
    const maskedLines = masked.split('\n');
    const starts = lineStartsOf(content);
    const rel = relative(root, file);
    const suppressed = (fromLine, toLine) => {
      for (let ln = fromLine; ln <= toLine; ln++) if (OK.test(lines[ln - 1] ?? '')) return true;
      return false;
    };

    // Rule A — literal row limit > 1000, line by line (comment-masked).
    for (let ln = 0; ln < maskedLines.length; ln++) {
      const line = maskedLines[ln];
      if (OK.test(lines[ln] ?? '')) continue;
      for (const re of [LIMIT_CALL, LIMIT_EQ]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (Number(m[1]) > MAX) {
            violations.push({
              file: rel,
              line: ln + 1,
              rule: 'A',
              detail: `row limit ${m[1]} > ${MAX} does not bypass PostgREST's cap — paginate instead`,
            });
          }
        }
      }
    }

    // Rule B — unbounded .from(<quoted>).select(...) statements. Collapse newlines
    // (length-preserving, so offsets still map to lines) and split on ";".
    const collapsed = masked.replace(/\n/g, ' ');
    let start = 0;
    const check = (s, e) => {
      const text = collapsed.slice(s, e);
      if (!text.includes('.select(')) return; // not a read (write / rpc / head count)
      const fm = FROM_RE.exec(text);
      FROM_RE.lastIndex = 0;
      if (!fm) return; // no real table read in this statement
      if (BOUND_MARKERS.some((mk) => text.includes(mk))) return; // bounded somewhere in the statement
      const startLine = offsetToLine(starts, s);
      const endLine = offsetToLine(starts, Math.max(s, e - 1));
      if (suppressed(startLine, endLine)) return;
      violations.push({
        file: rel,
        line: offsetToLine(starts, s + fm.index),
        rule: 'B',
        detail: `unbounded read ${fm[0]} — wrap in fetchAllRows (.range) or add a bound marker`,
      });
    };
    for (let i = 0; i < collapsed.length; i++) {
      if (collapsed[i] === ';') {
        check(start, i);
        start = i + 1;
      }
    }
    check(start, collapsed.length);
  }
  return violations;
}

function main() {
  const violations = scan();
  if (violations.length === 0) {
    console.log('check-pagination: OK — no unbounded Supabase reads.');
    return 0;
  }
  console.error(`check-pagination: ${violations.length} violation(s) (PostgREST silently caps reads at ${MAX} rows):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.detail}`);
  }
  console.error('\nFix: page the read with fetchAllRows (src/pos-fetch-paginate.ts), or');
  console.error('mark a genuinely-bounded read with a trailing "// pagination-ok: <reason>".');
  return 1;
}

// Run as a CLI; stay silent (export only) when imported by the vitest guard test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
