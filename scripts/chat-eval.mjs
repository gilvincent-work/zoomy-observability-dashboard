#!/usr/bin/env node
// LOCAL ONLY. The runner for the Ask Coop live golden eval (design section 8, Slice 6): CHEAP AND SAFE BY DEFAULT.
// It runs test/chat-live-golden.integration.test.ts (one vitest process per run, one JSON file per run), votes per case and prints
// a result table, a per-case spend table (PASS / FAIL / UNGRADED, runs used, tokens, dollars), the total spent against the cap and
// the cache hit ratio. Real model calls cost money, so it is run by hand, never from CI.
//
// HOW TO RUN (one tier per run; the default tier is smoke)
//   set -a; source scripts/local-supabase/.local-env; set +a      # the throwaway local Supabase, never .env
//   export ANTHROPIC_API_KEY=...                                  # supplied by the person running it
//   CHAT_LIVE_EVAL=1 node scripts/chat-eval.mjs                   # SMOKE: 9 golden cases, ONE run each, about $0.4 to $1 (planned worst case $0.72)
//   CHAT_LIVE_EVAL=1 CHAT_EVAL_TIER=full CHAT_EVAL_BUDGET_USD=5 node scripts/chat-eval.mjs
//                                                                 # FULL: 53 model loops (29 golden + 7 probes + 12 skill + 5 chain turns), ONE run each, about $1.5 to $2.5
//   CHAT_LIVE_EVAL=1 CHAT_EVAL_TIER=majority CHAT_EVAL_BUDGET_USD=6 CHAT_EVAL_FORCE=1 node scripts/chat-eval.mjs
//                                                                 # MAJORITY: run 1 is FULL; only the cases that FAILED in run 1 are re-run (twice more,
//                                                                 # CHAT_EVAL_RUNS=3 in total), so a passing case costs ONE run. About full plus 10 to 30%.
//   CHAT_LIVE_EVAL=1 CHAT_LIVE_MODEL=opus-5-5 CHAT_EVAL_BUDGET_USD=8 node scripts/chat-eval.mjs   # the Opus 5.5 comparison (about 1.8x the Sonnet cost)
// Cases run back to back in one process (no sleeping, no parallel fan-out) so the 5-minute prompt cache stays warm.
//
// COST CONTROLS
//   1. Before anything starts it prints the planned WORST case: cases x runs x $0.08 (an average per model loop). It EXITS 2 when that
//      exceeds the cap, unless CHAT_EVAL_FORCE=1. A cap of 0 or below means "refuse to run".
//   2. While it runs, every Anthropic call (chat steps AND grader calls) is recorded against the cap (test/support/eval-budget.ts) and the
//      next call is refused once the cap is reached. The runner hands each run only what is left of the cap, and launches no run when
//      nothing is left. CHAT_EVAL_BUDGET_USD defaults to 3. A missing or invalid value falls back to 3.
//   3. The wording grader runs with thinking turned down, a 2,500-token reply budget and an optional cheaper model (CHAT_GRADER_MODEL; the
//      default is the chat model; claude-haiku-4-5-20251001 is the cheap choice but must accept the request shape, which the docs say it
//      does: no effort field, thinking disabled). A truncated or unreadable grader reply is UNGRADED, reported separately, never a FAIL.
//      A case whose mechanical checks already failed is not sent to the grader at all.
//   4. RECOMMENDED: create a separate Anthropic workspace and API key just for evals, with its own monthly spend limit in the Console
//      (Workspaces, then Limits), so a runaway eval can never drain the production account. Its prompt cache is isolated from the
//      product's, so the first call of a run pays one cold cache write (about $0.03).
//
// Env NAMES it reads (values are never printed): CHAT_LIVE_EVAL (must be 1), SUPABASE_URL_ARCHIVE (host must be 127.0.0.1 or
// localhost), SUPABASE_SERVICE_ROLE_KEY_ARCHIVE (unless CHAT_LIVE_DATA=synthetic), ANTHROPIC_API_KEY, CHAT_EVAL_TIER (smoke | full |
// majority), CHAT_EVAL_BUDGET_USD (3), CHAT_EVAL_FORCE (1 skips the worst-case refusal, never the hard cap), CHAT_EVAL_RUNS (3, majority
// tier only), CHAT_LIVE_CASES (comma list of case ids, overrides the tier), CHAT_LIVE_MODEL (sonnet-5-5 | opus-5-5 | a full model id),
// CHAT_GRADER_MODEL, CHAT_LIVE_EFFORT, CHAT_LIVE_GRADER (0 turns the LLM grader off), CHAT_LIVE_DATA (local | synthetic), CHAT_EVAL_OUT
// (a directory for the run files).
//
// It exits with 2 and a message, before anything runs, unless the Supabase host is 127.0.0.1 or localhost (or the plan is refused).
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

// ---- the plan: tiers, the cap and the worst-case estimate (pure; test/eval-budget.test.ts and test/eval-runner-plan.test.ts) ----------------

export const TIERS = ['smoke', 'full', 'majority'];
export const DEFAULT_TIER = 'smoke';
/** The default hard cap in US dollars for one eval campaign (every run of the runner, graders included). */
export const DEFAULT_BUDGET_USD = 3;
/** The average cost of one model loop (one question, several steps), used only for the BEFORE-start worst case. Measured turns: $0.01 to $0.13. */
export const AVG_TURN_USD = 0.08;
/** Model loops per tier: smoke = the smoke-flagged golden cases; full = 29 golden + 7 probes + 12 skill + 5 live chain turns. Pinned to the data by a test. */
export const PLANNED = {smoke: 9, full: 53};
const CHAIN_LOOPS = 5;

/** Pure: the cap from a raw env value. Missing, blank or not a finite number falls back to the default; 0 or negative is kept (it means refuse to run). */
export function parseCapUsd(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : DEFAULT_BUDGET_USD;
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_BUDGET_USD;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : DEFAULT_BUDGET_USD;
}

/** Pure: the tier from a raw env value. Missing or blank is the default (smoke) and valid; an unknown name falls back to smoke and is flagged invalid. */
export function parseTier(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return {tier: DEFAULT_TIER, valid: true};
  const t = raw.trim().toLowerCase();
  return TIERS.includes(t) ? {tier: t, valid: true} : {tier: DEFAULT_TIER, valid: false};
}

/** Pure: runs planned in the worst case. Only the majority tier repeats (CHAT_EVAL_RUNS, default 3, at least 2). */
export function plannedRuns(tier, env = {}) {
  if (tier !== 'majority') return 1;
  return Math.max(2, Math.floor(Number(env.CHAT_EVAL_RUNS ?? 3)) || 3);
}

/** Pure: how many model loops a CHAT_LIVE_CASES list selects (the chain is five live turns). */
const listedLoops = (list) => list.reduce((n, id) => n + (id === 'chain' ? CHAIN_LOOPS : 1), 0);

/**
 * Pure: the plan for this environment, and whether it may start. The worst case is loops x runs x AVG_TURN_USD. It must not exceed the
 * cap unless CHAT_EVAL_FORCE=1 (the hard cap still stops the run). A cap of 0 or below refuses. Never echoes a secret.
 */
export function planCheck(env) {
  const problems = [];
  const {tier, valid} = parseTier(env.CHAT_EVAL_TIER);
  if (!valid) problems.push(`CHAT_EVAL_TIER must be one of ${TIERS.join(', ')}`);
  const capUsd = parseCapUsd(env.CHAT_EVAL_BUDGET_USD);
  if (capUsd <= 0) problems.push('CHAT_EVAL_BUDGET_USD is 0 or negative, which means refuse to run');
  const listed = (env.CHAT_LIVE_CASES ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const loops = listed.length > 0 ? listedLoops(listed) : tier === 'smoke' ? PLANNED.smoke : PLANNED.full;
  const runs = plannedRuns(tier, env);
  const worstCaseUsd = loops * runs * AVG_TURN_USD;
  const force = env.CHAT_EVAL_FORCE === '1';
  if (capUsd > 0 && worstCaseUsd > capUsd + 1e-9 && !force) {
    problems.push(`the planned worst case ($${worstCaseUsd.toFixed(2)}) exceeds the cap ($${capUsd.toFixed(2)}): raise CHAT_EVAL_BUDGET_USD, pick a smaller tier, or set CHAT_EVAL_FORCE=1 (the hard cap still stops the run)`);
  }
  return {ok: problems.length === 0, problems, tier, runs, loops, worstCaseUsd, capUsd, force};
}

/** Per run, per case: FAIL (a mechanical check or a wording item failed), UNGRADED (mechanically fine, the grader reply was truncated or unreadable), else PASS. */
export function caseOutcome(c) {
  if (!c.mech || (Array.isArray(c.rubric) && c.rubric.includes(false))) return 'FAIL';
  return c.ungraded ? 'UNGRADED' : 'PASS';
}

/** Pure: the CHAT_LIVE_CASES ids to re-run for the majority tier: the cases that FAILED in this run (an ungraded case is not a failure). */
export function failedSelectors(run) {
  const ids = run.cases.filter((c) => caseOutcome(c) === 'FAIL').map((c) => (c.kind === 'probe' ? `probe:${c.id.replace(/^probe:\s*/, '')}` : c.id));
  if (run.chain && !run.chain.mech) ids.push('chain');
  return ids;
}

const need = (n) => Math.floor(n / 2) + 1;
const pct = (a, b) => (b === 0 ? 1 : a / b);

const sumUsage = (list) => list.reduce((t, u) => ({input: t.input + (u?.input ?? 0), output: t.output + (u?.output ?? 0), cacheRead: t.cacheRead + (u?.cacheRead ?? 0), cacheWrite: t.cacheWrite + (u?.cacheWrite ?? 0)}), {input: 0, output: 0, cacheRead: 0, cacheWrite: 0});

/** Pure: cacheRead / (cacheRead + cacheWrite + input), or null when nothing was read or sent. */
export function cacheHitRatio(u) {
  const d = u.cacheRead + u.cacheWrite + u.input;
  return d === 0 ? null : u.cacheRead / d;
}

/**
 * Vote across runs. `runs` are the JSON files the live test writes (see test/chat-live-golden.integration.test.ts).
 * A case passes mechanically when a majority of the runs THAT RAN IT pass it (the majority tier re-runs only failed cases, so a case may have
 * one run); a rubric item passes when a majority of the runs that graded it pass it; the chain must pass every run (exact spec).
 * `opts.capUsd` is the cap the campaign ran under, for the spend line.
 */
export function majority(runs, opts = {}) {
  const n = runs.length;
  const keys = [...new Set(runs.flatMap((r) => r.cases.map((c) => `${c.kind}:${c.id}`)))];
  const cases = keys.map((key) => {
    const seen = runs.map((r) => r.cases.find((c) => `${c.kind}:${c.id}` === key)).filter(Boolean);
    const first = seen[0];
    const mechPasses = seen.filter((c) => c.mech).length;
    const graded = seen.filter((c) => Array.isArray(c.rubric) && c.rubric.length > 0);
    const items = graded.length ? graded[0].rubric.length : 0;
    const rubric = Array.from({length: items}, (_, i) => graded.filter((c) => c.rubric[i] === true).length >= need(graded.length));
    const mech = mechPasses >= need(seen.length);
    const ungradedRuns = seen.filter((c) => c.ungraded === true).length;
    const outcome = !mech || rubric.includes(false) ? 'FAIL' : graded.length === 0 && ungradedRuns > 0 ? 'UNGRADED' : 'PASS';
    return {
      key, id: first.id, kind: first.kind, category: first.category, steps: first.steps, mechPasses, of: seen.length, mech, rubric, graded: graded.length,
      failures: [...new Set(seen.flatMap((c) => c.failures))], outcome, ungradedRuns, usage: sumUsage(seen.map((c) => c.usage)), cost: seen.reduce((t, c) => t + (c.cost ?? 0), 0),
    };
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
  const budgetExceeded = runs.some((r) => r.budget?.exceeded === true || r.budgetExceeded === true);
  const usage = sumUsage(runs.map((r) => r.usage));
  const ok = mech.passed === mech.total && pct(rubric.passed, rubric.total) >= RUBRIC_MIN && guard.attemptedNonRead === 0 && guard.trips === 0 && guard.unknownTools === 0 && guard.errors === 0 && !budgetExceeded;
  return {
    model: runs[0]?.model ?? '?', effort: runs[0]?.effort ?? '?', runs: n, totalCost: runs.reduce((s, r) => s + (r.totalCost ?? 0), 0), capUsd: opts.capUsd ?? null,
    tier: opts.tier ?? runs[0]?.tier ?? null, usage, cacheHitRatio: cacheHitRatio(usage), ungraded: cases.filter((c) => c.outcome === 'UNGRADED').length, budgetExceeded,
    cases, chain, guard, numberViolations, mech, rubric, steps, ok,
  };
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
  out.push(...spendLines(s));
  out.push('');
  out.push(`mechanical ${s.mech.passed}/${s.mech.total} (need ${s.mech.total}), wording ${s.rubric.passed}/${s.rubric.total} = ${(pct(s.rubric.passed, s.rubric.total) * 100).toFixed(0)}% (need ${RUBRIC_MIN * 100}%)`);
  out.push(`guard: attempted non-read ${s.guard.attemptedNonRead}, trips ${s.guard.trips}, non-allowlisted tool names ${s.guard.unknownTools}, errors ${s.guard.errors} (all must be 0)`);
  out.push(`number-check violations (log-only, a person reads them): ${s.numberViolations} figure(s) over ${s.runs} run(s)`);
  if (s.budgetExceeded) out.push('BUDGET: the cap was reached and the run stopped early; the cases above are only the ones that finished');
  out.push(s.ok ? 'RESULT: pass' : 'RESULT: FAIL');
  return out;
}

const usd = (n) => `$${n.toFixed(n >= 0.01 || n === 0 ? 2 : 4)}`;
const tokens = (u) => `${u.input}/${u.output}/${u.cacheRead}/${u.cacheWrite}`;

/** The spend table: per case PASS / FAIL / UNGRADED, runs used, tokens (input/output/cacheRead/cacheWrite) and dollars, then the total against the cap and the cache hit ratio. */
export function spendLines(s) {
  const out = [];
  out.push(`${'spend by case'.padEnd(34)}${'result'.padEnd(11)}${'runs'.padEnd(6)}${'tokens in/out/cacheR/cacheW'.padEnd(30)}dollars`);
  for (const c of s.cases) out.push(`${c.id.padEnd(34)}${c.outcome.padEnd(11)}${String(c.of).padEnd(6)}${tokens(c.usage).padEnd(30)}${usd(c.cost)}`);
  const cap = s.capUsd;
  out.push(`spent ${usd(s.totalCost)}${cap === null ? '' : ` of the ${usd(cap)} cap (${cap > 0 ? ((s.totalCost / cap) * 100).toFixed(0) : '0'}%)`}${s.tier ? `, tier ${s.tier}` : ''}`);
  out.push(`cache hit ratio: ${s.cacheHitRatio === null ? 'n/a' : `${(s.cacheHitRatio * 100).toFixed(1)}%`} (cacheRead / (cacheRead + cacheWrite + input))`);
  if (s.ungraded > 0) out.push(`UNGRADED: ${s.ungraded} case(s) whose grader reply was truncated or unreadable; they count as neither pass nor fail in the result; re-grade or re-run them`);
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
  const plan = planCheck(env);
  console.log(`chat-eval: tier ${plan.tier}, up to ${plan.runs} run(s), ${plan.loops} model loop(s) per run; planned WORST case $${plan.worstCaseUsd.toFixed(2)} (loops x runs x $${AVG_TURN_USD} each) against a cap of $${plan.capUsd.toFixed(2)}`);
  if (!plan.ok) {
    console.error('chat-eval: refusing to start:');
    for (const p of plan.problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  if (plan.force && plan.worstCaseUsd > plan.capUsd) console.log('chat-eval: CHAT_EVAL_FORCE=1, starting although the worst case is over the cap; the hard cap still applies');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dir = env.CHAT_EVAL_OUT ? path.resolve(env.CHAT_EVAL_OUT) : mkdtempSync(path.join(os.tmpdir(), 'coop-eval-'));
  mkdirSync(dir, {recursive: true});
  console.log(`chat-eval: run files in ${dir}`);
  const runs = [];
  let spent = 0;
  let incomplete = false;
  let rerun = null; // the majority tier: the ids that failed in run 1
  for (let i = 1; i <= plan.runs; i++) {
    const remaining = plan.capUsd - spent;
    if (remaining <= 1e-9) {
      console.error(`chat-eval: the $${plan.capUsd.toFixed(2)} cap is used up; run ${i} is not started`);
      incomplete = true;
      break;
    }
    if (i > 1) {
      if (rerun.length === 0) break; // every case passed the first run: nothing to repeat
      console.log(`chat-eval: re-running ${rerun.length} failed case(s) from run 1`);
    }
    const file = path.join(dir, `run-${i}.json`);
    const child = {...env, CHAT_LIVE_OUT: file, CHAT_LIVE_RUN: String(i), CHAT_EVAL_TIER: plan.tier, CHAT_EVAL_BUDGET_USD: String(remaining)};
    if (i > 1) child.CHAT_LIVE_CASES = rerun.join(',');
    const res = spawnSync('npx', ['vitest', 'run', 'test/chat-live-golden.integration.test.ts'], {cwd: root, stdio: 'inherit', env: child});
    if (!existsSync(file)) {
      console.error(`chat-eval: run ${i} wrote no result file (vitest exit ${res.status}); it cannot be counted`);
      incomplete = true;
      continue;
    }
    const run = JSON.parse(readFileSync(file, 'utf8'));
    runs.push(run);
    spent += run.totalCost ?? 0;
    if (run.budget?.exceeded) incomplete = true;
    if (i === 1 && plan.tier === 'majority') rerun = failedSelectors(run);
    if (plan.tier !== 'majority') break; // smoke and full are one run
  }
  if (runs.length === 0) {
    console.error('chat-eval: no run produced a result');
    process.exit(1);
  }
  const summary = majority(runs, {capUsd: plan.capUsd, tier: plan.tier});
  console.log(`\n${renderTable(summary).join('\n')}`);
  process.exit(summary.ok && !incomplete ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
