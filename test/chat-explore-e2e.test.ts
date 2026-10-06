// Scripted end to end (Day 4 "done when"): fake model -> run_query -> REAL parser -> fake driver -> executor -> render_chart -> blocks on the
// stream. EXP-03 (Exploratory chip data + SQL on the block), EXP-04 (figures checked), nothing live: no network, no database, no cost.
import {describe, expect, it, vi} from 'vitest';
import type {RunQuery} from '../src/chat/explore/executor';
import {lines, toolTurn, toolUse} from './support/fake-model';
import {harness, text} from './support/explore-harness';

const SQL = "select coalesce(o.pet_type, 'untagged') as pet, count(*) as orders_count, round(sum(o.total), 2) as revenue_php from coop_explore_orders o where o.status = 'completed' group by 1 order by revenue_php desc";
const ROWS = [['dog', 7, 3800.5], ['cat', 4, 2250], ['untagged', 2, 410]];

describe('Explore end to end with a scripted model', () => {
  it('EXP-03 runs a query, draws a chart block flagged Exploratory with the SQL, and nothing enters the report spec', async () => {
    const run = vi.fn<RunQuery>(async () => ({columns: [{name: 'pet', type: 'text'}, {name: 'orders_count', type: 'number'}, {name: 'revenue_php', type: 'number'}], rows: ROWS, fetched: 3, ms: 2}));
    const h = harness(run, (n) => {
      if (n === 1) return toolTurn('Let me check.', toolUse('a', 'run_query', {purpose: 'Revenue by pet', sql: SQL, step: 'final'}));
      if (n === 2) return toolTurn('Dogs lead with ₱3,800.50 from 7 orders.', toolUse('b', 'render_chart', {block: 'new', source: 'x1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'Revenue by pet'}), toolUse('c', 'render_table', {block: 'new', source: 'x1', columns: ['auto'], title: 'Revenue by pet'}));
      return {text: ['Done.'], stop_reason: 'end_turn'};
    });
    const sum = await h.go();
    expect(sum.stopReason).toBe('end_turn');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(`DECLARE coop_explore_c NO SCROLL CURSOR FOR ${SQL}`); // exactly the validated string, wrapped
    expect(h.blocks.map((b) => b.kind)).toContain('chart');
    for (const b of h.blocks) {
      expect(b.exploratory).toBe(true);
      expect(b.sql).toBe(SQL);
      expect(b.caveats).toContain('Exploratory, not a registered metric.');
      expect(b.basis).toMatch(/Exploratory query/);
    }
    // never recorded into a report: no report event, no spec
    expect(h.events.some((e) => e.t === 'report')).toBe(false);
    expect(h.session.snapshot()).toBeNull();
    // the answer text arrived after the check (figures match the rows)
    expect(text(h.events)).toContain('₱3,800.50');
    // the model never saw the SQL back
    const msgs = JSON.parse(h.model.requests[1]).messages as {role: string; content: {type: string; content?: string}[]}[];
    const toolResult = msgs[msgs.length - 1].content.find((c) => c.type === 'tool_result')!.content!;
    expect(toolResult).not.toContain('coop_explore_orders');
    expect(toolResult).not.toContain('completed');
    // one query line, one registry-gap line
    expect(lines(h.s.info).filter((l) => l.event === 'chat_explore_query')).toHaveLength(1);
    expect(lines(h.s.info).filter((l) => l.event === 'chat_registry_gap')).toHaveLength(1);
  });

  it('EXP-04 an invented figure beside the chart is rewritten once before anyone sees it', async () => {
    const run: RunQuery = async () => ({columns: [{name: 'pet', type: 'text'}, {name: 'orders_count', type: 'number'}, {name: 'revenue_php', type: 'number'}], rows: ROWS, fetched: 3, ms: 2});
    const h = harness(run, (n) => {
      if (n === 1) return toolTurn('', toolUse('a', 'run_query', {purpose: 'p', sql: SQL, step: 'final'}));
      if (n === 2) return toolTurn('Dogs made ₱9,999.', toolUse('b', 'render_chart', {block: 'new', source: 'x1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'T'}));
      if (n === 3) return toolTurn('Dogs made ₱3,800.50.', toolUse('b', 'render_chart', {block: 'new', source: 'x1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'T'}));
      return {text: [], stop_reason: 'end_turn'};
    });
    await h.go();
    expect(text(h.events)).not.toContain('9,999');
    expect(text(h.events)).toContain('₱3,800.50');
    expect(h.blocks.length).toBeGreaterThan(0);
    // the text is shown before the blocks (held text is released first)
    const firstText = h.events.findIndex((e) => e.t === 'text' && (e as {d: string}).d.includes('3,800.50'));
    const firstBlock = h.events.findIndex((e) => e.t === 'block');
    expect(firstText).toBeLessThan(firstBlock);
  });

  it('EXP-02 a write attempt fails the request: refusal text, no driver call, one trip line, no SQL in any log', async () => {
    const run = vi.fn<RunQuery>();
    const h = harness(run, () => toolTurn('', toolUse('a', 'run_query', {purpose: 'delete order 12', sql: "delete from pos_orders where id = 12 -- Maria Santos", step: 'final'})), 'Pa-delete naman ng order #12.');
    const sum = await h.go();
    expect(sum.stopReason).toBe('guard_trip');
    expect(run).not.toHaveBeenCalled();
    expect(h.model.requests).toHaveLength(1);
    expect(text(h.events)).toBe("I can't help with that one.");
    expect(lines(h.s.error).filter((l) => l.event === 'chat_guard_trip')).toEqual([{event: 'chat_guard_trip', layer: 'explore_parser', detail: {code: 'E_NOT_SELECT', class: 'hard'}, user: 'dev@localhost'}]);
    expect(JSON.stringify([h.s.info.mock.calls, h.s.error.mock.calls, h.s.warn.mock.calls])).not.toMatch(/pos_orders|Maria|delete order/);
  });

  it('EXP-03 a repairable error lets the model fix the SQL and retry in the same turn', async () => {
    const run: RunQuery = async () => ({columns: [{name: 'orders_count', type: 'number'}], rows: [[13]], fetched: 1, ms: 1});
    const h = harness(run, (n) => {
      if (n === 1) return toolTurn('', toolUse('a', 'run_query', {purpose: 'count', sql: 'select * from coop_explore_orders', step: 'final'}));
      if (n === 2) return toolTurn('', toolUse('b', 'run_query', {purpose: 'count', sql: "select count(*) as orders_count from coop_explore_orders o where o.status = 'completed'", step: 'final'}));
      return {text: ['There were 13 orders.'], stop_reason: 'end_turn'};
    });
    const sum = await h.go();
    expect(sum.steps).toBe(3);
    expect(h.model.requests[1]).toContain('E_SELECT_STAR');
    expect(text(h.events)).toContain('13 orders');
  });
});
