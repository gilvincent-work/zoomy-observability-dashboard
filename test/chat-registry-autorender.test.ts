// Live Ask Coop test 7 (G08b, G15): the model called query_metric (top_products, pet_mix) and answered with a typed markdown table, never
// calling a render tool, so nothing was drawn. The app now draws a successful, unrendered query_metric result of 2+ rows with the registry's
// own recommended view, and strips the typed table only when a block was drawn. Scripted model, real executors, synthetic data.
import {describe, expect, it} from 'vitest';
import {runChatLoop} from '../src/chat/loop';
import {createReportSession} from '../src/chat/report-session';
import {CHAT_TOOLS, exploreTools} from '../src/chat/tool-defs';
import {createExecutors} from '../src/chat/tool-executors';
import type {ChatBlock} from '../src/chat/block-types';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import type {MetricData} from '../src/chat/result-types';
import {buildBundleFixture, CHANGES, PRICES} from './support/bundle-fixture';
import {FakeModel, sink, toolTurn, toolUse} from './support/fake-model';

const NOW = new Date('2026-10-01T04:00:00Z');
const fx = buildBundleFixture();
const DATA: MetricData = {source: 'live', orders: fx.orders, events: [], prices: PRICES, priceChanges: CHANGES, bulkReads: []};
const BASE = {metric: 'offline_revenue', dimension: 'none', measure: 'default', range: 'custom', from: '2026-09-07', to: '2026-09-27', channel: 'offline', event: 'all', pet: 'all', compare_to: 'none', sort: 'default', limit: 5};
const q = (id: string, over: Record<string, unknown>) => toolUse(id, 'query_metric', {...BASE, ...over});
const TOP = {metric: 'top_products', measure: 'units'};
const TABLE_TEXT = 'Ang pinaka-nabenta ay ang una.\n\n| Product | Units |\n| --- | --- |\n| A | 10 |\n| B | 7 |\n\nIyon ang ranking.';

function run(script: ConstructorParameters<typeof FakeModel>[0], tools: typeof CHAT_TOOLS | ReturnType<typeof exploreTools> = exploreTools()) {
  const session = createReportSession();
  const blocks: ChatBlock[] = [];
  const events: ChatStreamEvent[] = [];
  const model = new FakeModel(script);
  const executors = createExecutors({data: async () => DATA, now: NOW, user: null, emitBlock: (b) => { blocks.push(b); events.push({t: 'block', block: b}); }, report: session});
  const go = () => runChatLoop({client: model, model: 'fake', maxTokens: 100, effort: 'medium', system: [{type: 'text', text: 'S'}], tools, messages: [{role: 'user', content: 'q'}], preamble: '[context]', executors, emit: (e) => events.push(e), user: null, sink: sink()});
  return {go, blocks, events, model};
}
const text = (events: ChatStreamEvent[]) => events.filter((e) => e.t === 'text').map((e) => (e as {d: string}).d).join('');
const answer = (t: string) => ({text: [t], stop_reason: 'end_turn'});

describe('J1 the app draws a registry result the model forgot to render', () => {
  it('top_products then prose with a typed table: exactly one chart (table twin inside), the typed table is stripped, the prose stays', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', TOP)) : answer(TABLE_TEXT)));
    await h.go();
    expect(h.model.requests).toHaveLength(2); // no extra model call
    expect(h.blocks).toHaveLength(1);
    const b = h.blocks[0];
    expect(b.kind).toBe('chart');
    if (b.kind !== 'chart') throw new Error('chart expected');
    expect(b.source).toBe('r1');
    expect(b.twin.rows.length).toBeGreaterThanOrEqual(2);
    const t = text(h.events);
    expect(t).not.toContain('|');
    expect(t).toContain('Ang pinaka-nabenta ay ang una.');
    expect(t).toContain('Iyon ang ranking.');
    expect(h.events.findIndex((e) => e.t === 'block')).toBeLessThan(h.events.findIndex((e) => e.t === 'text'));
  });

  it('pet_mix with several rows is drawn', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', {metric: 'pet_mix'})) : answer('Mostly dogs.')));
    await h.go();
    expect(h.blocks.length).toBeGreaterThanOrEqual(1);
    expect(h.blocks[0].source).toBe('r1');
  });

  it('a single-value result stays text: nothing drawn, a typed table (if any) is left alone', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', {})) : answer('Total ay maliit.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')));
    await h.go();
    expect(h.blocks).toEqual([]);
    expect(text(h.events)).toContain('| A | B |');
  });

  it('when the model rendered the result itself there is no duplicate', async () => {
    const render = toolUse('b', 'render_chart', {block: 'new', source: 'r1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'Top'});
    const h = run((n) => (n === 1 ? toolTurn('', q('a', TOP)) : n === 2 ? toolTurn('Top products.', render) : answer('Done.')));
    await h.go();
    expect(h.blocks.filter((b) => b.source === 'r1')).toHaveLength(h.blocks.length);
    expect(h.blocks.filter((b) => b.kind === 'chart')).toHaveLength(1);
  });

  it('an error result draws nothing', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', {metric: 'nope'})) : answer('Hindi ko ma-check.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')));
    await h.go();
    expect(h.blocks).toEqual([]);
    expect(text(h.events)).toContain('| A | B |');
  });

  it('at most two registry results are drawn per turn', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', TOP), q('b', {metric: 'pet_mix'}), q('c', {...TOP, limit: 3})) : answer('ok')));
    await h.go();
    expect(new Set(h.blocks.map((b) => b.source)).size).toBe(2);
  });

  it('a turn without the Explore tool is unchanged: nothing is drawn, the table stays', async () => {
    const h = run((n) => (n === 1 ? toolTurn('', q('a', TOP)) : answer(TABLE_TEXT)), CHAT_TOOLS);
    await h.go();
    expect(h.blocks).toEqual([]);
    expect(text(h.events)).toContain('| Product | Units |');
  });
});
