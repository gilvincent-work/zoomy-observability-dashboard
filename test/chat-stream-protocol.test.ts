import {describe, it, expect} from 'vitest';
import {createLineDecoder, encodeEvent, withTextGate} from '../src/chat/stream-protocol';
import type {ChatStreamEvent} from '../src/chat/stream-types';
import type {ChatBlock} from '../src/chat/block-types';
import {createExecutors} from '../src/chat/tool-executors';
import type {MetricData, MetricRequest} from '../src/chat/result-types';
import {buildBundleFixture} from './support/bundle-fixture';
import {EVAL_NOW, standardData} from './support/skill-eval-fixtures';

const EVENTS: ChatStreamEvent[] = [
  {t: 'status', text: 'Looking at bundle sales'},
  {t: 'text', d: 'Hello\nworld "quoted" \\ 🐶'},
  {t: 'done', steps: 2, usage: {input: 10, output: 5, cacheRead: 3, cacheWrite: 1}},
  {t: 'error', message: 'Something went wrong.'},
];
const ERR = {t: 'error', message: 'Could not read part of the answer.'};

describe('stream protocol', () => {
  it('encodes one JSON line per event', () => {
    for (const e of EVENTS) {
      const line = encodeEvent(e);
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toContain('\n');
    }
  });

  it('round-trips every event type', () => {
    const decode = createLineDecoder();
    expect(decode(EVENTS.map(encodeEvent).join(''))).toEqual(EVENTS);
  });

  it('buffers a line split across three chunks', () => {
    const decode = createLineDecoder();
    const line = encodeEvent(EVENTS[0]);
    expect(decode(line.slice(0, 5))).toEqual([]);
    expect(decode(line.slice(5, 15))).toEqual([]);
    expect(decode(line.slice(15))).toEqual([EVENTS[0]]);
  });

  it('handles a multi-byte emoji split between string chunks', () => {
    const decode = createLineDecoder();
    const line = encodeEvent({t: 'text', d: 'a🐶b'});
    const cut = line.indexOf('🐶') + 1; // between the two UTF-16 halves
    expect(decode(line.slice(0, cut))).toEqual([]);
    expect(decode(line.slice(cut))).toEqual([{t: 'text', d: 'a🐶b'}]);
  });

  it('skips blank lines', () => {
    const decode = createLineDecoder();
    expect(decode('\n\n' + encodeEvent(EVENTS[0]) + '  \n\n')).toEqual([EVENTS[0]]);
  });

  it('yields one error for malformed lines and keeps decoding', () => {
    const decode = createLineDecoder();
    const out = decode('{not json\n' + encodeEvent(EVENTS[0]) + 'also bad\n' + encodeEvent(EVENTS[1]));
    expect(out).toEqual([ERR, EVENTS[0], EVENTS[1]]);
  });

  it('treats valid JSON without a string t as malformed and never throws', () => {
    const decode = createLineDecoder();
    expect(() => decode('null\n[1]\n42\n')).not.toThrow();
  });

  it('final flush parses the remaining buffered text', () => {
    const decode = createLineDecoder();
    const line = encodeEvent(EVENTS[2]).trim();
    expect(decode(line)).toEqual([]);
    expect(decode('', true)).toEqual([EVENTS[2]]);
    expect(decode('', true)).toEqual([]);
  });

  it('final flush of a truncated line gives the error event', () => {
    const decode = createLineDecoder();
    decode('{"t":"text","d":"abc');
    expect(decode('', true)).toEqual([ERR]);
  });
});

describe('block events (F7)', () => {
  const block: ChatBlock = {
    id: 'b1', source: 'r1', title: 'T', reliable: false, caveats: ['34% of orders have no pet tag. "quoted"\n'], basis: null,
    kind: 'kpi', label: 'Revenue', value: 1234.5, format: 'peso', sub: null,
  };

  it('a block event passes through the decoder unchanged', () => {
    const decode = createLineDecoder();
    const e: ChatStreamEvent = {t: 'block', block};
    expect(encodeEvent(e).slice(0, -1)).not.toContain('\n');
    expect(decode(encodeEvent(e))).toEqual([e]);
    const mixed: ChatStreamEvent[] = [{t: 'text', d: 'Hi'}, e, {t: 'done', steps: 1, usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0}}];
    expect(createLineDecoder()(mixed.map(encodeEvent).join(''))).toEqual(mixed);
  });

  it('the route wiring (emitBlock -> {t: "block"}) streams every block the real executors bind', async () => {
    const fx = buildBundleFixture();
    const data: MetricData = {...standardData(), orders: fx.orders};
    const wire: string[] = [];
    const emit = (e: ChatStreamEvent) => wire.push(encodeEvent(e));
    // Exactly what app/api/chat/route.ts passes to createExecutors.
    const ex = createExecutors({data: async () => data, now: EVAL_NOW, user: null, emitBlock: (b) => emit({t: 'block', block: b})});
    const q: MetricRequest = {
      metric: 'bundle_sales', dimension: 'pet_type', measure: 'default', range: 'all_available', from: '', to: '', channel: 'offline', event: 'all', pet: 'all',
      compare_to: 'none', sort: 'default', limit: 25,
    };
    await ex.query_metric?.(q);
    await ex.render_chart?.({block: 'new', source: 'r1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'By pet'});
    await ex.render_table?.({block: 'new', source: 'r1', columns: ['auto'], title: 'Table'});
    const events = createLineDecoder()(wire.join(''));
    expect(events.map((e) => e.t)).toEqual(['block', 'block']);
    const kinds = events.map((e) => (e.t === 'block' ? e.block.kind : null));
    expect(kinds).toEqual(['chart', 'table']);
  });
});

describe('withTextGate', () => {
  it('flips only on non-blank text and still forwards every event', () => {
    const out: ChatStreamEvent[] = [];
    const g = withTextGate((e) => out.push(e));
    g.emit({t: 'status', text: 'Looking'});
    g.emit({t: 'text', d: '  \n'});
    expect(g.textSeen()).toBe(false);
    g.emit({t: 'text', d: 'Caveat.'});
    expect(g.textSeen()).toBe(true);
    expect(out).toHaveLength(3);
  });
});
