import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {createClient} from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import {buildDigestBlock, buildStaticSystem} from '../src/chat/context';
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
import {assertLocalRun, majority, renderTable, type LiveRun, type RunCase} from '../scripts/chat-eval.mjs';
import {
  BASE_SPEC, BUNDLE_DASHBOARD_SCRIPT, CHAIN, CHAIN_FINAL_SPEC, GOLDEN_CASES, GOLDEN_DIGEST, GRADER_SYSTEM, PROBE_EXCLUDES, READ_ONLY_PROBES, bodyText, canon, goldenData,
  mechanicalFailures, normalizeSpecForLive, parseVerdict, rubricPrompt, type GoldenCase, type Observed,
} from './support/golden-cases';
import {assertLocalSupabase} from './support/local-only';
import {runScripted} from './support/scripted-model';
import {EVAL_NOW, SKILL_CASES, type Tamper} from './support/skill-eval-fixtures';
import {scoreCase, type RecordedCall} from './support/skill-eval-score';

// LIVE GOLDEN EVAL (Slice 6): real Anthropic calls over READ-ONLY data, LOCAL DATABASE ONLY. Skipped unless CHAT_LIVE_EVAL=1, and
// it REFUSES to run unless SUPABASE_URL_ARCHIVE is 127.0.0.1 or localhost (the .env project is PRODUCTION and is never used).
// One invocation is ONE pass over: the 25 golden cases, the read-only probes, the 12 skill-behavior cases (mechanical scorers from
// F6) and the multi-turn bundle chain. scripts/chat-eval.mjs runs it N times and takes the 3-run majority; run alone it prints
// one pass. Nothing is written to any database (the read path is the guarded, GET-only client).
//
//   set -a; source scripts/local-supabase/.local-env; set +a        # the throwaway local Supabase
//   CHAT_LIVE_EVAL=1 ANTHROPIC_API_KEY=... CHAT_LIVE_OUT=/tmp/run.json npx vitest run test/chat-live-golden.integration.test.ts
//
// Env NAMES: CHAT_LIVE_EVAL, ANTHROPIC_API_KEY, SUPABASE_URL_ARCHIVE, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE (local values), and optional
// CHAT_LIVE_MODEL (sonnet-5-5 default | opus-5-5 | a full model id), CHAT_LIVE_EFFORT, CHAT_LIVE_GRADER (0 = no LLM grader),
// CHAT_GRADER_MODEL, CHAT_LIVE_DATA (local default | synthetic: the in-memory fixtures, no database read), CHAT_LIVE_CHAIN
// (seeded default | scratch: the model also builds turn 1), CHAT_LIVE_CASES (comma list of case ids), CHAT_LIVE_OUT, CHAT_LIVE_RUN.
// No secret is ever printed or written to the result file. READ the answers in CHAT_LIVE_OUT: a green run is not done until a
// person has read the wording (lesson: read-the-live-answers).
const env = process.env as Record<string, string | undefined>;
const wanted = env.CHAT_LIVE_EVAL === '1';
const gate = assertLocalRun(env);

const MODELS: Record<string, {id: string; price: {in: number; out: number; cacheRead: number; cacheWrite: number}}> = {
  'sonnet-5-5': {id: COOP_CHAT.model, price: {in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5}}, // $ per 1M tokens (design section 9)
  'opus-5-5': {id: 'claude-opus-5-5', price: {in: 4, out: 20, cacheRead: 0.4, cacheWrite: 5}},
};
const alias = env.CHAT_LIVE_MODEL ?? 'sonnet-5-5';
const picked = MODELS[alias] ?? {id: alias, price: MODELS['sonnet-5-5'].price}; // an unknown id is priced as Sonnet: an estimate
const EFFORT = (env.CHAT_LIVE_EFFORT ?? CHAT_EFFORT) as ChatEffort;
const GRADE = env.CHAT_LIVE_GRADER !== '0';
const GRADER_MODEL = env.CHAT_GRADER_MODEL ?? COOP_CHAT.model;
const SYNTHETIC = env.CHAT_LIVE_DATA === 'synthetic';
const SCRATCH = env.CHAT_LIVE_CHAIN === 'scratch';
const ONLY = (env.CHAT_LIVE_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const USER = 'live-golden-eval';

const cost = (u: {input: number; output: number; cacheRead: number; cacheWrite: number}): number =>
  (u.input * picked.price.in + u.output * picked.price.out + u.cacheRead * picked.price.cacheRead + u.cacheWrite * picked.price.cacheWrite) / 1e6;
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
  guardTrips: number;
  /** Figures the log-only number check flagged in this turn's answer (the loop's chat_number_violation line). */
  figures: string[];
}

async function turn(
  anthropic: MessagesClient,
  system: SystemBlock[],
  a: {messages: {role: 'user' | 'assistant'; content: string}[]; data: MetricData; digest: DigestSource | null; now: Date; report?: ReportSpec | null; tamper?: Tamper},
): Promise<Turn> {
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
    client: rec.client, model: picked.id, maxTokens: COOP_CHAT.maxTokens, effort: EFFORT, system, tools: CHAT_TOOLS, messages: a.messages,
    preamble: buildPreamble(a.data, a.now, session.outline()), executors, emit: (e) => events.push(e), user: USER, sink,
  });
  return {
    text: events.filter((e): e is Extract<ChatStreamEvent, {t: 'text'}> => e.t === 'text').map((e) => e.d).join(''),
    calls: rec.calls, recorded, results, blocks, finalSpec: session.snapshot(), requests: rec.requests, errored: events.some((e) => e.t === 'error'),
    steps: sum.steps, ms: Date.now() - t0, cost: cost(sum.usage), guardTrips, figures,
  };
}

async function grade(anthropic: Anthropic, question: string, t: Turn, rubric: readonly string[]): Promise<boolean[] | null> {
  if (!GRADE || rubric.length === 0) return null;
  try {
    const res = await anthropic.messages.create({
      model: GRADER_MODEL, max_tokens: 1200, system: GRADER_SYSTEM,
      messages: [{role: 'user', content: rubricPrompt(question, t.text, t.results, rubric)}],
    });
    const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    return parseVerdict(raw, rubric.length) ?? rubric.map(() => false); // an unreadable verdict is a fail, never a silent pass
  } catch {
    return rubric.map(() => false);
  }
}

const observed = (t: Turn): Observed => ({calls: t.calls, text: t.text, blocks: t.blocks, finalSpec: t.finalSpec, requests: t.requests});
const unknownNames = (t: Turn): string[] => t.calls.map((c) => c.name).filter((n) => !(TOOL_ALLOWLIST as readonly string[]).includes(n));

describe.skipIf(!wanted)('live golden eval: real model, local database only', () => {
  it('is allowed to run: CHAT_LIVE_EVAL=1, a local Supabase host, and a key present (names only, no value is shown)', () => {
    expect(gate.problems).toEqual([]);
  });

  it(`runs one pass over the golden set, the probes, the skill cases and the chain (${alias}, effort ${EFFORT})`, async () => {
    if (!gate.ok) throw new Error(`refusing to run: ${gate.problems.join('; ')}`); // before any client or network exists
    const anthropic = new Anthropic({apiKey: env.ANTHROPIC_API_KEY});
    const client = anthropic as unknown as MessagesClient;
    const world = await loadWorld();
    const system: SystemBlock[] = [
      {type: 'text', text: buildStaticSystem(), cache_control: {type: 'ephemeral'}},
      {type: 'text', text: buildDigestBlock([], undefined, {home: true}), cache_control: {type: 'ephemeral'}},
    ];
    const cases: (RunCase & {question: string; calls: string[]; text: string; ms: number; cost: number; numberFigures: string[]})[] = [];
    let numberViolations = 0;
    let totalCost = 0;
    let errors = 0;
    let trips = 0;
    let unknownTools = 0;
    const tally = (t: Turn): void => {
      totalCost += t.cost;
      errors += t.errored ? 1 : 0;
      trips += t.guardTrips;
      unknownTools += unknownNames(t).length;
      numberViolations += t.figures.length;
    };
    const selected = (id: string) => ONLY.length === 0 || ONLY.includes(id);

    // 1. the golden set
    for (const c of GOLDEN_CASES.filter((x) => selected(x.id))) {
      const t = await turn(client, system, {messages: [...(c.prior ?? []), {role: 'user', content: c.prompt}], data: world.data, digest: world.digest, now: world.now, report: c.startReport ?? null});
      const failures = mechanicalFailures(c as GoldenCase, observed(t), {live: true, skipDataText: world.kind !== 'synthetic'});
      if (t.errored) failures.push('the turn ended in an error event');
      for (const n of unknownNames(t)) failures.push(`non-allowlisted tool name ${n}`);
      const rubric = await grade(anthropic, c.prompt, t, c.rubric);
      tally(t);
      cases.push({id: c.id, kind: 'golden', category: c.category, steps: c.steps, mech: failures.length === 0, failures, rubric, question: c.prompt, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost, numberFigures: t.figures});
      console.log(`GOLDEN ${failures.length === 0 ? 'pass' : 'FAIL'} ${c.id} ${t.ms}ms $${t.cost.toFixed(4)} [${t.recorded.map((r) => r.name).join(' ')}]${failures.length ? ` :: ${failures[0]}` : ''}`);
    }

    // 2. read-only probes: only allowlisted tools, and the answer claims no action
    for (const q of READ_ONLY_PROBES.filter((p) => selected(`probe:${p}`))) {
      const t = await turn(client, system, {messages: [{role: 'user', content: q}], data: world.data, digest: world.digest, now: world.now});
      const failures = [...unknownNames(t).map((n) => `non-allowlisted tool name ${n}`), ...PROBE_EXCLUDES.filter((re) => re.test(t.text)).map((re) => `text matches ${re}`)];
      if (t.errored) failures.push('the turn ended in an error event');
      tally(t);
      cases.push({id: `probe: ${q}`, kind: 'probe', category: 'negative', steps: ['safety'], mech: failures.length === 0, failures, rubric: null, question: q, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost, numberFigures: t.figures});
      console.log(`PROBE ${failures.length === 0 ? 'pass' : 'FAIL'} "${q}" [${t.calls.map((x) => x.name).join(' ')}]`);
    }

    // 3. the skill-behavior cases (F6): synthetic data, tampered results, mechanical scorers
    for (const c of SKILL_CASES.filter((x) => selected(x.id))) {
      const data = c.data();
      const t = await turn(client, system, {messages: [{role: 'user', content: c.question}], data, digest: null, now: EVAL_NOW, tamper: c.tamper});
      const score = scoreCase(c.id, {text: t.text, calls: t.recorded, results: t.results});
      const failures = score.checks.filter((k) => !k.pass).map((k) => `${k.name}: ${k.detail}`);
      if (t.errored) failures.push('the turn ended in an error event');
      tally(t);
      cases.push({id: c.id, kind: 'skill', category: 'skill', steps: c.rules, mech: failures.length === 0, failures, rubric: null, question: c.question, calls: t.recorded.map((r) => r.label), text: t.text, ms: t.ms, cost: t.cost, numberFigures: t.figures});
      console.log(`SKILL ${failures.length === 0 ? 'pass' : 'FAIL'} ${c.id} ${t.ms}ms $${t.cost.toFixed(4)}${failures.length ? ` :: ${failures[0]}` : ''}`);
    }

    // 4. the multi-turn chain: the final spec must equal the expected spec exactly (after masking model-written titles and labels)
    let chain: {mech: boolean; failures: string[]} | null = null;
    if (selected('chain')) {
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
        const t = await turn(client, system, {messages: [...history, {role: 'user', content: step.prompt}], data: world.data, digest: world.digest, now: world.now, report: spec});
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

    const pass: LiveRun & {run: number; data: string; grader: boolean; cases: typeof cases} = {
      model: picked.id, effort: EFFORT, run: Number(env.CHAT_LIVE_RUN ?? 1), data: world.kind, grader: GRADE, cases, chain,
      guard: {attemptedNonRead: world.attemptedNonRead(), trips, unknownTools}, errors, totalCost, numberViolations,
    };
    console.log(`\n${renderTable(majority([pass])).join('\n')}`);
    if (env.CHAT_LIVE_OUT) {
      mkdirSync(path.dirname(path.resolve(env.CHAT_LIVE_OUT)), {recursive: true});
      writeFileSync(env.CHAT_LIVE_OUT, JSON.stringify(pass, null, 2));
    }
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
