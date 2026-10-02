import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import type {MessagesClient} from '../src/chat/loop';
import {PLANNED} from '../scripts/chat-eval.mjs';
import {CHAIN, GOLDEN_CASES, READ_ONLY_PROBES} from './support/golden-cases';
import {
  ALIASES, BudgetExceededError, DEFAULT_BUDGET_USD, PRICES, SKILL_SMOKE_IDS, UNKNOWN_MULTIPLIER, cacheHitRatio, costOf, createBudget, inTier, isBudgetError, parseCapUsd, parseTier, priceFor, usageOf, withBudget,
} from './support/eval-budget';
import {SKILL_CASES} from './support/skill-eval-fixtures';

vi.mock('server-only', () => ({}));

const MTOK = {input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6};

describe('the eval price table', () => {
  it('prices Sonnet 5.5 per the pricing page: $2 in, $2.50 cache write (5m), $0.20 cache read, $10 out', () => {
    expect(PRICES['claude-sonnet-5-5']).toEqual({in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5});
    expect(costOf({input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0}, 'claude-sonnet-5-5')).toBeCloseTo(2, 10);
    expect(costOf({input: 0, output: 1e6, cacheRead: 0, cacheWrite: 0}, 'claude-sonnet-5-5')).toBeCloseTo(10, 10);
    expect(costOf(MTOK, 'claude-sonnet-5-5')).toBeCloseTo(14.7, 10);
  });

  it('prices Opus 5.5 with its 0.05x cache read ($0.20) and Haiku 4.5 at $1/$5, also by alias and by dated id', () => {
    expect(priceFor('opus-5-5')).toEqual({price: {in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5}, known: true});
    expect(priceFor('claude-haiku-4-5-20251001')).toEqual({price: {in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25}, known: true});
    expect(priceFor('sonnet-5-5').known).toBe(true);
    expect(Object.keys(ALIASES).every((a) => priceFor(a).known)).toBe(true);
  });

  it('a model nobody priced is estimated at the Sonnet rates x2 and flagged unknown (never free)', () => {
    const u = priceFor('claude-future-9');
    expect(u.known).toBe(false);
    expect(UNKNOWN_MULTIPLIER).toBe(2);
    expect(u.price).toEqual({in: 4, out: 20, cacheRead: 0.4, cacheWrite: 5});
    expect(costOf(MTOK, 'claude-future-9')).toBeCloseTo(2 * 14.7, 10);
    expect(priceFor('toString').known).toBe(false); // an object-prototype name is just an unknown model
    expect(priceFor('claude-sonnet-5-50').known).toBe(false); // a prefix is matched only at a dash
  });

  it('usageOf maps the API usage block and tolerates a missing one', () => {
    expect(usageOf({input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8} as never)).toEqual({input: 5, output: 6, cacheRead: 7, cacheWrite: 8});
    expect(usageOf(undefined)).toEqual({input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
  });

  it('cache hit ratio is cacheRead / (cacheRead + cacheWrite + input)', () => {
    expect(cacheHitRatio({input: 100, output: 999, cacheRead: 800, cacheWrite: 100})).toBeCloseTo(0.8, 10);
    expect(cacheHitRatio({input: 0, output: 5, cacheRead: 0, cacheWrite: 0})).toBeNull();
  });
});

describe('parseCapUsd (CHAT_EVAL_BUDGET_USD)', () => {
  it('defaults to 3; a missing, blank or invalid value falls back to the default', () => {
    expect(DEFAULT_BUDGET_USD).toBe(3);
    for (const raw of [undefined, null, '', '   ', 'abc', 'NaN', 'Infinity', '$5', NaN, Infinity]) expect(parseCapUsd(raw), String(raw)).toBe(3);
  });

  it('accepts a positive number, and keeps 0 and negative (they mean refuse to run)', () => {
    expect(parseCapUsd('5')).toBe(5);
    expect(parseCapUsd(' 0.75 ')).toBe(0.75);
    expect(parseCapUsd(2)).toBe(2);
    expect(parseCapUsd('0')).toBe(0);
    expect(parseCapUsd('-1')).toBe(-1);
  });
});

describe('createBudget', () => {
  const sonnet = {input: 1000, output: 100, cacheRead: 13300, cacheWrite: 0};

  it('records dollars per call from the price table and tracks spent, remaining and totals', () => {
    const b = createBudget({capUsd: 3, model: 'claude-sonnet-5-5'});
    expect(b.capUsd).toBe(3);
    expect(b.priceKnown).toBe(true);
    const d = b.record(sonnet);
    expect(d).toBeCloseTo((1000 * 2 + 100 * 10 + 13300 * 0.2) / 1e6, 10);
    b.record(sonnet);
    expect(b.spentUsd()).toBeCloseTo(2 * d, 10);
    expect(b.remainingUsd()).toBeCloseTo(3 - 2 * d, 10);
    expect(b.totals()).toEqual({input: 2000, output: 200, cacheRead: 26600, cacheWrite: 0});
    expect(b.exceeded()).toBe(false);
    expect(() => b.guard()).not.toThrow();
  });

  it('can price one call by another model (a cheaper grader)', () => {
    const b = createBudget({capUsd: 3, model: 'claude-sonnet-5-5'});
    expect(b.record({input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0}, 'claude-haiku-4-5-20251001')).toBeCloseTo(1, 10);
    expect(b.spentUsd()).toBeCloseTo(1, 10);
  });

  it('is exceeded when the spend reaches the cap and guard() then throws a clear Error before the next call', () => {
    const b = createBudget({capUsd: 1, model: 'claude-sonnet-5-5'});
    b.record({input: 0, output: 99_999, cacheRead: 0, cacheWrite: 0}); // $0.99999
    expect(b.exceeded()).toBe(false);
    b.record({input: 0, output: 100, cacheRead: 0, cacheWrite: 0});
    expect(b.exceeded()).toBe(true);
    expect(b.remainingUsd()).toBe(0);
    expect(() => b.guard()).toThrow(/^eval budget exceeded: \$1\.00 of \$1\.00$/);
    try {
      b.guard();
    } catch (e) {
      expect(isBudgetError(e)).toBe(true);
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('a missing or invalid cap falls back to the default 3', () => {
    for (const capUsd of [undefined, null, '', 'abc', NaN]) expect(createBudget({capUsd, model: 'm'}).capUsd).toBe(3);
    expect(createBudget({capUsd: '4.5', model: 'm'}).capUsd).toBe(4.5);
  });

  it('a cap of 0 or below refuses to run: exceeded before the first call', () => {
    for (const capUsd of [0, -1, '0', '-2.5']) {
      const b = createBudget({capUsd, model: 'claude-sonnet-5-5'});
      expect(b.exceeded(), String(capUsd)).toBe(true);
      expect(() => b.guard(), String(capUsd)).toThrow(/eval budget exceeded: \$0\.00 of \$/);
    }
  });

  it('an unlisted model is flagged and priced at the Sonnet rates x2', () => {
    const b = createBudget({capUsd: 3, model: 'claude-future-9'});
    expect(b.priceKnown).toBe(false);
    expect(b.record({input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0})).toBeCloseTo(4, 10);
  });
});

describe('withBudget (every chat step is guarded before it is sent and recorded after)', () => {
  const fake = (usage: Record<string, number>) => {
    const sent: string[] = [];
    const client: MessagesClient = {
      messages: {
        stream: (params) => {
          sent.push(params.model);
          return {
            [Symbol.asyncIterator]: async function* () {
              // no events needed
            },
            finalMessage: async () => ({content: [], stop_reason: 'end_turn', usage}) as never,
          };
        },
      },
    };
    return {client, sent};
  };
  const params = (model: string) => ({model, max_tokens: 10, messages: []}) as never;

  it('records the usage of each finished step, priced by the model the request names', async () => {
    const {client} = fake({input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300});
    const budget = createBudget({capUsd: 3, model: 'claude-sonnet-5-5'});
    const wrapped = withBudget(client, budget);
    const stream = wrapped.messages.stream(params('claude-sonnet-5-5'));
    for await (const _ of stream) void _;
    await stream.finalMessage();
    expect(budget.spentUsd()).toBeCloseTo((1000 * 2 + 200 * 10 + 5000 * 0.2 + 300 * 2.5) / 1e6, 10);
    await wrapped.messages.stream(params('claude-opus-5-5')).finalMessage();
    expect(budget.totals()).toEqual({input: 2000, output: 400, cacheRead: 10000, cacheWrite: 600});
    expect(budget.spentUsd()).toBeCloseTo((1000 * 2 + 200 * 10 + 5000 * 0.2 + 300 * 2.5) / 1e6 + (1000 * 4 + 200 * 20 + 5000 * 0.2 + 300 * 5) / 1e6, 10);
  });

  it('refuses the next step once the cap is reached, without sending it', async () => {
    const {client, sent} = fake({input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}); // $10 per step
    const budget = createBudget({capUsd: 3, model: 'claude-sonnet-5-5'});
    const wrapped = withBudget(client, budget);
    await wrapped.messages.stream(params('claude-sonnet-5-5')).finalMessage();
    expect(sent).toHaveLength(1);
    expect(() => wrapped.messages.stream(params('claude-sonnet-5-5'))).toThrow(/eval budget exceeded: \$10\.00 of \$3\.00/);
    expect(sent).toHaveLength(1);
  });

  it('a cap of 0 refuses even the first step', () => {
    const {client, sent} = fake({});
    expect(() => withBudget(client, createBudget({capUsd: 0, model: 'm'})).messages.stream(params('m'))).toThrow(/eval budget exceeded/);
    expect(sent).toHaveLength(0);
  });
});

describe('the tiers and the smoke subset', () => {
  it('parseTier: smoke is the default, an unknown name falls back to smoke and is flagged', () => {
    expect(parseTier(undefined)).toEqual({tier: 'smoke', valid: true});
    expect(parseTier('')).toEqual({tier: 'smoke', valid: true});
    expect(parseTier('FULL')).toEqual({tier: 'full', valid: true});
    expect(parseTier('majority')).toEqual({tier: 'majority', valid: true});
    expect(parseTier('everything')).toEqual({tier: 'smoke', valid: false});
  });

  const smoke = GOLDEN_CASES.filter((c) => c.smoke === true);

  it('the smoke subset is 8 to 10 golden cases and covers every category at least once', () => {
    expect(smoke.length).toBeGreaterThanOrEqual(8);
    expect(smoke.length).toBeLessThanOrEqual(10);
    const all = new Set(GOLDEN_CASES.map((c) => c.category));
    expect(all.size).toBe(6);
    expect(new Set(smoke.map((c) => c.category))).toEqual(all);
  });

  it('the smoke subset carries the owner rules: ask first, chart-first, the weekly online/offline series, a read-only negative, a multi-turn follow-up', () => {
    const ids = smoke.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['ask_sales', 'ask_weekly_online_offline', 'bundle_dashboard', 'weekly_online_offline', 'neg_change_price', 'turn_make_it_a_pie']));
    expect(smoke.find((c) => c.id === 'bundle_dashboard')?.captionFirst).toBe(true); // chart-first / caption-first (DASH-01)
    expect(smoke.find((c) => c.id === 'weekly_online_offline')?.kind).toBe('line');
    expect(smoke.find((c) => c.id === 'turn_make_it_a_pie')?.prior?.length).toBeGreaterThan(0); // a follow-up turn
    expect(smoke.filter((c) => c.category === 'negative').every((c) => c.noTools === true)).toBe(true); // read-only: no tool at all
  });

  it('the runner knows how many model loops each tier is (pinned to the data)', () => {
    expect(PLANNED.smoke).toBe(smoke.length);
    expect(PLANNED.full).toBe(GOLDEN_CASES.length + READ_ONLY_PROBES.length + SKILL_CASES.length + (CHAIN.length - 1)); // the chain's first turn is replayed offline
  });

  it('inTier: smoke runs flagged cases only; full and majority run everything', () => {
    expect(inTier('smoke', true)).toBe(true);
    expect(inTier('smoke', false)).toBe(false);
    expect(inTier('full', false)).toBe(true);
    expect(inTier('majority', false)).toBe(true);
  });

  it('the skill smoke ids exist', () => {
    const ids = SKILL_CASES.map((c) => c.id);
    for (const id of SKILL_SMOKE_IDS) expect(ids).toContain(id);
  });
});

describe('the live files are wired to the budget (source scan, nothing is run)', () => {
  const golden = readFileSync('test/chat-live-golden.integration.test.ts', 'utf8');
  const skill = readFileSync('test/chat-live-skill.integration.test.ts', 'utf8');

  it('both build a budget, wrap the chat client with it and refuse a cap of 0 or below', () => {
    for (const [name, src] of [['golden', golden], ['skill', skill]] as const) {
      expect(src, name).toMatch(/createBudget\(/);
      expect(src, name).toMatch(/withBudget\(/);
      expect(src, name).toMatch(/CAP_USD <= 0/);
      expect(src, name).toMatch(/budget\.guard\(\)/);
      expect(src, name).not.toMatch(/await sleep|setTimeout\(|Promise\.all\(/); // back to back, no fan-out: the prompt cache stays warm
    }
  });

  it('the only direct Messages call is the grader, and it goes through runGrader (guard + record)', () => {
    expect(golden.match(/messages\.create\(/g)).toHaveLength(1);
    expect(golden).toMatch(/runGrader\(/);
    expect(skill).not.toMatch(/messages\.create\(/);
  });

  it('the golden file still refuses a non-loopback Supabase through the shared helpers', () => {
    expect(golden).toMatch(/assertLocalSupabase\(env\.SUPABASE_URL_ARCHIVE\)/);
    expect(golden).toMatch(/assertLocalRun\(env\)/);
    expect(readFileSync('scripts/chat-eval.mjs', 'utf8')).toMatch(/isLocalSupabaseUrl\(raw\)/);
  });
});
