// LIVE GOLDEN EVAL for Explore (Day 6): REAL Anthropic calls, LOCAL DATABASE ONLY, the small chosen live set (test/support/explore-golden.ts, LIVE_SET).
// Skipped unless CHAT_EXPLORE_LIVE_EVAL=1. It refuses to run unless the Postgres and Supabase URLs are loopback (guards first), and every
// model step is guarded and priced by test/support/eval-budget.ts: the run stops at CHAT_EXPLORE_BUDGET (default 1.2 US dollars; also
// honours CHAT_EVAL_BUDGET_USD when that is set lower). The Anthropic test account has a $2 hard limit: do not raise the cap, do not repeat the
// whole set; re-run a single case with CHAT_LIVE_CASES=G25.
//   set -a; . scripts/local-supabase/.local-env; set +a
//   CHAT_EXPLORE_LIVE_EVAL=1 ANTHROPIC_API_KEY=... CHAT_EVAL_BUDGET_USD=1.2 CHAT_LIVE_OUT=/tmp/explore-live.json \
//     npx vitest run test/chat-golden-explore.integration.test.ts
// Optional: CHAT_LIVE_MODEL (default: the chat model), CHAT_LIVE_EFFORT, CHAT_LIVE_CASES (comma list), CHAT_LIVE_GRADER=1 (rubric grader, extra cost).
// READ the answers in CHAT_LIVE_OUT: a green run is not done until a person has read the wording (lesson: read-the-live-answers).
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {CHAT_EFFORT, COOP_CHAT} from '../src/chat/config';
import type {ChatEffort, MessagesClient} from '../src/chat/loop';
import {computeExpected} from '../scripts/explore-golden-expected.mjs';
import {LIVE_SET, type VerifyContext} from './support/explore-golden';
import {loadGoldenWorld, localWorldEnv, runGoldenCase, scoreGolden} from './support/explore-golden-run';
import {costOf, createBudget, isBudgetError, parseCapUsd, withBudget} from './support/eval-budget';
import {runGrader} from './support/eval-grader';
import {assertLocalPostgres, assertLocalSupabase} from './support/local-only';

const env = process.env as Record<string, string | undefined>;
const wanted = env.CHAT_EXPLORE_LIVE_EVAL === '1';
if (wanted) {
  assertLocalPostgres(env.EXPLORE_DATABASE_URL); // before any client exists: a hosted database is never evaluated
  assertLocalSupabase(env.SB_LOCAL_URL);
}
const problemsToRun = wanted ? [!env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY is not set', !localWorldEnv(env) && 'the local env is not loaded (source scripts/local-supabase/.local-env)'].filter(Boolean) : [];

const MODEL_ID = env.CHAT_LIVE_MODEL ?? COOP_CHAT.model;
const EFFORT = (env.CHAT_LIVE_EFFORT ?? CHAT_EFFORT) as ChatEffort;
const CAP_USD = Math.min(parseCapUsd(env.CHAT_EXPLORE_BUDGET ?? '1.2'), parseCapUsd(env.CHAT_EVAL_BUDGET_USD ?? '1.2'));
const ONLY = (env.CHAT_LIVE_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

describe.skipIf(!wanted)('live Explore golden set: real model, local database only, budgeted', () => {
  it('is allowed to run (names only, no value is shown)', () => {
    expect(problemsToRun).toEqual([]);
    expect(CAP_USD).toBeGreaterThan(0);
  });

  it(`runs the live set (${LIVE_SET.length} questions, cap $${CAP_USD})`, async () => {
    if (problemsToRun.length || CAP_USD <= 0) throw new Error(`refusing to run: ${problemsToRun.join('; ') || 'the cap is 0 or below'}`);
    const world = await loadGoldenWorld(env);
    const expected = computeExpected(env) as VerifyContext['expected'];
    const budget = createBudget({capUsd: CAP_USD, model: MODEL_ID});
    const anthropic = new Anthropic({apiKey: env.ANTHROPIC_API_KEY});
    const client = withBudget(anthropic as unknown as MessagesClient, budget); // every step is guarded before it is sent and recorded after
    const rows: Record<string, unknown>[] = [];
    let failed = 0;
    for (const kase of LIVE_SET.filter((c) => ONLY.length === 0 || ONLY.includes(c.id))) {
      if (budget.exceeded()) {
        rows.push({id: kase.id, skipped: 'budget reached'});
        continue;
      }
      let o;
      try {
        o = await runGoldenCase({kase, world, client, model: MODEL_ID, effort: EFFORT});
      } catch (e) {
        if (isBudgetError(e)) {
          rows.push({id: kase.id, skipped: 'budget reached'});
          continue;
        }
        throw e;
      }
      const problems = scoreGolden(kase, o, expected, {strictText: false, lenientResults: true});
      const hard = problems.filter((p) => !p.startsWith('note: '));
      let grade: unknown = null;
      if (env.CHAT_LIVE_GRADER === '1' && !budget.exceeded()) {
        const g = await runGrader({create: (p) => anthropic.messages.create(p as never) as never, budget, model: MODEL_ID, question: kase.question, answer: o.text, results: o.results.map((r) => r.content), rubric: kase.rubric});
        grade = g.grade;
      }
      if (hard.length) failed += 1;
      rows.push({id: kase.id, ok: hard.length === 0, problems, steps: o.steps, calls: o.calls.map((c) => c.name), answer: o.text, grade, spentUsd: Number(budget.spentUsd().toFixed(4))});
      console.log(`${hard.length === 0 ? 'PASS' : 'FAIL'} ${kase.id} steps=${o.steps} spent=$${budget.spentUsd().toFixed(3)} ${problems.join(' | ')}`);
    }
    const out = env.CHAT_LIVE_OUT;
    if (out) {
      mkdirSync(path.dirname(out), {recursive: true});
      writeFileSync(out, JSON.stringify({model: MODEL_ID, capUsd: CAP_USD, spentUsd: budget.spentUsd(), totals: budget.totals(), costCheck: costOf(budget.totals(), MODEL_ID), rows}, null, 2));
    }
    expect(failed).toBe(0);
  }, 600_000);
});
