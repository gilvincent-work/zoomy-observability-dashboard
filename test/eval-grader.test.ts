import {describe, expect, it, vi} from 'vitest';
import {createBudget} from './support/eval-budget';
import {GRADER_MAX_TOKENS, graderShape, interpretGrade, runGrader, type GraderCreate} from './support/eval-grader';

vi.mock('server-only', () => ({}));

const GOOD = '{"items":[{"pass":true,"why":"x"},{"pass":false,"why":"y"}]}';
const reply = (text: string, stop: string | null = 'end_turn', usage = {input_tokens: 2800, output_tokens: 250, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}) => ({content: [{type: 'text', text}], stop_reason: stop, usage});
const ask = (create: GraderCreate, over: Partial<{model: string; capUsd: number}> = {}) => {
  const budget = createBudget({capUsd: over.capUsd ?? 3, model: 'claude-sonnet-5-5'});
  return {budget, run: () => runGrader({create, budget, model: over.model ?? 'claude-sonnet-5-5', question: 'q', answer: 'a', results: [], rubric: ['one', 'two']})};
};

describe('graderShape: the cheapest request each model accepts (docs checked 2026-10-02)', () => {
  it('Sonnet 5.5 rejects thinking disabled (400), so it gets between_tools at effort low', () => {
    const s = graderShape('claude-sonnet-5-5');
    expect(s.thinking).toEqual({type: 'between_tools'});
    expect(s.output_config).toEqual({effort: 'low'});
  });

  it('Opus 5.5 always thinks and rejects disabled: effort low, no thinking field', () => {
    const s = graderShape('claude-opus-5-5');
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toEqual({effort: 'low'});
  });

  it('Haiku 4.5 gets thinking disabled and NO effort (the parameter is not supported there)', () => {
    for (const m of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
      const s = graderShape(m);
      expect(s.thinking).toEqual({type: 'disabled'});
      expect(s.output_config).toBeUndefined();
    }
  });

  it('an unlisted model gets neither field (the safe shape) and a note saying so', () => {
    const s = graderShape('claude-future-9');
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toBeUndefined();
    expect(s.note).toMatch(/not in the grader table/);
  });

  it('never sends thinking disabled to a model that rejects it', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5']) expect(graderShape(m).thinking).not.toEqual({type: 'disabled'});
  });
});

describe('interpretGrade: UNGRADED is not FAIL', () => {
  it('a readable verdict is graded', () => {
    expect(interpretGrade({text: GOOD, stopReason: 'end_turn'}, 2)).toEqual({state: 'graded', verdict: [true, false]});
  });

  it('a reply cut at max_tokens is ungraded even when the JSON happens to parse', () => {
    expect(interpretGrade({text: GOOD, stopReason: 'max_tokens'}, 2)).toMatchObject({state: 'ungraded'});
  });

  it('truncated, missing, wrong-count or invalid JSON is ungraded', () => {
    for (const text of ['{"items":[{"pass":true,"why":"x"},{"pass":fa', '', 'no json', '{"items":[{"pass":true}]}', '{"items": oops}']) {
      expect(interpretGrade({text, stopReason: 'end_turn'}, 2), text).toMatchObject({state: 'ungraded'});
    }
  });
});

describe('runGrader', () => {
  it('sends a generous max_tokens, the cheap thinking shape and the grader model, then records the usage', async () => {
    const create = vi.fn<GraderCreate>(async () => reply(GOOD));
    const {budget, run} = ask(create);
    const out = await run();
    expect(out.grade).toEqual({state: 'graded', verdict: [true, false]});
    const p = create.mock.calls[0][0];
    expect(p.max_tokens).toBe(GRADER_MAX_TOKENS);
    expect(GRADER_MAX_TOKENS).toBeGreaterThanOrEqual(2000);
    expect(p.thinking).toEqual({type: 'between_tools'});
    expect(p.output_config).toEqual({effort: 'low'});
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(Object.keys(p)).not.toContain('note');
    expect(out.usage).toEqual({input: 2800, output: 250, cacheRead: 0, cacheWrite: 0});
    expect(out.cost).toBeCloseTo((2800 * 2 + 250 * 10) / 1e6, 10);
    expect(budget.spentUsd()).toBeCloseTo(out.cost, 10);
  });

  it('prices a Haiku grader at Haiku rates and sends no effort', async () => {
    const create = vi.fn<GraderCreate>(async () => reply(GOOD));
    const {budget, run} = ask(create, {model: 'claude-haiku-4-5-20251001'});
    const out = await run();
    expect(out.cost).toBeCloseTo((2800 * 1 + 250 * 5) / 1e6, 10);
    expect(budget.spentUsd()).toBeCloseTo(out.cost, 10);
    expect(create.mock.calls[0][0]).toMatchObject({thinking: {type: 'disabled'}});
    expect(create.mock.calls[0][0].output_config).toBeUndefined();
  });

  it('a truncated or unreadable reply is UNGRADED but still costs (its usage is recorded)', async () => {
    const {budget, run} = ask(async () => reply('{"items":[{"pass":tr', 'max_tokens', {input_tokens: 2800, output_tokens: 2500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0}));
    const out = await run();
    expect(out.grade).toMatchObject({state: 'ungraded'});
    expect(budget.spentUsd()).toBeGreaterThan(0.02);
  });

  it('an API error is UNGRADED, not a FAIL, and costs nothing', async () => {
    const {budget, run} = ask(async () => {
      throw Object.assign(new Error('boom'), {status: 529});
    });
    const out = await run();
    expect(out.grade).toEqual({state: 'ungraded', reason: 'the grader call failed (HTTP 529)'});
    expect(budget.spentUsd()).toBe(0);
  });

  it('refuses BEFORE the call when the budget is exhausted, and never swallows that', async () => {
    const create = vi.fn<GraderCreate>(async () => reply(GOOD));
    const {run} = ask(create, {capUsd: 0});
    await expect(run()).rejects.toThrow(/eval budget exceeded/);
    expect(create).not.toHaveBeenCalled();
  });
});
