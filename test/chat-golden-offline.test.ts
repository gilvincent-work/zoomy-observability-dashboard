import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {LOCAL_HOSTS, assertLocalRun, majority, renderTable, type LiveRun, type RunCase} from '../scripts/chat-eval.mjs';
import {BASE_SPEC, GOLDEN_CASES, GOLDEN_DIGEST, goldenData, mechanicalFailures, parseVerdict, rubricPrompt, type GoldenCase} from './support/golden-cases';
import {runScripted, type RunResult} from './support/scripted-model';
import {EVAL_NOW} from './support/skill-eval-fixtures';

async function run(c: GoldenCase): Promise<RunResult> {
  return runScripted({
    script: c.script, messages: [...(c.prior ?? []), {role: 'user', content: c.prompt}], data: goldenData(), now: EVAL_NOW,
    report: c.startReport ?? null, digest: GOLDEN_DIGEST,
  });
}

describe('golden set, offline', () => {
  it('has 25 cases, unique ids, in the documented categories', () => {
    expect(GOLDEN_CASES).toHaveLength(25);
    expect(new Set(GOLDEN_CASES.map((c) => c.id)).size).toBe(25);
    const by = (k: string) => GOLDEN_CASES.filter((c) => c.category === k).length;
    expect({data: by('data'), lookup: by('lookup'), dashboard: by('dashboard'), multiturn: by('multiturn'), negative: by('negative')}).toEqual({data: 11, lookup: 2, dashboard: 3, multiturn: 4, negative: 5});
  });

  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))('%s: the scripted run meets every mechanical expectation', async (_id, c) => {
    const r = await run(c);
    expect(r.errors, 'no guard trip, no error line').toEqual([]);
    expect(r.events.some((e) => e.t === 'error')).toBe(false);
    expect(r.events.at(-1)).toMatchObject({t: 'done'});
    expect(r.results.filter((x) => x.is_error), 'a scripted call was refused').toEqual([]);
    expect(r.info.filter((l) => l.event === 'chat_number_violation'), 'a scripted answer displayed an invented figure').toEqual([]);
    const failures = mechanicalFailures(c, {calls: r.modelCalls, text: r.text, blocks: r.blocks, finalSpec: r.finalSpec, requests: r.client.requests});
    expect(failures).toEqual([]);
  });

  it('every case has rubric items, skill steps and a model script that ends the turn with text', () => {
    for (const c of GOLDEN_CASES) {
      expect(c.rubric.length, c.id).toBeGreaterThan(0);
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      expect(Array.isArray(c.script) && c.script.at(-1)?.text, c.id).toBeTruthy();
    }
  });

  it('the multi-turn cases start from the hand-written bundle dashboard and carry its history', () => {
    for (const c of GOLDEN_CASES.filter((x) => x.category === 'multiturn')) {
      expect(c.startReport).toBe(BASE_SPEC);
      expect(c.prior?.length).toBe(2);
    }
  });

  it('the order gate: a render call before any text is nudged once, and the checker reports it', async () => {
    const c = GOLDEN_CASES.find((x) => x.id === 'turn_make_it_a_pie') as GoldenCase;
    const r = await runScripted({
      script: [{calls: [{name: 'render_chart', input: {block: 'b5', source: 'b5', kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: 'T'}}]}, {text: 'Switching to a pie.', calls: [{name: 'render_chart', input: {block: 'b5', source: 'b5', kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: 'T'}}]}, {text: 'Done.'}],
      messages: [{role: 'user', content: c.prompt}], data: goldenData(), report: BASE_SPEC,
    });
    expect(r.results[0].is_error).toBe(true);
    const failures = mechanicalFailures(c, {calls: r.modelCalls, text: r.text, blocks: r.blocks, finalSpec: r.finalSpec, requests: r.client.requests});
    expect(failures.join(' ')).toMatch(/order gate/);
  });
});

// The checker must be able to fail: each kind of expectation is shown to trip on a wrong observation.
describe('mechanicalFailures can fail', () => {
  const base = GOLDEN_CASES.find((x) => x.id === 'bundle_dashboard') as GoldenCase;
  const ok = {calls: [] as {name: string; input: unknown}[], text: 'x', blocks: [], finalSpec: null, requests: []};

  it('missing and forbidden tools, call counts and partial inputs', () => {
    const f = mechanicalFailures({...base, blocks: undefined, chartForm: undefined, kind: undefined, captionFirst: false, finalSpec: undefined}, {...ok, calls: [{name: 'query_metric', input: {metric: 'bundle_sales', dimension: 'none'}}]});
    expect(f.length).toBeGreaterThanOrEqual(7); // the two other queries, 4 tiles minus none, chart and table are all missing
    const t = GOLDEN_CASES.find((x) => x.id === 'traffic_mock') as GoldenCase;
    expect(mechanicalFailures(t, {...ok, text: 'sample data', calls: [{name: 'describe_data', input: {}}, {name: 'query_metric', input: {}}]})).toEqual(['forbidden tool query_metric was called']);
    const q = GOLDEN_CASES.find((x) => x.id === 'top_products') as GoldenCase;
    expect(mechanicalFailures(q, {...ok, calls: [{name: 'query_metric', input: {metric: 'top_products', limit: 10}}]}).join()).toMatch(/missing call/);
  });

  it('noTools, block counts, text rules and the spec comparison', () => {
    const neg = GOLDEN_CASES.find((x) => x.id === 'neg_change_price') as GoldenCase;
    expect(mechanicalFailures(neg, {...ok, text: 'I have updated the price. Done.', calls: [{name: 'update_price', input: {}}]}).join('|')).toMatch(/called tools: update_price.*text matches/);
    expect(mechanicalFailures({...base, expectTools: [], captionFirst: false, finalSpec: undefined}, {...ok, text: 'x'}).join('|')).toMatch(/blocks\.kpi is 0, want 4/);
    const pie = GOLDEN_CASES.find((x) => x.id === 'turn_make_it_a_pie') as GoldenCase;
    expect(mechanicalFailures({...pie, expectTools: [], blocks: undefined, chartForm: undefined, captionFirst: false}, {...ok, finalSpec: BASE_SPEC})).toEqual(['the final report spec differs from the expected spec']);
  });
});

// ---- the live harness, checked offline (nothing here touches a network, a key or a database) -------------------------------------

describe('live eval safety and plumbing (offline)', () => {
  const ok = {CHAT_LIVE_EVAL: '1', SUPABASE_URL_ARCHIVE: 'http://127.0.0.1:54420', SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'k', ANTHROPIC_API_KEY: 'k'};

  it('assertLocalRun accepts only loopback hosts and never echoes a URL', () => {
    expect(LOCAL_HOSTS).toEqual(['127.0.0.1', 'localhost']);
    expect(assertLocalRun(ok)).toEqual({ok: true, problems: []});
    expect(assertLocalRun({...ok, SUPABASE_URL_ARCHIVE: 'http://localhost:54420'}).ok).toBe(true);
    for (const url of ['https://abcdefgh.supabase.co', 'http://127.0.0.1.evil.example', 'http://10.0.0.5:54420', 'not a url', '']) {
      const r = assertLocalRun({...ok, SUPABASE_URL_ARCHIVE: url});
      expect(r.ok, url).toBe(false);
      expect(JSON.stringify(r.problems), url).not.toMatch(/supabase\.co|evil|10\.0\.0|abcdefgh/);
    }
  });

  it('refuses without the opt-in flag or a key, and without the service key unless the data is synthetic', () => {
    expect(assertLocalRun({...ok, CHAT_LIVE_EVAL: undefined}).problems.join()).toMatch(/CHAT_LIVE_EVAL/);
    expect(assertLocalRun({...ok, ANTHROPIC_API_KEY: undefined}).problems.join()).toMatch(/ANTHROPIC_API_KEY/);
    expect(assertLocalRun({...ok, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: undefined}).ok).toBe(false);
    expect(assertLocalRun({...ok, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: undefined, CHAT_LIVE_DATA: 'synthetic'}).ok).toBe(true);
  });

  it('the live test file is opt-in, gated on the same guard, reads no .env and prints no environment value', () => {
    const src = readFileSync('test/chat-live-golden.integration.test.ts', 'utf8');
    expect(src).toMatch(/describe\.skipIf\(!wanted\)/);
    expect(src).toMatch(/const wanted = env\.CHAT_LIVE_EVAL === '1'/);
    expect(src).toMatch(/assertLocalRun\(env\)/);
    expect(src).toMatch(/refusing to run/);
    expect(src).not.toMatch(/\.env['"`]|dotenv|loadEnvFile/);
    expect(src).not.toMatch(/console\.(log|error|info)\([^)]*\benv\b/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/); // a read-only harness
    const runner = readFileSync('scripts/chat-eval.mjs', 'utf8');
    expect(runner).toMatch(/process\.exit\(2\)/);
    expect(runner).not.toMatch(/\.env['"`]|dotenv|loadEnvFile/);
  });

  it('the grader prompt carries the question, the shortened data, the answer without hidden tags and numbered checks; the verdict parser is strict', () => {
    const p = rubricPrompt('How are we?', 'Fine.<suggest>More? | Less?</suggest>', [{rows: [{a: 1}, {a: 2}, {a: 3}]}], ['It is brief.', 'It is kind.'], 20);
    expect(p).toContain("Owner's question: How are we?");
    expect(p).toContain('first 20 characters');
    expect(p).toContain('Answer:\nFine.');
    expect(p).not.toContain('suggest');
    expect(p).toMatch(/1\. It is brief\.\n2\. It is kind\./);
    expect(parseVerdict('Here you go: {"items":[{"pass":true,"why":"x"},{"pass":false,"why":"y"}]}', 2)).toEqual([true, false]);
    expect(parseVerdict('{"items":[{"pass":true}]}', 2)).toBeNull(); // wrong count: ungraded, which the harness counts as a fail
    expect(parseVerdict('no json', 1)).toBeNull();
    expect(parseVerdict('{"items":[{"pass":"yes"}]}', 1)).toEqual([false]); // only a literal true passes
  });

  const mk = (id: string, mech: boolean, rubric: boolean[] | null, over: Partial<RunCase> = {}): RunCase => ({id, kind: 'golden', category: 'data', steps: ['THINK-03'], mech, failures: mech ? [] : ['missing call'], rubric, ...over});
  const run = (cases: RunCase[], over: Partial<LiveRun> = {}): LiveRun => ({model: 'm', effort: 'medium', cases, chain: {mech: true, failures: []}, guard: {attemptedNonRead: 0, trips: 0, unknownTools: 0}, errors: 0, totalCost: 1, ...over});

  it('majority: a case passes with 2 of 3, fails with 1 of 3; a rubric item needs a majority of graded runs; the chain needs every run', () => {
    const s = majority([
      run([mk('a', true, [true, true]), mk('b', true, [true, false])]),
      run([mk('a', true, [true, false]), mk('b', false, [true, false])]),
      run([mk('a', false, [true, false]), mk('b', false, [true, false])], {chain: {mech: false, failures: ['spec differs']}}),
    ]);
    expect(s.cases.find((c) => c.id === 'a')).toMatchObject({mech: true, mechPasses: 2, rubric: [true, false]});
    expect(s.cases.find((c) => c.id === 'b')).toMatchObject({mech: false, mechPasses: 1, rubric: [true, false]});
    expect(s.chain).toMatchObject({pass: false, passes: 2, of: 3});
    expect(s.mech).toEqual({passed: 1, total: 3});
    expect(s.rubric).toEqual({passed: 2, total: 4});
    expect(s.steps['THINK-03']).toMatchObject({cases: 2, mech: 1});
    expect(s.ok).toBe(false);
    expect(s.totalCost).toBe(3);
  });

  it('a clean set of runs is ok; any guard trip, non-read attempt, unknown tool name or error makes it not ok', () => {
    const clean = [run([mk('a', true, [true])]), run([mk('a', true, [true])]), run([mk('a', true, [true])])];
    expect(majority(clean).ok).toBe(true);
    for (const guard of [{attemptedNonRead: 1, trips: 0, unknownTools: 0}, {attemptedNonRead: 0, trips: 1, unknownTools: 0}, {attemptedNonRead: 0, trips: 0, unknownTools: 1}]) {
      expect(majority([...clean.slice(0, 2), run([mk('a', true, [true])], {guard})]).ok).toBe(false);
    }
    expect(majority([...clean.slice(0, 2), run([mk('a', true, [true])], {errors: 1})]).ok).toBe(false);
    // wording below the 90% bar fails even when every mechanical case passes
    const wordy = [run([mk('a', true, [true, false])]), run([mk('a', true, [true, false])]), run([mk('a', true, [true, false])])];
    expect(majority(wordy).ok).toBe(false);
  });

  it('renderTable prints one line per case, one per skill step and the verdict', () => {
    const lines = renderTable(majority([run([mk('top_products', true, [true]), mk('x', false, [false], {steps: ['BI-02']})])]));
    const text = lines.join('\n');
    expect(text).toMatch(/^Model m \(effort medium\), 1 run\(s\)/);
    expect(text).toMatch(/top_products\s+golden\s+pass \(1\/1\)\s+1\/1/);
    expect(text).toMatch(/x\s+golden\s+FAIL \(0\/1\)\s+0\/1\s+missing call/);
    expect(text).toMatch(/BI-02\s+1\s+0\/1/);
    expect(text).toMatch(/multi-turn chain \(exact spec\)\s+pass \(1\/1\)/);
    expect(text).toMatch(/RESULT: FAIL/);
  });
});
