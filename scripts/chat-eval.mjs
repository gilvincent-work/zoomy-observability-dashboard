#!/usr/bin/env node
// LOCAL ONLY. The 3-run-majority runner for the Ask Coop live golden eval (design section 8, Slice 6).
// It runs test/chat-live-golden.integration.test.ts N times (default 3), each run writing one JSON file, then votes per case
// (a case passes when a majority of runs pass it; the multi-turn chain must pass every run) and prints a pass/fail table by
// model and by skill step. Real model calls cost money (about $3 per run, an estimate): it is run by hand, never from CI.
//
//   set -a; source scripts/local-supabase/.local-env; set +a      # the throwaway local Supabase, never .env
//   export ANTHROPIC_API_KEY=...                                  # supplied by the person running it
//   CHAT_LIVE_EVAL=1 node scripts/chat-eval.mjs
//   CHAT_LIVE_EVAL=1 CHAT_LIVE_MODEL=opus-5-5 node scripts/chat-eval.mjs   # the Opus 5.5 comparison
//
// Env NAMES it reads (values are never printed): CHAT_LIVE_EVAL (must be 1), SUPABASE_URL_ARCHIVE (host must be 127.0.0.1 or
// localhost), SUPABASE_SERVICE_ROLE_KEY_ARCHIVE (unless CHAT_LIVE_DATA=synthetic), ANTHROPIC_API_KEY, CHAT_EVAL_RUNS (3),
// CHAT_LIVE_MODEL (sonnet-5-5 | opus-5-5 | a full model id), CHAT_LIVE_EFFORT, CHAT_LIVE_GRADER (0 turns the LLM grader off),
// CHAT_LIVE_DATA (local | synthetic), CHAT_EVAL_OUT (a directory for the run files).
//
// It exits with 2 and a message, before anything runs, unless the Supabase host is 127.0.0.1 or localhost.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {LOCAL_HOSTS, isLocalSupabaseUrl} from './local-only.mjs';

export {LOCAL_HOSTS};
/** Exit criteria, design 7b F11: mechanical cases 100%; grader-scored wording checks at least 90%. */
export const MECHANICAL_MIN = 1;
export const RUBRIC_MIN = 0.9;

/** Pure: may this environment run the live eval? Names the problems, never echoes a value. */
export function assertLocalRun(env) {
  const problems = [];
  if (env.CHAT_LIVE_EVAL !== '1') problems.push('CHAT_LIVE_EVAL is not 1 (real model calls cost money, so it is opt-in)');
  const raw = env.SUPABASE_URL_ARCHIVE;
  if (!raw) problems.push('SUPABASE_URL_ARCHIVE is not set (source scripts/local-supabase/.local-env first)');
  else if (!isLocalSupabaseUrl(raw)) problems.push('SUPABASE_URL_ARCHIVE is not a local host (only 127.0.0.1 or localhost is allowed: a hosted project, PROD above all, is never used for evals)');
  if (!env.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is not set');
  if (env.CHAT_LIVE_DATA !== 'synthetic' && !env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE) problems.push('SUPABASE_SERVICE_ROLE_KEY_ARCHIVE is not set (or use CHAT_LIVE_DATA=synthetic)');
  return {ok: problems.length === 0, problems};
}

const need = (n) => Math.floor(n / 2) + 1;
const pct = (a, b) => (b === 0 ? 1 : a / b);

/**
 * Vote across runs. `runs` are the JSON files the live test writes (see test/chat-live-golden.integration.test.ts).
 * A case passes mechanically when a majority of runs pass it; a rubric item passes when a majority of the runs that graded it
 * pass it; the chain must pass every run (exact spec, 3 of 3).
 */
export function majority(runs) {
  const n = runs.length;
  const keys = [...new Set(runs.flatMap((r) => r.cases.map((c) => `${c.kind}:${c.id}`)))];
  const cases = keys.map((key) => {
    const seen = runs.map((r) => r.cases.find((c) => `${c.kind}:${c.id}` === key)).filter(Boolean);
    const first = seen[0];
    const mechPasses = seen.filter((c) => c.mech).length;
    const graded = seen.filter((c) => Array.isArray(c.rubric) && c.rubric.length > 0);
    const items = graded.length ? graded[0].rubric.length : 0;
    const rubric = Array.from({length: items}, (_, i) => graded.filter((c) => c.rubric[i] === true).length >= need(graded.length));
    return {key, id: first.id, kind: first.kind, category: first.category, steps: first.steps, mechPasses, of: seen.length, mech: mechPasses >= need(n), rubric, graded: graded.length, failures: [...new Set(seen.flatMap((c) => c.failures))]};
  });
  const chainRuns = runs.filter((r) => r.chain).map((r) => r.chain);
  const chain = chainRuns.length ? {passes: chainRuns.filter((c) => c.mech).length, of: chainRuns.length, pass: chainRuns.every((c) => c.mech), failures: [...new Set(chainRuns.flatMap((c) => c.failures))]} : null;
  const guard = {attemptedNonRead: 0, trips: 0, unknownTools: 0, errors: 0};
  let numberViolations = 0;
  for (const r of runs) {
    numberViolations += r.numberViolations ?? 0;
    guard.attemptedNonRead += r.guard?.attemptedNonRead ?? 0;
    guard.trips += r.guard?.trips ?? 0;
    guard.unknownTools += r.guard?.unknownTools ?? 0;
    guard.errors += r.errors ?? 0;
  }
  const rubricItems = cases.flatMap((c) => c.rubric);
  const mech = {passed: cases.filter((c) => c.mech).length + (chain?.pass ? 1 : 0), total: cases.length + (chain ? 1 : 0)};
  const rubric = {passed: rubricItems.filter(Boolean).length, total: rubricItems.length};
  const steps = {};
  for (const c of cases) {
    for (const s of c.steps) {
      const e = (steps[s] ??= {cases: 0, mech: 0, rubricPassed: 0, rubricTotal: 0});
      e.cases += 1;
      e.mech += c.mech ? 1 : 0;
      e.rubricPassed += c.rubric.filter(Boolean).length;
      e.rubricTotal += c.rubric.length;
    }
  }
  const ok = mech.passed === mech.total && pct(rubric.passed, rubric.total) >= RUBRIC_MIN && guard.attemptedNonRead === 0 && guard.trips === 0 && guard.unknownTools === 0 && guard.errors === 0;
  return {model: runs[0]?.model ?? '?', effort: runs[0]?.effort ?? '?', runs: n, totalCost: runs.reduce((s, r) => s + (r.totalCost ?? 0), 0), cases, chain, guard, numberViolations, mech, rubric, steps, ok};
}

const mark = (b) => (b ? 'pass' : 'FAIL');

/** The pass/fail table by model and by skill step, as lines of text. */
export function renderTable(s) {
  const out = [];
  out.push(`Model ${s.model} (effort ${s.effort}), ${s.runs} run(s), majority vote, about $${s.totalCost.toFixed(2)} in total`);
  out.push('');
  out.push(`${'case'.padEnd(34)}${'kind'.padEnd(8)}${'mechanical'.padEnd(16)}wording`);
  for (const c of s.cases) {
    const w = c.rubric.length ? `${c.rubric.filter(Boolean).length}/${c.rubric.length}` : '-';
    out.push(`${c.id.padEnd(34)}${c.kind.padEnd(8)}${`${mark(c.mech)} (${c.mechPasses}/${c.of})`.padEnd(16)}${w}${c.mech ? '' : `   ${c.failures.slice(0, 2).join('; ')}`}`);
  }
  if (s.chain) out.push(`${'multi-turn chain (exact spec)'.padEnd(34)}${''.padEnd(8)}${`${mark(s.chain.pass)} (${s.chain.passes}/${s.chain.of})`.padEnd(16)}-${s.chain.pass ? '' : `   ${s.chain.failures.slice(0, 2).join('; ')}`}`);
  out.push('');
  out.push(`${'skill step'.padEnd(14)}${'cases'.padEnd(8)}${'mechanical'.padEnd(12)}wording`);
  for (const [step, e] of Object.entries(s.steps).sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`${step.padEnd(14)}${String(e.cases).padEnd(8)}${`${e.mech}/${e.cases}`.padEnd(12)}${e.rubricTotal ? `${e.rubricPassed}/${e.rubricTotal}` : '-'}`);
  }
  out.push('');
  out.push(`mechanical ${s.mech.passed}/${s.mech.total} (need ${s.mech.total}), wording ${s.rubric.passed}/${s.rubric.total} = ${(pct(s.rubric.passed, s.rubric.total) * 100).toFixed(0)}% (need ${RUBRIC_MIN * 100}%)`);
  out.push(`guard: attempted non-read ${s.guard.attemptedNonRead}, trips ${s.guard.trips}, non-allowlisted tool names ${s.guard.unknownTools}, errors ${s.guard.errors} (all must be 0)`);
  out.push(`number-check violations (log-only, a person reads them): ${s.numberViolations} figure(s) over ${s.runs} run(s)`);
  out.push(s.ok ? 'RESULT: pass' : 'RESULT: FAIL');
  return out;
}

function main() {
  const env = process.env;
  const check = assertLocalRun(env);
  if (!check.ok) {
    console.error('chat-eval: refusing to run:');
    for (const p of check.problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const n = Math.max(1, Number(env.CHAT_EVAL_RUNS ?? 3) || 3);
  const dir = env.CHAT_EVAL_OUT ? path.resolve(env.CHAT_EVAL_OUT) : mkdtempSync(path.join(os.tmpdir(), 'coop-eval-'));
  mkdirSync(dir, {recursive: true});
  console.log(`chat-eval: ${n} run(s); run files in ${dir}`);
  const runs = [];
  for (let i = 1; i <= n; i++) {
    const file = path.join(dir, `run-${i}.json`);
    const res = spawnSync('npx', ['vitest', 'run', 'test/chat-live-golden.integration.test.ts'], {cwd: root, stdio: 'inherit', env: {...env, CHAT_LIVE_OUT: file, CHAT_LIVE_RUN: String(i)}});
    if (!existsSync(file)) {
      console.error(`chat-eval: run ${i} wrote no result file (vitest exit ${res.status}); it cannot be counted`);
      continue;
    }
    runs.push(JSON.parse(readFileSync(file, 'utf8')));
  }
  if (runs.length === 0) {
    console.error('chat-eval: no run produced a result');
    process.exit(1);
  }
  const summary = majority(runs);
  console.log(`\n${renderTable(summary).join('\n')}`);
  process.exit(summary.ok && runs.length === n ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
