import {writeFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('server-only', () => ({}));

import {buildLiveContextBlock, buildStaticSystem} from '../src/chat/context';
import {COOP_CHAT} from '../src/chat/config';
import {runChatLoop, type ChatEffort, type MessagesClient} from '../src/chat/loop';
import {buildPreamble} from '../src/chat/preamble';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import {createExecutors} from '../src/chat/tool-executors';
import type {ToolExecutors} from '../src/chat/tools';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import {SKILL_SMOKE_IDS, costOf, createBudget, isBudgetError, parseCapUsd, parseTier, withBudget} from './support/eval-budget';
import {EVAL_NOW, SKILL_CASES} from './support/skill-eval-fixtures';
import {scoreCase, summaryLine, type RecordedCall} from './support/skill-eval-score';

// LIVE SKILL EVAL (skipped unless CHAT_LIVE_EVAL=1). Real Anthropic calls (a few cents per case) over SYNTHETIC data built
// in memory: no database is read and nothing is written. Each case asks one question, may tamper with a tool result to force
// a state the data cannot produce (a failed check, a round row count), and is scored mechanically (no LLM grader).
//   CHAT_LIVE_EVAL=1 CHAT_LIVE_EFFORT=medium CHAT_LIVE_OUT=/path/out.json npx vitest run test/chat-live-skill.integration.test.ts
// Cheap and capped: CHAT_EVAL_TIER=smoke (default) runs 3 cases (SKILL_SMOKE_IDS), full and majority run all 12, one run each (the 3-run
// majority belongs to scripts/chat-eval.mjs and the golden test). Every call is recorded against CHAT_EVAL_BUDGET_USD (default 3,
// test/support/eval-budget.ts) and the next call is refused once it is reached; a cap of 0 or below refuses to run.
// Optional: CHAT_LIVE_CASES=small_sample,read_only to run a subset; CHAT_LIVE_STRICT=1 to fail the run when a case fails.
// Needs ANTHROPIC_API_KEY. READ the answers in CHAT_LIVE_OUT: a green run is not done until the wording is read.
const live = process.env.CHAT_LIVE_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY;
const EFFORT = (process.env.CHAT_LIVE_EFFORT ?? 'medium') as ChatEffort;
const ONLY = (process.env.CHAT_LIVE_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const {tier} = parseTier(process.env.CHAT_EVAL_TIER);
const CAP_USD = parseCapUsd(process.env.CHAT_EVAL_BUDGET_USD); // missing or invalid: 3; 0 or below refuses to run
const cost = (u: {input: number; output: number; cacheRead: number; cacheWrite: number}) => costOf(u, COOP_CHAT.model); // prices live in eval-budget.ts

const label = (name: string, input: unknown): string => {
  if (name !== 'query_metric' || input === null || typeof input !== 'object') return name;
  const i = input as Record<string, unknown>;
  return `query_metric:${i.metric}/${i.dimension}/${i.measure} ${i.range}${i.range === 'custom' ? `(${i.from}..${i.to})` : ''} pet=${i.pet} cmp=${i.compare_to} sort=${i.sort} limit=${i.limit}`;
};
const isRefusal = (r: unknown): boolean => r !== null && typeof r === 'object' && Object.keys(r).length === 1 && 'error' in r;

describe.skipIf(!live)('live skill eval: real model, synthetic data', () => {
  it(`runs the skill cases at effort ${EFFORT}`, async () => {
    if (CAP_USD <= 0) throw new Error('refusing to run: CHAT_EVAL_BUDGET_USD is 0 or negative'); // a cap of 0 or below means refuse
    const budget = createBudget({capUsd: CAP_USD, model: COOP_CHAT.model});
    const anthropic = withBudget(new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY}) as unknown as MessagesClient, budget); // guarded before each step, recorded after
    const system = [
      {type: 'text' as const, text: buildStaticSystem({tools: true}), cache_control: {type: 'ephemeral' as const}},
      {type: 'text' as const, text: buildLiveContextBlock(), cache_control: {type: 'ephemeral' as const}},
    ];
    const out: Record<string, unknown>[] = [];

    const wanted = (id: string) => (ONLY.length > 0 ? ONLY.includes(id) : tier !== 'smoke' || SKILL_SMOKE_IDS.includes(id));
    let stopped: Error | null = null;
    for (const c of SKILL_CASES.filter((x) => wanted(x.id))) {
      try {
        budget.guard(); // before ANY model call
      } catch (e) {
        stopped = e as Error;
        console.log(`STOPPED ${stopped.message}`);
        break;
      }
      const data = c.data();
      const calls: RecordedCall[] = [];
      const results: unknown[] = [];
      const real = createExecutors({data: async () => data, now: EVAL_NOW, user: 'live-skill-eval'});
      // Wrap every executor: record the call, let the case tamper with the result, record what the model saw.
      const wrap = (name: 'describe_data' | 'query_metric') => async (input: unknown) => {
        const raw = await real[name]!(input);
        const seen = c.tamper ? c.tamper(name, raw) : raw;
        calls.push({name, input, label: label(name, input), error: isRefusal(seen), ...(seen !== raw ? {tampered: true} : {})});
        results.push(seen);
        return seen;
      };
      const executors: ToolExecutors = {describe_data: wrap('describe_data'), query_metric: wrap('query_metric')};
      const events: ChatStreamEvent[] = [];
      const t0 = Date.now();
      const sum = await runChatLoop({
        client: anthropic, model: COOP_CHAT.model, maxTokens: COOP_CHAT.maxTokens, effort: EFFORT, system, tools: CHAT_TOOLS,
        messages: [{role: 'user', content: c.question}], preamble: buildPreamble(data, EVAL_NOW), executors, emit: (e) => events.push(e), user: 'live-skill-eval',
      });
      const ms = Date.now() - t0;
      // The loop turns a refused step into an error event, so a cap reached mid-turn ends that turn: stop the run instead of scoring it.
      if (events.some((e) => e.t === 'error') && budget.exceeded()) {
        try {
          budget.guard();
        } catch (e) {
          stopped = isBudgetError(e) ? e : (e as Error);
          console.log(`STOPPED ${stopped.message}`);
          break;
        }
      }
      const text = events.filter((e): e is Extract<ChatStreamEvent, {t: 'text'}> => e.t === 'text').map((e) => e.d).join('');
      const errored = events.some((e) => e.t === 'error');
      const score = scoreCase(c.id, {text, calls, results});
      out.push({
        case: c.id, title: c.title, rules: c.rules, question: c.question, pass: score.pass, checks: score.checks, errored,
        ms, steps: sum.steps, stop: sum.stopReason, usage: sum.usage, cost: cost(sum.usage),
        calls: calls.map((x) => ({name: x.name, label: x.label, error: x.error, tampered: x.tampered ?? false, input: x.input})), text,
      });
      console.log(summaryLine(score));
    }

    const costs = out.map((r) => r.cost as number);
    const summary = {
      tier, effort: EFFORT, cases: out.length, passed: out.filter((r) => r.pass).length, failed: out.filter((r) => !r.pass).map((r) => r.case),
      errors: out.filter((r) => r.errored).length, totalCost: costs.reduce((a, b) => a + b, 0), maxCost: Math.max(0, ...costs),
      budget: {capUsd: budget.capUsd, spentUsd: budget.spentUsd(), exceeded: stopped !== null || budget.exceeded()},
    };
    console.log('SKILL SUMMARY', JSON.stringify(summary));
    if (process.env.CHAT_LIVE_OUT) writeFileSync(process.env.CHAT_LIVE_OUT, JSON.stringify({summary, out}, null, 2));
    if (stopped) throw stopped; // the cap was reached: the partial result is written above, the run fails
    expect(summary.errors).toBe(0);
    if (process.env.CHAT_LIVE_STRICT === '1') expect(summary.failed).toEqual([]);
  }, 900_000);
});
