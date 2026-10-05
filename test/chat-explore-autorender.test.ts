// Live Ask Coop test 3 (G01, R01, G25): the model ended its turn right after run_query without calling render_chart or render_table, so
// every fix attached to a rendered block (chart, chip, Show SQL, code-written caveats) never ran. The app now draws the last unrendered
// final result itself (no model call, no model-typed numbers) and a narration step never reaches the answer. Scripted model only.
import {describe, expect, it} from 'vitest';
import type {RunQuery} from '../src/chat/explore/executor';
import {ORDERS_BY_DATE_NOTE} from '../src/chat/explore/basis';
import {toolTurn, toolUse} from './support/fake-model';
import {harness, text} from './support/explore-harness';

// G01 shape: orders per event and pet, attributed by the event date window.
const BY_DATE = "select e.name as event, o.pet_type as pet, count(*) as orders_count from coop_explore_orders o join coop_explore_events e on (o.created_at at time zone 'Asia/Manila')::date between e.starts_on and coalesce(e.ends_on, e.starts_on) where o.status = 'completed' group by 1, 2";
const LEADS = 'select l.pet as pet, count(*) as leads_count from coop_explore_event_leads l group by 1';
const FACTS = {count: 8, withPet: 6, petFrom: '2026-09-12'};
const FACT_TEXT = '8 leads in the leads view, 6 with a pet value (pet was only collected from 12 Sep 2026).';
const EVENT_COLS = [{name: 'event', type: 'text' as const}, {name: 'pet', type: 'text' as const}, {name: 'orders_count', type: 'number' as const}];
const EVENT_ROWS = [['SM Aura Pet Fair', 'dog', 7], ['SM Aura Pet Fair', 'cat', 4], ['Circuit Makati', 'dog', 3], ['Circuit Makati', 'cat', 5]];
const ok: RunQuery = async () => ({columns: EVENT_COLS, rows: EVENT_ROWS, fetched: 4, ms: 1});
const final = (id: string, sql = BY_DATE) => toolUse(id, 'run_query', {purpose: 'Orders per event and pet', sql, step: 'final'});
const probe = (id: string) => toolUse(id, 'run_query', {purpose: 'look', sql: BY_DATE, step: 'probe'});
const render = (id: string, source: string, tool: 'render_chart' | 'render_table' = 'render_chart') =>
  toolUse(id, tool, tool === 'render_chart' ? {block: 'new', source, kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'Orders'} : {block: 'new', source, columns: ['auto'], title: 'Orders'});

describe('F1 the app draws the last unrendered final result when the model ends the turn without a render call', () => {
  it('EXP-03 run_query final then prose only: exactly one chart block with its table twin, the chip data, the SQL and the code-written caveats', async () => {
    const h = harness(ok, (n) => (n === 1 ? toolTurn('', final('a')) : {text: ['SM Aura sold 7 dog orders.'], stop_reason: 'end_turn'}));
    const sum = await h.go();
    expect(sum.stopReason).toBe('end_turn');
    expect(h.model.requests).toHaveLength(2); // no extra model call
    expect(h.blocks).toHaveLength(1);
    const b = h.blocks[0];
    expect(b.kind).toBe('chart');
    if (b.kind !== 'chart') throw new Error('chart expected');
    expect(b.twin.rows).toHaveLength(4); // the table twin carries every row
    expect(b.source).toBe('x1');
    expect(b.exploratory).toBe(true);
    expect(b.sql).toBe(BY_DATE);
    expect(b.caveats).toContain('Exploratory, not a registered metric.');
    expect(b.caveats).toContain(ORDERS_BY_DATE_NOTE);
    expect(text(h.events)).toBe('SM Aura sold 7 dog orders.');
    // the block is drawn before the explanation
    expect(h.events.findIndex((e) => e.t === 'block')).toBeLessThan(h.events.findIndex((e) => e.t === 'text'));
    expect(h.events.some((e) => e.t === 'report')).toBe(false); // never recorded into a report
  });

  it('EXP-03 the lead coverage caveat is on the auto-drawn block too', async () => {
    const run: RunQuery = async () => ({columns: [{name: 'pet', type: 'text'}, {name: 'leads_count', type: 'number'}], rows: [['dog', 4], ['cat', 2]], fetched: 2, ms: 1});
    const h = harness(run, (n) => (n === 1 ? toolTurn('', final('a', LEADS)) : {text: ['Mostly dogs.'], stop_reason: 'end_turn'}), 'q', {leadFacts: FACTS});
    await h.go();
    expect(h.blocks).toHaveLength(1);
    expect(h.blocks[0].caveats).toContain(FACT_TEXT);
    expect(h.blocks[0].caveats).toContain('Leads are booth sign-ups, not buyers.');
  });

  it('EXP-03 when the model already rendered the result there is no duplicate', async () => {
    const h = harness(ok, (n) => {
      if (n === 1) return toolTurn('', final('a'));
      if (n === 2) return toolTurn('SM Aura sold 7 dog orders.', render('b', 'x1'));
      return {text: ['Done.'], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(h.blocks.filter((b) => b.kind === 'chart')).toHaveLength(1);
    expect(h.blocks).toHaveLength(1);
  });

  it('EXP-03 a table render of the result also counts as rendered (the chart-first nudge stays the model\'s call)', async () => {
    const h = harness(ok, (n) => {
      if (n === 1) return toolTurn('', final('a'));
      if (n === 2) return toolTurn('Text.', render('b', 'x1', 'render_table'));
      if (n === 3) return toolTurn('', render('c', 'x1'), render('d', 'x1', 'render_table'));
      return {text: ['Done.'], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(h.blocks.map((b) => b.kind).sort()).toEqual(['chart', 'table']);
  });

  it('EXP-03 a probe is never auto-drawn', async () => {
    const h = harness(ok, (n) => (n === 1 ? toolTurn('', probe('a')) : {text: ['It has 4 rows.'], stop_reason: 'end_turn'}));
    await h.go();
    expect(h.blocks).toEqual([]);
  });

  it('EXP-03 two finals, the model drew the first: only the last unrendered one (x2) is drawn', async () => {
    const h = harness(ok, (n) => {
      if (n === 1) return toolTurn('', final('a'));
      if (n === 2) return toolTurn('One.', render('b', 'x1'), final('c'));
      return {text: ['Done.'], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(h.blocks.map((b) => b.source)).toEqual(['x1', 'x2']);
  });

  it('EXP-03 two finals, neither drawn: only the LAST one is drawn', async () => {
    const h = harness(ok, (n) => (n === 1 ? toolTurn('', final('a'), final('b')) : {text: ['Done.'], stop_reason: 'end_turn'}));
    await h.go();
    expect(h.blocks.map((b) => b.source)).toEqual(['x2']);
  });

  it('EXP-03 an empty final result draws nothing', async () => {
    const empty: RunQuery = async () => ({columns: EVENT_COLS, rows: [], fetched: 0, ms: 1});
    const h = harness(empty, (n) => (n === 1 ? toolTurn('', final('a')) : {text: ['No rows.'], stop_reason: 'end_turn'}));
    await h.go();
    expect(h.blocks).toEqual([]);
  });
});

describe('F2 narration in a tool step never reaches the answer on an Explore turn', () => {
  it('EXP-04 "Fix the grouping." after an E_GROUPING error is dropped; only the final step text is shown', async () => {
    let calls = 0;
    const flaky: RunQuery = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('x'), {code: '42803'});
      return {columns: EVENT_COLS, rows: EVENT_ROWS, fetched: 4, ms: 1};
    };
    const h = harness(flaky, (n) => {
      if (n === 1) return toolTurn('Let me query the orders.', final('a'));
      if (n === 2) return toolTurn('Fix the grouping.', final('b'));
      return {text: ['SM Aura sold 7 dog orders.'], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(h.model.requests[1]).toContain('E_GROUPING');
    const shown = text(h.events);
    expect(shown).toBe('SM Aura sold 7 dog orders.');
    expect(shown).not.toMatch(/Fix the grouping|Let me query/);
    expect(h.blocks).toHaveLength(1); // the repaired result is drawn by the app
  });

  it('EXP-04 text before a render call is still the answer (headline before the chart)', async () => {
    const h = harness(ok, (n) => {
      if (n === 1) return toolTurn('Narration.', final('a'));
      if (n === 2) return toolTurn('SM Aura sold 7 dog orders.', render('b', 'x1'));
      return {text: [], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(text(h.events)).toBe('SM Aura sold 7 dog orders.');
  });
});

describe('F1/F2 other turns are unchanged', () => {
  it('a non-Explore turn still streams narration live and the loop never calls autoRender', async () => {
    const {runChatLoop} = await import('../src/chat/loop');
    const {CHAT_TOOLS} = await import('../src/chat/tool-defs');
    const {FakeModel, sink} = await import('./support/fake-model');
    const events: {t: string; d?: string}[] = [];
    let drawn = 0;
    const m = new FakeModel((n) => (n === 1 ? toolTurn('Checking.', toolUse('q', 'describe_data', {metric: 'all'})) : {text: ['Done.'], stop_reason: 'end_turn'}));
    await runChatLoop({
      client: m, model: 'm', maxTokens: 10, effort: 'medium', system: [{type: 'text', text: 'S'}], tools: CHAT_TOOLS, messages: [{role: 'user', content: 'hi'}], preamble: 'p',
      executors: {describe_data: async () => ({ok: true}), autoRender: async () => (drawn++, [])}, emit: (e) => events.push(e as {t: string; d?: string}), user: null, sink: sink(),
    });
    expect(events.filter((e) => e.t === 'text').map((e) => e.d).join('')).toBe('Checking.Done.');
    expect(drawn).toBe(0);
  });

  it('the model cannot call autoRender as a tool', async () => {
    const {dispatchToolCall} = await import('../src/chat/tools');
    const r = await dispatchToolCall({name: 'autoRender', input: {}}, {run_query: async () => ({})} as never);
    expect(r.is_error).toBe(true);
  });
});
