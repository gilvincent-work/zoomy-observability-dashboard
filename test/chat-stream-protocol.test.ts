import {describe, it, expect} from 'vitest';
import {createLineDecoder, encodeEvent} from '../src/chat/stream-protocol';
import type {ChatStreamEvent} from '../src/chat/stream-types';

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
