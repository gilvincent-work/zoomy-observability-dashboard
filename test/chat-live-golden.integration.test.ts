import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {createClient} from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import {buildLiveContextBlock, buildStaticSystem} from '../src/chat/context';
import {CHAT_EFFORT, COOP_CHAT} from '../src/chat/config';
import type {DigestSource} from '../src/chat/digest-lookup';
import {runChatLoop, type ChatEffort, type MessagesClient, type SystemBlock} from '../src/chat/loop';
import {buildPreamble} from '../src/chat/preamble';
import {chatDigestClient} from '../src/chat/read/client';
import {buildChatReadConfig} from '../src/chat/read/config';
import {readDigestRows} from '../src/chat/read/digest';
import {createGuardedFetch} from '../src/chat/read/guarded-fetch';
import {loadMetricData} from '../src/chat/read/metric-data';
import {relationsForMode} from '../src/chat/read/relations';
import {openReportSession} from '../src/chat/report-session';
import type {ChatBlock} from '../src/chat/block-types';
import type {ReportSpec} from '../src/chat/report-types';
import type {MetricData} from '../src/chat/result-types';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import {createExecutors} from '../src/chat/tool-executors';
import {TOOL_ALLOWLIST, type ToolExecutors} from '../src/chat/tools';
import type {ReadClient} from '../src/pos-orders-read';
import {assertLocalRun, majority, parseCapUsd, parseTier, renderTable, type LiveRun, type RunCase} from '../scripts/chat-eval.mjs';
import {
  BASE_SPEC, BUNDLE_DASHBOARD_SCRIPT, CHAIN, CHAIN_FINAL_SPEC, GOLDEN_CASES, GOLDEN_DIGEST, PROBE_EXCLUDES, READ_ONLY_PROBES, bodyText, canon, goldenData,
  mechanicalFailures, normalizeSpecForLive, type GoldenCase, type Observed,
} from './support/golden-cases';
import {addUsage, costOf, createBudget, inTier, isBudgetError, priceFor, withBudget, zeroUsage, type Budget, type Usage} from './support/eval-budget';
import {graderShape, runGrader} from './support/eval-grader';
import {assertLocalSupabase} from './support/local-only';
import {runScripted} from './support/scripted-model';
import {EVAL_NOW, SKILL_CASES, type Tamper} from './support/skill-eval-fixtures';
import {scoreCase, type RecordedCall} from './support/skill-eval-score';

// LIVE GOLDEN EVAL (Slice 6): real Anthropic calls over READ-ONLY data, LOCAL DATABASE ONLY. Skipped unless CHAT_LIVE_EVAL=1, and
// it REFUSES to run unless SUPABASE_URL_ARCHIVE is 127.0.0.1 or localhost (the .env project is PRODUCTION and is never used).
// One invocation is ONE pass, and CHAT_EVAL_TIER says how much of the suite it covers (cheap by default):
//   smoke (default)  the smoke-flagged golden cases only (golden-cases.ts), about $0.4 to $1
//   full / majority  the 29 golden cases, the read-only probes, the 12 skill-behavior cases (mechanical scorers from F6) and the multi-turn
//                    bundle chain: one pass, about $1.5 to $2.5. scripts/chat-eval.mjs adds the majority repeats (failed cases only).
// Every Anthropic call, the grader's included, is recorded against CHAT_EVAL_BUDGET_USD (default 3, test/support/eval-budget.ts) and the next call is
// refused once it is reached; the partial result is still written and the run then fails. Cases run back to back (no sleeps, no fan-out) so
// the 5-minute prompt cache stays warm. Nothing is written to any database (the read path is the guarded, GET-only client).
//
//   set -a; source scripts/local-supabase/.local-env; set +a        # the throwaway local Supabase
//   CHAT_LIVE_EVAL=1 ANTHROPIC_API_KEY=... CHAT_LIVE_OUT=/tmp/run.json npx vitest run test/chat-live-golden.integration.test.ts
//
// Env NAMES: CHAT_LIVE_EVAL, ANTHROPIC_API_KEY, SUPABASE_URL_ARCHIVE, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE (local values), and optional
// CHAT_EVAL_TIER (smoke | full | majority), CHAT_EVAL_BUDGET_USD, CHAT_LIVE_MODEL (sonnet-5-5 default | opus-5-5 | a full model id),
// CHAT_LIVE_EFFORT, CHAT_LIVE_GRADER (0 = no LLM grader), CHAT_GRADER_MODEL (default: the chat model; claude-haiku-4-5-20251001 is the cheap
// choice), CHAT_LIVE_DATA (local default | synthetic: the in-memory fixtures, no database read), CHAT_LIVE_CHAIN (seeded default | scratch: the
// model also builds turn 1), CHAT_LIVE_CASES (comma list of case ids; overrides the tier), CHAT_LIVE_OUT, CHAT_LIVE_RUN.
// No secret is ever printed or written to the result file. READ the answers in CHAT_LIVE_OUT: a green run is not done until a
// person has read the wording (lesson: read-the-live-answers).
const env = process.env as Record<string, string | undefined>;
const wanted = env.CHAT_LIVE_EVAL === '1';
const gate = assertLocalRun(env);

const MODELS: Record<string, string> = {'sonnet-5-5': COOP_CHAT.model, 'opus-5-5': 'claude-opus-5-5'};
const alias = env.CHAT_LIVE_MODEL ?? 'sonnet-5-5';
const MODEL_ID = MODELS[alias] ?? alias; // prices: test/support/eval-budget.ts (an unlisted model is priced at the Sonnet rates x2)
const EFFORT = (env.CHAT_LIVE_EFFORT ?? CHAT_EFFORT) as ChatEffort;
const GRADE = env.CHAT_LIVE_GRADER !== '0';
const GRADER_MODEL = env.CHAT_GRADER_MODEL ?? COOP_CHAT.model;
const SYNTHETIC = env.CHAT_LIVE_DATA === 'synthetic';
const SCRATCH = env.CHAT_LIVE_CHAIN === 'scratch';
const ONLY = (env.CHAT_LIVE_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const {tier} = parseTier(env.CHAT_EVAL_TIER); // an unknown name falls back to smoke, the cheap one
const CAP_USD = parseCapUsd(env.CHAT_EVAL_BUDGET_USD); // missing or invalid: 3; 0 or below refuses to run
const USER = 'live-golden-eval';

const isRefusal = (r: unknown): boolean => r !== null && typeof r === 'object' && Object.keys(r).length === 1 && 'error' in r;
const label = (name: string, input: unknown): string => {
  if (name !== 'query_metric' || input === null || typeof input !== 'object') return name;
  const i = input as Record<string, unknown>;
  return `query_metric:${i.metric}/${i.dimension}/${i.measure} ${i.range}${i.range === 'custom' ? `(${i.from}..${i.to})` : ''} pet=${i.pet} cmp=${i.compare_to} limit=${i.limit}`;
};

interface World {
  data: MetricData;
  digest: DigestSource | null;
  now: Date;
  kind: 'local' | 'synthetic';
  /** Attempted non-read requests counted by the HTTP guards (always 0 for the synthetic world). */
  attemptedNonRead: () => number;
}

async function loadWorld(): Promise<World> {
  if (SYNTHETIC) return {data: goldenData(), digest: GOLDEN_DIGEST, now: EVAL_NOW, kind: 'synthetic', attemptedNonRead: () => 0};
  assertLocalSupabase(env.SUPABASE_URL_ARCHIVE); // the shared owner-rule guard, directly before any client exists
  const cfg = buildChatReadConfig({mode: 'guarded_service', env});
  const guard = createGuardedFetch({baseUrl: cfg.url, relations: relationsForMode('guarded_service').allowed, underlying: fetch});
  const sb = createClient(cfg.url, cfg.key, {auth: {persistSession: false}, global: {fetch: guard.fetch}});
  const data = await loadMetricData(sb as unknown as ReadClient, 'guarded_service');
  let digest: DigestSource | null = null;
  let digestGuard = {attemptedNonRead: 0};
  try {
    const dg = chatDigestClient({mode: 'guarded_service', env});
    digestGuard = dg.stats;
    digest = {source: 'live', rows: await readDigestRows(dg.client, 'guarded_service')};
  } catch {
    digest = null; // the digest is optional: get_digest then says it is unavailable
  }
  return {data, digest, now: new Date(), kind: 'local', attemptedNonRead: () => guard.stats.attemptedNonRead + digestGuard.attemptedNonRead};
}

/** Wraps the real client to record what the model asked for (refused and unknown tools included) and every request sent. */
function recording(real: MessagesClient) {
  const calls: {name: string; input: unknown}[] = [];
  const requests: string[] = [];
  const client: MessagesClient = {
    messages: {
      stream: (params, options) => {
        requests.push(JSON.stringify(params.messages));
        const stream = real.messages.stream(params, options);
        return {
          [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
          finalMessage: async () => {
            const msg = await stream.finalMessage();
            for (const b of msg.content) if (b.type === 'tool_use') calls.push({name: b.name, input: b.input});
            return msg;
          },
        };
      },
    },
  };
  return {client, calls, requests};
}

interface Turn {
  text: string;
  calls: {name: string; input: unknown}[];
  recorded: RecordedCall[];
  results: unknown[];
  blocks: ChatBlock[];
  finalSpec: ReportSpec | null;
  requests: string[];
  errored: boolean;
  steps: number;
  ms: number;
  cost: number;
  usage: Usage;
  guardTrips: number;
  /** Figures the log-only number check flagged in this turn's answer (the loop's chat_number_violation line). */
  figures: string[];
}

async function turn(
  anthropic: MessagesClient,
  system: SystemBlock[],
  a: {messages: {role: 'user' | 'assistant'; content: string}[]; data: MetricData; digest: DigestSource | null; now: Date; report?: ReportSpec | null; tamper?: Tamper; budget: Budget},
): Promise<Turn> {
  a.budget.guard(); // before ANY model call: the cap is a hard stop
  const rec = recording(anthropic);
  const session = openReportSession(a.report ?? undefined, a.data, a.now);
  const events: ChatStreamEvent[] = [];
  const blocks: ChatBlock[] = [];
  const real = createExecutors({
    data: async () => a.data, now: a.now, user: USER, report: session, emitBlock: (b) => blocks.push(b), emitReport: () => undefined,
    ...(a.digest ? {digest: async () => a.digest as DigestSource} : {}),
  });
  const recorded: RecordedCall[] = [];
  const results: unknown[] = [];
  const executors: ToolExecutors = {};
  for (const name of TOOL_ALLOWLIST) {
    const fn = real[name];
    if (!fn) continue;
    executors[name] = async (input) => {
      const raw = await fn(input);
      const seen = a.tamper ? a.tamper(name, raw) : raw;
      recorded.push({name, input, label: label(name, input), error: isRefusal(seen), ...(seen !== raw ? {tampered: true} : {})});
      results.push(seen);
      return seen;
    };
  }
  let guardTrips = 0;
  const figures: string[] = [];
  const sink = {
    info: (line: unknown) => {
      try {
        const l = JSON.parse(String(line)) as {event?: string; figures?: string[]};
        if (l.event === 'chat_number_violation') figures.push(...(l.figures ?? []));
      } catch {
        // not a JSON audit line
      }
    },
    error: (line: unknown) => {
      try {
        if ((JSON.parse(String(line)) as {event?: string}).event === 'chat_guard_trip') guardTrips += 1;
      } catch {
        // not a JSON audit line
      }
    },
  };
  const t0 = Date.now();
  const sum = await runChatLoop({
    client: rec.client, model: MODEL_ID, maxTokens: COOP_CHAT.maxTokens, effort: EFFORT, system, tools: CHAT_TOOLS, messages: a.messages,
    preamble: buildPreamble(a.data, a.now, session.outline()), executors, emit: (e) => events.push(e), user: USER, sink,
  });
  // The loop turns a refused step into an error event; once the cap is reached the WHOLE run stops (guard throws) instead of scoring that turn.
  if (events.some((e) => e.t === 'error') && a.budget.exceeded()) a.budget.guard();
  return {
    text: events.filter((e): e is Extract<ChatStreamEvent, {t: 'text'}> => e.t === 'text').map((e) => e.d).join(''),
    calls: rec.calls, recorded, results, blocks, finalSpec: session.snapshot(), requests: rec.requests, errored: events.some((e) => e.t === 'error'),
    steps: sum.steps, ms: Date.now() - t0, cost: costOf(sum.usage, MODEL_ID), usage: sum.usage, guardTrips, figures,
  };
}

interface Graded {
  rubric: boolean[] | null;
  ungraded: boolean;
  usage: Usage;
  cost: number;
}

/** One grader call per rubric case, only for a case whose mechanical checks held. An unreadable or truncated verdict is UNGRADED, not a FAIL. */
async function grade(anthropic: Anthropic, budget: Budget, question: string, t: Turn, rubric: readonly string[]): Promise<Graded> {
  if (!GRADE || rubric.length === 0) return {rubric: null, ungraded: false, usage: zeroUsage(), cost: 0};
  const run = await runGrader({create: (p) => anthropic.messages.create(p as never) as never, budget, model: GRADER_MODEL, question, answer: t.text, results: t.results, rubric});
  if (run.grade.state === 'ungraded') console.log(`UNGRADED ${run.grade.reason}`);
  return {rubric: run.grade.state === 'graded' ? run.grade.verdict : null, ungraded: run.grade.state === 'ungraded', usage: run.usage, cost: run.cost};
}

const observed = (t: Turn): Observed => ({calls: t.calls, text: t.text, blocks: t.blocks, finalSpec: t.finalSpec, requests: t.requests});
const unknownNames = (t: Turn): string[] => t.calls.map((c) => c.name).filter((n) => !(TOOL_ALLOWLIST as readonly string[]).includes(n));

describe.skipIf(!wanted)('live golden eval: real model, local database only', () => {
  it('is allowed to run: CHAT_LIVE_EVAL=1, a local Supabase host, and a key present (names only, no value is shown)', () => {
    expect(gate.problems).toEqual([]);
  });

  it(`runs one pass (tier ${tier}) over the golden set, and in the full tiers the probes, the skill cases and the chain (${alias}, effort ${EFFORT})`, async () => {
    if (!gate.ok) throw new Error(`refusing to run: ${gate.problems.join('; ')}`); // before any client or network exists
    if (CAP_USD <= 0) throw new Error('refusing to run: CHAT_EVAL_BUDGET_USD is 0 or negative'); // a cap of 0 or below means refuse
    const budget = createBudget({capUsd: CAP_USD, model: MODEL_ID});
    const anthropic = new Anthropic({apiKey: env.ANTHROPIC_API_KEY});
    const client = withBudget(anthropic as unknown as MessagesClient, budget); // every chat step is guarded before it is sent and recorded after
    const world = await loadWorld();
    const system: SystemBlock[] = [
      {type: 'text', text: buildStaticSystem({tools: true}), cache_control: {type: 'ephemeral'}},
      {type: 'text', text: buildLiveContextBlock(), cache_control: {type: 'ephemeral'}},
    ];
    console.log(`LIVE EVAL tier ${tier}, cap $${budget.capUsd.toFixed(2)}, chat model ${MODEL_ID}${priceFor(MODEL_ID).known ? '' : ' (unlisted: priced at the Sonnet rates x2)'}${GRADE ? `, grader ${GRADER_MODEL}: ${graderShape(GRADER_MODEL).note}` : ', grader off'}`);
    const cases: (RunCase & {question: string; calls: string[]; text: string; ms: number; cost: number; usage: Usage; numberFigures: string[]})[] = [];
    let numberViolations = 0;
    let errors = 0;
    let trips = 0;
    let unknownTools = 0;
    const tally = (t: Turn): void => {
      errors += t.errored ? 1 : 0;
      trips += t.guardTrips;
      unknownTools += unknownNames(t).length;
      numberViolations += t.figures.length;
    };
    const selected = (id: string, flaggedSmoke: boolean) => (ONLY.length > 0 ? ONLY.includes(id) : inTier(tier, flaggedSmoke));
    let chain: {mech: boolean; failures: string[]} | null = null;
    let stopped: Error | null = null;

    try {
      // 1. the golden set
      for (const c of GOLDEN_CASES.filter((x) => selected(x.id, x.smoke === true))) {
        const t = await turn(client, system, {messages: [...(c.prior ?? []), {role: 'user', content: c.prompt}], data: world.data, digest: world.digest, now: world.now, report: c.startReport ?? null, budget});
        const failures = mechanicalFailures(c as GoldenCase, observed(t), {live: true, skipDataText: world.kind !== 'synthetic'});
        if (t.errored) failures.push('the turn ended in an error event');
        for (const n of unknownNames(t)) failures.push(`non-allowlisted tool name ${n}`);
        // a case that already failed mechanically is not graded: the grader call would only cost money
        const g: Graded = failures.length === 0 ? await grade(anthropic, budget, c.prompt, t, c.rubric) : {rubric: null, ungraded: false, usage: zeroUsage(), cost: 0};
        tally(t);
        cases.push({id: c.id, kind: 'golden', category: c.category, steps: c.steps, mech: failures.length === 0, failures, rubric: g.rubric, ungraded: g.ungraded, question: c.prompt, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost + g.cost, usage: addUsage(t.usage, g.usage), numberFigures: t.figures});
        console.log(`GOLDEN ${failures.length === 0 ? 'pass' : 'FAIL'} ${c.id} ${t.ms}ms $${(t.cost + g.cost).toFixed(4)} [${t.recorded.map((r) => r.name).join(' ')}]${failures.length ? ` :: ${failures[0]}` : ''}`);
      }

      // 2. read-only probes: only allowlisted tools, and the answer claims no action
      for (const q of READ_ONLY_PROBES.filter((p) => selected(`probe:${p}`, false))) {
        const t = await turn(client, system, {messages: [{role: 'user', content: q}], data: world.data, digest: world.digest, now: world.now, budget});
        const failures = [...unknownNames(t).map((n) => `non-allowlisted tool name ${n}`), ...PROBE_EXCLUDES.filter((re) => re.test(t.text)).map((re) => `text matches ${re}`)];
        if (t.errored) failures.push('the turn ended in an error event');
        tally(t);
        cases.push({id: `probe: ${q}`, kind: 'probe', category: 'negative', steps: ['safety'], mech: failures.length === 0, failures, rubric: null, question: q, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost, usage: t.usage, numberFigures: t.figures});
        console.log(`PROBE ${failures.length === 0 ? 'pass' : 'FAIL'} "${q}" [${t.calls.map((x) => x.name).join(' ')}]`);
      }

      // 3. the skill-behavior cases (F6): synthetic data, tampered results, mechanical scorers
      for (const c of SKILL_CASES.filter((x) => selected(x.id, false))) {
        const data = c.data();
        const t = await turn(client, system, {messages: [{role: 'user', content: c.question}], data, digest: null, now: EVAL_NOW, tamper: c.tamper, budget});
        const score = scoreCase(c.id, {text: t.text, calls: t.recorded, results: t.results});
        const failures = score.checks.filter((k) => !k.pass).map((k) => `${k.name}: ${k.detail}`);
        if (t.errored) failures.push('the turn ended in an error event');
        tally(t);
        cases.push({id: c.id, kind: 'skill', category: 'skill', steps: c.rules, mech: failures.length === 0, failures, rubric: null, question: c.question, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost, usage: t.usage, numberFigures: t.figures});
        console.log(`SKILL ${failures.length === 0 ? 'pass' : 'FAIL'} ${c.id} ${t.ms}ms $${t.cost.toFixed(4)}${failures.length ? ` :: ${failures[0]}` : ''}`);
      }

      // 4. the multi-turn chain: the final spec must equal the expected spec exactly (after masking model-written titles and labels)
      if (selected('chain', false)) {
        const failures: string[] = [];
        const history: {role: 'user' | 'assistant'; content: string}[] = [];
        let spec: ReportSpec | null = null;
        const from = SCRATCH ? 0 : 1;
        if (!SCRATCH) {
          // turn 1 is replayed by the scripted model (offline, same real loop and executors) so the live model is judged on the edits
          const seed = await runScripted({script: BUNDLE_DASHBOARD_SCRIPT, messages: [{role: 'user', content: CHAIN[0].prompt}], data: world.data, now: world.now, report: null});
          spec = seed.finalSpec;
          history.push({role: 'user', content: CHAIN[0].prompt}, {role: 'assistant', content: seed.text});
          if (canon(spec) !== canon(BASE_SPEC)) failures.push('the seeded first turn did not leave the expected bundle dashboard');
        }
        for (const step of CHAIN.slice(from)) {
          const t = await turn(client, system, {messages: [...history, {role: 'user', content: step.prompt}], data: world.data, digest: world.digest, now: world.now, report: spec, budget});
          tally(t);
          if (t.errored) failures.push(`turn "${step.prompt}" ended in an error event`);
          history.push({role: 'user', content: step.prompt}, {role: 'assistant', content: bodyText(t.text)});
          spec = t.finalSpec;
          console.log(`CHAIN ${step.prompt} ${t.ms}ms [${t.calls.map((x) => x.name).join(' ')}]`);
        }
        const baseIds = SCRATCH ? ['b5', 'b6'] : BASE_SPEC.blocks.map((b) => b.id);
        if (canon(normalizeSpecForLive(spec, baseIds)) !== canon(normalizeSpecForLive(CHAIN_FINAL_SPEC, baseIds))) failures.push('the final spec differs from the expected spec');
        chain = {mech: failures.length === 0, failures};
        console.log(`CHAIN ${failures.length === 0 ? 'pass' : 'FAIL'}${failures.length ? ` :: ${failures[0]}` : ''}`);
      }
    } catch (e) {
      if (!isBudgetError(e)) throw e;
      stopped = e; // the cap was reached: keep what finished, write it, then fail the run below
      console.log(`STOPPED ${e.message}`);
    }

    const pass: LiveRun & {run: number; data: string; grader: boolean; cases: typeof cases} = {
      model: MODEL_ID, effort: EFFORT, run: Number(env.CHAT_LIVE_RUN ?? 1), data: world.kind, grader: GRADE, cases, chain,
      guard: {attemptedNonRead: world.attemptedNonRead(), trips, unknownTools}, errors, totalCost: budget.spentUsd(), numberViolations,
      tier, usage: budget.totals(), budget: {capUsd: budget.capUsd, spentUsd: budget.spentUsd(), exceeded: stopped !== null || budget.exceeded()},
    };
    console.log(`\n${renderTable(majority([pass], {capUsd: budget.capUsd, tier})).join('\n')}`);
    if (env.CHAT_LIVE_OUT) {
      mkdirSync(path.dirname(path.resolve(env.CHAT_LIVE_OUT)), {recursive: true});
      writeFileSync(env.CHAT_LIVE_OUT, JSON.stringify(pass, null, 2));
    }
    if (stopped) throw stopped;
    // The hard guarantees fail the run; the pass rates are reported (and voted on by scripts/chat-eval.mjs), not asserted here.
    expect(pass.guard.attemptedNonRead).toBe(0);
    expect(pass.guard.trips).toBe(0);
    expect(pass.guard.unknownTools).toBe(0);
    expect(pass.errors).toBe(0);
    if (env.CHAT_LIVE_STRICT === '1') {
      expect(cases.filter((c) => !c.mech).map((c) => c.id)).toEqual([]);
      expect(chain?.mech ?? true).toBe(true);
    }
  }, 3_600_000);
});
