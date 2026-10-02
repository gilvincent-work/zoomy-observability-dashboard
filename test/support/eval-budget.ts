// The spend guard for the Ask Coop LIVE evals (owner request after the 2026-10-02 caching review: the live suite probably drained the
// Anthropic account). PURE and offline: a price table, a budget that records the usage of every model call, and a client wrapper that
// refuses the next call once the cap is reached. Wired into test/chat-live-golden.integration.test.ts, test/chat-live-skill.integration.test.ts
// and (through the cap it hands each run) scripts/chat-eval.mjs. Unit tests: test/eval-budget.test.ts.
//
// The cap and the tier names are parsed by scripts/chat-eval.mjs (one implementation, shared with the runner).
import type {MessagesClient, MessageStreamLike} from '../../src/chat/loop';
import {DEFAULT_BUDGET_USD, parseCapUsd, parseTier, type EvalTier} from '../../scripts/chat-eval.mjs';

export {DEFAULT_BUDGET_USD, parseCapUsd, parseTier};
export type {EvalTier};

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** $ per 1M tokens. */
export interface Price {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

// ---- the price table: THE ONE PLACE TO EDIT --------------------------------------------------------------------------------------
// Source: https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-02), 5-minute cache writes (the harness never asks for 1h).
// Cache reads are 0.1x the base input price, EXCEPT Opus 5.5 (0.05x, so $0.20 and not $0.40).
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-sonnet-5-5': {in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5},
  'claude-opus-5-5': {in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5},
  'claude-haiku-4-5': {in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25},
};
/** Short names used by CHAT_LIVE_MODEL, mapped to a PRICES key. A dated id such as claude-haiku-4-5-20251001 matches its PRICES key by prefix. */
export const ALIASES: Readonly<Record<string, string>> = {'sonnet-5-5': 'claude-sonnet-5-5', 'opus-5-5': 'claude-opus-5-5', 'haiku-4-5': 'claude-haiku-4-5'};
/** The model used when a model is not in PRICES. */
export const FALLBACK_MODEL = 'claude-sonnet-5-5';
/** unknown: budget uses the Sonnet rates x2 (an over-estimate on purpose: the cap must hold for a model nobody priced). */
export const UNKNOWN_MULTIPLIER = 2;

/** The rates for a model id or alias, and whether they are listed (an unlisted model is priced at the Sonnet rates x2). */
export function priceFor(model: string): {price: Price; known: boolean} {
  const key = (Object.hasOwn(ALIASES, model) ? ALIASES[model] : undefined) ?? Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  if (key) return {price: PRICES[key], known: true};
  const base = PRICES[FALLBACK_MODEL];
  return {price: {in: base.in * UNKNOWN_MULTIPLIER, out: base.out * UNKNOWN_MULTIPLIER, cacheRead: base.cacheRead * UNKNOWN_MULTIPLIER, cacheWrite: base.cacheWrite * UNKNOWN_MULTIPLIER}, known: false};
}

/** Dollars for one usage at a model's rates. */
export function costOf(u: Usage, model: string): number {
  const {price: p} = priceFor(model);
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
}

export const zeroUsage = (): Usage => ({input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
export const addUsage = (a: Usage, b: Usage): Usage => ({input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite});
/** cacheRead / (cacheRead + cacheWrite + input), or null when there is nothing to divide. */
export function cacheHitRatio(u: Usage): number | null {
  const d = u.cacheRead + u.cacheWrite + u.input;
  return d === 0 ? null : u.cacheRead / d;
}

/** The Messages API usage block (any object with its token fields) as the budget counts it. */
export interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
export function usageOf(u: ApiUsage | undefined | null): Usage {
  return {input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0, cacheWrite: u?.cache_creation_input_tokens ?? 0};
}

// ---- the budget ------------------------------------------------------------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}
export const isBudgetError = (e: unknown): e is BudgetExceededError => e instanceof BudgetExceededError;

const fmt = (n: number): string => n.toFixed(n === 0 || Math.abs(n) >= 0.01 ? 2 : 4);

export interface Budget {
  readonly capUsd: number;
  /** The chat model the budget prices by default; `record` can price a call by another model (a cheaper grader). */
  readonly model: string;
  /** False when the default model is not in the price table (it is then priced at the Sonnet rates x2). */
  readonly priceKnown: boolean;
  /** Adds one call's usage at the model's rates and returns the dollars it cost. */
  record(usage: Usage, model?: string): number;
  spentUsd(): number;
  remainingUsd(): number;
  /** True once the spend has reached the cap. A cap of 0 or below is exceeded from the start: it means refuse to run. */
  exceeded(): boolean;
  /** Throws Error('eval budget exceeded: $X of $Y') when exceeded. Call it BEFORE every model call. */
  guard(): void;
  /** The tokens recorded so far. */
  totals(): Usage;
}

/** `capUsd` goes through parseCapUsd: missing or invalid becomes the default (CHAT_EVAL_BUDGET_USD default 3), 0 or negative refuses to run. */
export function createBudget(opts: {capUsd?: number | string | null; model: string}): Budget {
  const capUsd = parseCapUsd(opts.capUsd ?? undefined);
  let spent = 0;
  let totals = zeroUsage();
  return {
    capUsd,
    model: opts.model,
    priceKnown: priceFor(opts.model).known,
    record(usage, model) {
      const dollars = costOf(usage, model ?? opts.model);
      spent += dollars;
      totals = addUsage(totals, usage);
      return dollars;
    },
    spentUsd: () => spent,
    remainingUsd: () => Math.max(0, capUsd - spent),
    exceeded: () => spent >= capUsd,
    guard() {
      if (spent >= capUsd) throw new BudgetExceededError(`eval budget exceeded: $${fmt(spent)} of $${fmt(capUsd)}`);
    },
    totals: () => ({...totals}),
  };
}

/**
 * Wraps a chat client so EVERY step the loop sends is guarded before it goes out and recorded when it finishes (priced by the model the
 * request names). The chat loop catches errors thrown by `stream`, so a refused step ends that turn with an error event: callers check
 * `budget.exceeded()` after a turn and call `guard()` again to stop the whole run.
 */
export function withBudget(client: MessagesClient, budget: Budget): MessagesClient {
  return {
    messages: {
      stream: (params, options) => {
        budget.guard();
        const stream = client.messages.stream(params, options);
        const wrapped: MessageStreamLike = {
          [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
          finalMessage: async () => {
            const msg = await stream.finalMessage();
            budget.record(usageOf(msg.usage), params.model);
            return msg;
          },
        };
        return wrapped;
      },
    },
  };
}

// ---- tiers (CHAT_EVAL_TIER) -----------------------------------------------------------------------------------------------------

/** The skill-behavior cases the SMOKE tier of the skill live test runs (one cheap case per kind of rule); the full and majority tiers run all 12. */
export const SKILL_SMOKE_IDS: readonly string[] = ['failed_reconciliation', 'narrow_question', 'no_causal_words'];

/** Does this tier run a case? smoke = the flagged cases only; full and majority = every case (the runner repeats only failed cases in majority). */
export const inTier = (tier: EvalTier, flaggedSmoke: boolean): boolean => tier !== 'smoke' || flaggedSmoke;
