import {describe, expect, it} from 'vitest';
import type {ReportSpec} from '../src/chat/report-types';
import {BASE_SPEC, CHAIN, CHAIN_FINAL_SPEC, goldenData} from './support/golden-cases';
import {runScripted, type RunResult} from './support/scripted-model';
import {EVAL_NOW} from './support/skill-eval-fixtures';

// F11, Slice 6 criterion 3: "Given the multi-turn bundle script, then the final spec equals the expected spec exactly."
// The script is design section 8: bundle dashboard -> "make it a pie" -> "only cats" -> "last month instead" -> "add top SKUs"
// -> "remove the KPIs". Each turn runs through the REAL loop and executors with the report the previous turn left open,
// exactly as the drawer sends it back. The expected spec is the literal CHAIN_FINAL_SPEC in test/support/golden-cases.ts,
// written by hand. The live variant (same script, real model) is in test/chat-live-golden.integration.test.ts.

async function runChain(chain = CHAIN): Promise<{turns: RunResult[]; specs: (ReportSpec | null)[]}> {
  const turns: RunResult[] = [];
  const specs: (ReportSpec | null)[] = [];
  let spec: ReportSpec | null = null;
  const history: {role: 'user' | 'assistant'; content: string}[] = [];
  for (const t of chain) {
    const r = await runScripted({script: t.script, messages: [...history, {role: 'user', content: t.prompt}], data: goldenData(), now: EVAL_NOW, report: spec});
    history.push({role: 'user', content: t.prompt}, {role: 'assistant', content: r.text});
    spec = r.finalSpec;
    turns.push(r);
    specs.push(spec);
  }
  return {turns, specs};
}
const blockJson = (s: ReportSpec | null) => Object.fromEntries((s?.blocks ?? []).map((b) => [b.id, JSON.stringify(b)]));

describe('the multi-turn bundle script', () => {
  it('ends on the expected spec EXACTLY', async () => {
    const {specs} = await runChain();
    expect(specs.at(-1)).toEqual(CHAIN_FINAL_SPEC);
  });

  it('every turn runs clean: no refused call, no error, no guard trip, no invented figure', async () => {
    const {turns} = await runChain();
    expect(turns).toHaveLength(6);
    for (const [i, r] of turns.entries()) {
      expect(r.results.filter((x) => x.is_error), `turn ${i + 1}`).toEqual([]);
      expect(r.errors, `turn ${i + 1}`).toEqual([]);
      expect(r.events.at(-1), `turn ${i + 1}`).toMatchObject({t: 'done'});
      expect(r.info.filter((l) => l.event === 'chat_number_violation'), `turn ${i + 1}`).toEqual([]);
    }
  });

  it('the first turn leaves the hand-written bundle dashboard, and the order gate never had to nudge', async () => {
    const {specs, turns} = await runChain();
    expect(specs[0]).toEqual(BASE_SPEC);
    expect(turns[0].client.requests.some((r) => r.includes('Nothing was drawn'))).toBe(false);
  });

  it('turn by turn: only what was asked changes, ids stay, no second copy appears', async () => {
    const {specs} = await runChain();
    const [, pie, cats, month, skus, final] = specs;
    const was = blockJson(specs[0]);
    // "make it a pie": b5 only (user mode); everything else byte-identical
    const afterPie = blockJson(pie);
    expect(afterPie.b5).not.toBe(was.b5);
    expect(JSON.parse(afterPie.b5)).toMatchObject({id: 'b5', view: {kind: 'pie', mode: 'user'}});
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b6']) expect(afterPie[id], id).toBe(was[id]);
    expect(pie?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
    // "only cats": the filters change once, the recipes do not
    expect(cats?.filters).toMatchObject({pet: 'cat', range: 'all_available'});
    expect(blockJson(cats)).toEqual(afterPie);
    // "last month instead": the pet stays cat
    expect(month?.filters).toMatchObject({pet: 'cat', range: 'last_month', from: '', to: ''});
    expect(blockJson(month)).toEqual(afterPie);
    // "add top SKUs": the next id, existing blocks untouched
    expect(skus?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) expect(blockJson(skus)[id], id).toBe(afterPie[id]);
    expect(skus?.blocks[6]).toMatchObject({id: 'b7', kind: 'table', query: {metric: 'top_products', limit: 5}});
    // "remove the KPIs": b1..b4 go, nothing is renumbered
    expect(final?.blocks.map((b) => b.id)).toEqual(['b5', 'b6', 'b7']);
  });

  it('the saved recipe never carries data', async () => {
    const {specs} = await runChain();
    expect(JSON.stringify(specs.at(-1))).not.toMatch(/"rows"|"data"|"values"|₱/);
  });

  it('exactness bites: a model that draws a second pie instead of editing the first, or filters the wrong pet, misses the spec', async () => {
    const copy = CHAIN.map((t, i) => (i === 1 ? {...t, script: [{text: 'A pie.', calls: [{name: 'render_chart', input: {block: 'new', source: 'b5', kind: 'pie', orientation: 'auto', x: 'auto', y: ['auto'], title: 'Pie'}}]}, {text: 'Done.'}]} : t));
    expect((await runChain(copy)).specs.at(-1)).not.toEqual(CHAIN_FINAL_SPEC);
    const dogs = CHAIN.map((t, i) => (i === 2 ? {...t, script: [{calls: [{name: 'set_report_filters', input: {range: 'keep', from: '', to: '', pet: 'dog', event: 'keep', channel: 'keep'}}]}, {text: 'Dogs.'}]} : t));
    expect((await runChain(dogs)).specs.at(-1)?.filters.pet).toBe('dog');
    expect((await runChain(dogs)).specs.at(-1)).not.toEqual(CHAIN_FINAL_SPEC);
  });
});
