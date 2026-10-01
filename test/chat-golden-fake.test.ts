import {describe, expect, it, vi} from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {runChatLoop, type MessagesClient} from '../src/chat/loop';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import {createExecutors} from '../src/chat/tool-executors';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import type {MetricData} from '../src/chat/result-types';
import type {PosEvent} from '../src/pos-sales-types';
import {buildBundleFixture, CHANGES, PRICES} from './support/bundle-fixture';

// 10 scripted golden cases: a fake model emits the expected tool calls, the REAL executors run over a synthetic
// MetricData and return real registry results. Offline, no network.

const NOW = new Date('2026-10-01T04:00:00Z'); // Thursday 1 Oct 2026, noon PHT
const fx = buildBundleFixture(); // orders Sep 7..27, totals known by construction
const EVENT: PosEvent = {event_id: 'EV1', name: 'Pet Fair', venue: null, city: null, organizer: null, starts_on: '2026-09-07', ends_on: '2026-09-13', opening_cash: null, cash_note: null, closing_cash: null, status: 'closed', created_by: null, created_at: null, updated_at: null};
const DATA: MetricData = {
  source: 'live',
  orders: fx.orders.map((o, i) => (i < 6 ? {...o, event_id: 'EV1'} : o)),
  events: [EVENT], prices: PRICES, priceChanges: CHANGES, bulkReads: [],
};

const BASE = {metric: 'offline_revenue', dimension: 'none', measure: 'default', range: 'custom', from: '2026-09-07', to: '2026-09-27', channel: 'offline', event: 'all', pet: 'all', compare_to: 'none', sort: 'default', limit: 5};
const query = (over: Record<string, unknown>) => ({name: 'query_metric', input: {...BASE, ...over}});
const describeAll = {name: 'describe_data', input: {metric: 'all'}};

type Row = Record<string, string | number | null>;
interface Payload {
  metric: string;
  rows: Row[];
  meta: {coverage: string; coveredFrom: string; coveredTo: string; measure: string; range: {from: string; to: string}; caveats: string[]; checks: {code: string; status: string}[]};
  today: string;
  coverage: {from: string; to: string; orders: number};
  metrics: {id: string}[];
}
type Call = {name: string; input: unknown};

/** A fake model: step 1 asks for `calls` (in one response), step 2 answers. Returns what the tools returned. */
async function ask(question: string, calls: Call[]) {
  const requests: {messages: {role: string; content: unknown}[]}[] = [];
  const client: MessagesClient = {
    messages: {
      stream: (params) => {
        requests.push(JSON.parse(JSON.stringify(params)));
        const n = requests.length;
        const content =
          n === 1
            ? calls.map((c, i) => ({type: 'tool_use', id: `tu_${i}`, name: c.name, input: c.input}))
            : [{type: 'text', text: 'Here is the answer.'}];
        return {
          async *[Symbol.asyncIterator]() {
            if (n > 1) yield {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: 'Here is the answer.'}} as Anthropic.MessageStreamEvent;
          },
          finalMessage: async () => ({content, stop_reason: n === 1 ? 'tool_use' : 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}) as unknown as Anthropic.Message,
        };
      },
    },
  };
  const events: ChatStreamEvent[] = [];
  const sink = {info: vi.fn(), error: vi.fn()};
  await runChatLoop({
    client, model: 'm', maxTokens: 4096, effort: 'medium', system: [{type: 'text', text: 'S'}], tools: CHAT_TOOLS,
    messages: [{role: 'user', content: question}], preamble: '[context]',
    executors: createExecutors({data: async () => DATA, now: NOW, user: null}),
    emit: (e) => events.push(e), user: null, sink,
  });
  const results = (requests[1].messages.at(-1)!.content as {content: string; is_error?: boolean}[]).map((r) => {
    expect(r.is_error).toBeUndefined();
    return JSON.parse(r.content) as Payload;
  });
  const toolsCalled = requests[0] && calls.map((c) => c.name);
  expect(events.at(-1)).toMatchObject({t: 'done', steps: 2});
  expect(events.some((e) => e.t === 'text')).toBe(true);
  expect(sink.error).not.toHaveBeenCalled();
  return {results, toolsCalled, events};
}

const rowBy = (p: Payload, key: string, value: unknown) => p.rows.find((r) => r[key] === value);
const checkOf = (p: Payload, code: string) => p.meta.checks.find((c) => c.code === code);

describe('golden cases with a fake model and the real executors', () => {
  it('1. top 5 products', async () => {
    const {results, toolsCalled} = await ask('Top 5 products?', [query({metric: 'top_products'})]);
    expect(toolsCalled).toEqual(['query_metric']);
    const [p] = results;
    expect(p.metric).toBe('top_products');
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0]).toMatchObject({product: 'SKU 4', revenue: 1300});
    expect(p.meta.coverage).toBe('full');
  });

  it('2. weekly offline revenue for a range', async () => {
    const {results} = await ask('Weekly revenue Sep 7 to Sep 27?', [query({dimension: 'week'})]);
    const [p] = results;
    expect(p.rows.map((r: Row) => [r.period, r.revenue])).toEqual([['2026-09-07', 7700], ['2026-09-14', 7300], ['2026-09-21', 6550]]);
    expect(p.rows.reduce((s: number, r: Row) => s + Number(r.revenue), 0)).toBe(21550);
    expect(checkOf(p, 'reconciles')?.status).toBe('ok');
  });

  it('3. payment mix', async () => {
    const {results} = await ask('How do customers pay?', [query({metric: 'payment_mix'})]);
    expect(results[0].rows).toEqual([{method: 'cash', value: 21550, share: 100}]);
  });

  it('4. average order value vs last week (compare_to previous_period)', async () => {
    const {results} = await ask('AOV vs last week?', [query({metric: 'offline_aov', range: 'last_week', from: '', to: '', compare_to: 'previous_period'})]);
    const [p] = results;
    expect(p.meta.range).toMatchObject({from: '2026-09-21', to: '2026-09-27'});
    expect(p.rows[0]).toMatchObject({orders: 11, revenue: 6550, aov: 595.45, previous_aov: 608.33, delta: -12.88});
    expect(checkOf(p, 'small_sample')?.status).toBe('warn');
  });

  it('5. "what can you answer?" uses describe_data all', async () => {
    const {results, toolsCalled} = await ask('What can you answer?', [describeAll]);
    expect(toolsCalled).toEqual(['describe_data']);
    const [p] = results;
    expect(p.today).toBe('2026-10-01');
    expect(p.coverage).toMatchObject({from: '2026-09-07', to: '2026-09-27', orders: 36});
    expect(p.metrics.map((m: {id: string}) => m.id)).toEqual(expect.arrayContaining(['offline_revenue', 'bundle_sales', 'bundle_picks']));
  });

  it('6. a Traffic question: describe_data, never query_metric', async () => {
    const {results, toolsCalled} = await ask('How is website traffic?', [describeAll]);
    expect(toolsCalled).toEqual(['describe_data']);
    expect(JSON.stringify(results[0])).toMatch(/Traffic/);
  });

  it('7. event rollup', async () => {
    const {results} = await ask('How did the events do?', [query({metric: 'event_rollup'})]);
    const [p] = results;
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({event: 'Pet Fair'});
    // orders are attributed to the event by its dates (Sep 7 to 13): 14 orders fall there, 1 of them voided
    expect(p.rows[0].orders).toBe(13);
    expect(p.meta.caveats.join(' ')).toMatch(/no event/);
  });

  it('8. dog vs cat sales (pet_mix)', async () => {
    const {results} = await ask('Dog vs cat sales?', [query({metric: 'pet_mix'})]);
    const [p] = results;
    expect(rowBy(p, 'pet', 'dog')?.value).toBe(1050);
    expect(rowBy(p, 'pet', 'cat')?.value).toBe(10950);
    expect(rowBy(p, 'pet', 'untagged')?.share).toBeNull();
    expect(checkOf(p, 'untagged_share')?.status).toBe('warn');
  });

  it('9. Sep 1 to 30 partly outside the data: coverage partial, caveat first', async () => {
    const {results} = await ask('Sales for September?', [query({from: '2026-09-01', to: '2026-09-30'})]);
    const [p] = results;
    expect(p.meta.coverage).toBe('partial');
    expect(p.meta.coveredFrom).toBe('2026-09-07');
    expect(p.meta.coveredTo).toBe('2026-09-27');
    expect(checkOf(p, 'partial_coverage')?.status).toBe('warn');
    expect(p.rows[0].revenue).toBe(21550);
  });

  it('10. bundles by pet and SKU pesos reconcile', async () => {
    const {results, toolsCalled} = await ask('Bundles by pet, and pesos per SKU by pet?', [
      query({metric: 'bundle_sales', dimension: 'pet_type'}),
      query({metric: 'bundle_picks', dimension: 'sku_by_pet', measure: 'revenue', limit: 25}),
    ]);
    expect(toolsCalled).toEqual(['query_metric', 'query_metric']);
    const [sales, picks] = results;
    const e = fx.expected.byPetC;
    expect(Math.round(Number(rowBy(sales, 'pet', 'dog')?.value) * 100)).toBe(e.dog);
    expect(Math.round(Number(rowBy(sales, 'pet', 'cat')?.value) * 100)).toBe(e.cat);
    expect(Math.round(Number(rowBy(sales, 'pet', 'both')?.value) * 100)).toBe(e.both);
    expect(Math.round(Number(rowBy(sales, 'pet', 'untagged')?.value) * 100)).toBe(e.untagged);
    expect(checkOf(sales, 'reconciles')?.status).toBe('ok');
    expect(picks.meta.measure).toBe('revenue');
    expect(checkOf(picks, 'reconciles')?.status).toBe('ok');
    expect(picks.meta.checks.some((c: {code: string; status: string}) => c.status === 'fail')).toBe(false);
  });
});
