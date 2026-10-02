import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {AVG_TURN_USD, PLANNED, caseOutcome, failedSelectors, majority, planCheck, plannedRuns, renderTable, spendLines, type LiveRun, type RunCase} from '../scripts/chat-eval.mjs';

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({input, output, cacheRead, cacheWrite});
const mk = (id: string, mech: boolean, rubric: boolean[] | null, over: Partial<RunCase> = {}): RunCase => ({id, kind: 'golden', category: 'data', steps: ['THINK-03'], mech, failures: mech ? [] : ['missing call'], rubric, ...over});
const run = (cases: RunCase[], over: Partial<LiveRun> = {}): LiveRun => ({model: 'm', effort: 'medium', cases, chain: null, guard: {attemptedNonRead: 0, trips: 0, unknownTools: 0}, errors: 0, totalCost: 0.5, ...over});

describe('planCheck: the worst case is printed before the start and refused when it is over the cap', () => {
  it('smoke (the default) fits the default cap of $3: 9 loops x 1 run x $0.08', () => {
    const p = planCheck({});
    expect(p).toMatchObject({ok: true, tier: 'smoke', runs: 1, loops: PLANNED.smoke, capUsd: 3, problems: []});
    expect(p.worstCaseUsd).toBeCloseTo(PLANNED.smoke * AVG_TURN_USD, 10);
    expect(AVG_TURN_USD).toBe(0.08);
  });

  it('full and majority exceed the default cap and are refused (exit 2) unless the cap is raised or CHAT_EVAL_FORCE=1', () => {
    const full = planCheck({CHAT_EVAL_TIER: 'full'});
    expect(full.ok).toBe(false);
    expect(full.problems.join()).toMatch(/worst case \(\$4\.24\) exceeds the cap \(\$3\.00\)/);
    expect(planCheck({CHAT_EVAL_TIER: 'full', CHAT_EVAL_BUDGET_USD: '5'}).ok).toBe(true);
    expect(planCheck({CHAT_EVAL_TIER: 'full', CHAT_EVAL_FORCE: '1'}).ok).toBe(true);
    const maj = planCheck({CHAT_EVAL_TIER: 'majority'});
    expect(maj.runs).toBe(3);
    expect(maj.worstCaseUsd).toBeCloseTo(PLANNED.full * 3 * AVG_TURN_USD, 10);
    expect(maj.ok).toBe(false);
    expect(planCheck({CHAT_EVAL_TIER: 'majority', CHAT_EVAL_FORCE: '1'}).ok).toBe(true);
    expect(planCheck({CHAT_EVAL_TIER: 'full', CHAT_EVAL_FORCE: '0'}).ok).toBe(false); // only 1 forces
  });

  it('a cap of 0 or below refuses, even with FORCE; an invalid cap is the default', () => {
    for (const cap of ['0', '-1']) {
      const p = planCheck({CHAT_EVAL_BUDGET_USD: cap, CHAT_EVAL_FORCE: '1'});
      expect(p.ok, cap).toBe(false);
      expect(p.problems.join(), cap).toMatch(/refuse to run/);
    }
    expect(planCheck({CHAT_EVAL_BUDGET_USD: 'lots'})).toMatchObject({ok: true, capUsd: 3});
  });

  it('an unknown tier is refused rather than guessed', () => {
    const p = planCheck({CHAT_EVAL_TIER: 'everything'});
    expect(p.ok).toBe(false);
    expect(p.problems.join()).toMatch(/CHAT_EVAL_TIER must be one of smoke, full, majority/);
  });

  it('CHAT_LIVE_CASES sets the loop count (the chain is five live turns)', () => {
    expect(planCheck({CHAT_LIVE_CASES: 'a, b ,chain', CHAT_EVAL_TIER: 'full'}).loops).toBe(7);
  });

  it('only the majority tier repeats; CHAT_EVAL_RUNS sets how many (at least 2)', () => {
    expect(plannedRuns('smoke', {CHAT_EVAL_RUNS: '5'})).toBe(1);
    expect(plannedRuns('full', {})).toBe(1);
    expect(plannedRuns('majority', {})).toBe(3);
    expect(plannedRuns('majority', {CHAT_EVAL_RUNS: '5'})).toBe(5);
    expect(plannedRuns('majority', {CHAT_EVAL_RUNS: '1'})).toBe(2);
  });
});

describe('the majority tier re-runs only the cases that FAILED', () => {
  it('caseOutcome: PASS, FAIL (mechanical or a wording item), UNGRADED', () => {
    expect(caseOutcome(mk('a', true, [true, true]))).toBe('PASS');
    expect(caseOutcome(mk('a', true, null))).toBe('PASS');
    expect(caseOutcome(mk('a', false, null))).toBe('FAIL');
    expect(caseOutcome(mk('a', true, [true, false]))).toBe('FAIL');
    expect(caseOutcome(mk('a', true, null, {ungraded: true}))).toBe('UNGRADED');
  });

  it('failedSelectors lists failed cases (probes by their selector form, the chain as "chain"), never passes or ungraded', () => {
    const r = run([
      mk('ok', true, [true]), mk('bad', false, [true]), mk('words', true, [false]), mk('un', true, null, {ungraded: true}),
      mk('probe: Void order 123.', false, null, {kind: 'probe'}), mk('skill_x', false, null, {kind: 'skill'}),
    ], {chain: {mech: false, failures: ['spec differs']}});
    expect(failedSelectors(r)).toEqual(['bad', 'words', 'probe:Void order 123.', 'skill_x', 'chain']);
    expect(failedSelectors(run([mk('ok', true, [true])], {chain: {mech: true, failures: []}}))).toEqual([]);
  });

  it('a case with one run is voted on that one run; a re-run case needs 2 of 3', () => {
    const s = majority([
      run([mk('a', true, [true]), mk('b', false, [true]), mk('c', false, [true])]),
      run([mk('b', true, [true]), mk('c', false, [true])]),
      run([mk('b', true, [true]), mk('c', true, [true])]),
    ]);
    expect(s.cases.find((c) => c.id === 'a')).toMatchObject({mech: true, of: 1, outcome: 'PASS'});
    expect(s.cases.find((c) => c.id === 'b')).toMatchObject({mech: true, of: 3, mechPasses: 2, outcome: 'PASS'});
    expect(s.cases.find((c) => c.id === 'c')).toMatchObject({mech: false, of: 3, mechPasses: 1, outcome: 'FAIL'});
    expect(s.ok).toBe(false);
  });
});

describe('UNGRADED is reported apart and does not fail the result', () => {
  const ungraded = run([mk('a', true, [true]), mk('u', true, null, {ungraded: true})]);

  it('counts an ungraded case as UNGRADED, not FAIL, and leaves the result ok', () => {
    const s = majority([ungraded]);
    expect(s.ungraded).toBe(1);
    expect(s.cases.find((c) => c.id === 'u')).toMatchObject({mech: true, outcome: 'UNGRADED'});
    expect(s.rubric).toEqual({passed: 1, total: 1});
    expect(s.ok).toBe(true); // ungraded is neither a pass nor a fail of the result
  });

  it('prints it on its own line in the spend table', () => {
    const text = spendLines(majority([run([mk('a', true, [true]), mk('u', true, null, {ungraded: true})], {chain: {mech: true, failures: []}})])).join('\n');
    expect(text).toMatch(/^u\s+UNGRADED/m);
    expect(text).toMatch(/UNGRADED: 1 case\(s\) whose grader reply was truncated or unreadable/);
    expect(majority([run([mk('a', true, [true]), mk('u', true, null, {ungraded: true})], {chain: {mech: true, failures: []}})]).ok).toBe(true);
  });
});

describe('the spend table', () => {
  const cases = [
    mk('top_products', true, [true], {usage: usage(1000, 300, 13300, 0), cost: 0.0123}),
    mk('bad_one', false, null, {usage: usage(2000, 500, 0, 13300), cost: 0.0412, failures: ['no tool']}),
  ];
  const s = majority([run(cases, {totalCost: 0.0535, tier: 'smoke', usage: usage(3000, 800, 13300, 13300)})], {capUsd: 3});

  it('lists PASS / FAIL, runs used, tokens and dollars per case', () => {
    const text = spendLines(s).join('\n');
    expect(text).toMatch(/top_products\s+PASS\s+1\s+1000\/300\/13300\/0\s+\$0\.01/);
    expect(text).toMatch(/bad_one\s+FAIL\s+1\s+2000\/500\/0\/13300\s+\$0\.04/);
  });

  it('totals the spend against the cap and prints the cache hit ratio cacheRead / (cacheRead + cacheWrite + input)', () => {
    const text = spendLines(s).join('\n');
    expect(text).toMatch(/spent \$0\.05 of the \$3\.00 cap \(2%\), tier smoke/);
    expect(s.cacheHitRatio).toBeCloseTo(13300 / (13300 + 13300 + 3000), 10);
    expect(text).toMatch(/cache hit ratio: 44\.9%/);
  });

  it('renderTable carries it, keeps the RESULT line last, and flags a run the cap stopped', () => {
    const lines = renderTable(s);
    expect(lines.join('\n')).toMatch(/spend by case/);
    expect(lines[lines.length - 1]).toBe('RESULT: FAIL');
    const stopped = renderTable(majority([run([mk('a', true, [true])], {chain: {mech: true, failures: []}, budget: {capUsd: 1, spentUsd: 1.2, exceeded: true}})]));
    expect(stopped.join('\n')).toMatch(/BUDGET: the cap was reached/);
    expect(stopped[stopped.length - 1]).toBe('RESULT: FAIL');
  });

  it('cases without usage (an older run file) print zeros instead of crashing', () => {
    expect(spendLines(majority([run([mk('a', true, [true])])])).join('\n')).toMatch(/a\s+PASS\s+1\s+0\/0\/0\/0\s+\$0\.00/);
  });
});

describe('the runner source (nothing is run)', () => {
  const src = readFileSync('scripts/chat-eval.mjs', 'utf8');

  it('documents the three tiers, the cap, and the separate-workspace recommendation in its header', () => {
    const header = src.slice(0, src.indexOf('import {spawnSync}'));
    expect(header).toMatch(/SMOKE/);
    expect(header).toMatch(/FULL/);
    expect(header).toMatch(/MAJORITY/);
    expect(header).toMatch(/CHAT_EVAL_BUDGET_USD/);
    expect(header).toMatch(/CHAT_EVAL_FORCE=1/);
    expect(header).toMatch(/CHAT_GRADER_MODEL/);
    expect(header).toMatch(/claude-haiku-4-5-20251001/);
    expect(header).toMatch(/separate Anthropic workspace/);
    expect(header).toMatch(/spend limit/);
  });

  it('exits 2 on a refused plan and passes the tier and the REMAINING cap to every run', () => {
    expect(src).toMatch(/planCheck\(env\)/);
    expect(src.match(/process\.exit\(2\)/g)!.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/CHAT_EVAL_TIER: plan\.tier/);
    expect(src).toMatch(/CHAT_EVAL_BUDGET_USD: String\(remaining\)/);
    expect(src).toMatch(/failedSelectors\(run\)/);
  });
});
