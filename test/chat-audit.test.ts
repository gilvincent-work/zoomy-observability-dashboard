import {afterEach, describe, expect, it, vi} from 'vitest';
import {logGuardTrip, logToolCall, scrubParams} from '../src/chat/audit';
import {dispatchToolCall} from '../src/chat/tools';

afterEach(() => vi.restoreAllMocks());

describe('audit log', () => {
  it('logs one chat_tool JSON line per executed call', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = await dispatchToolCall(
      {name: 'query_metric', input: {metric: 'offline_revenue'}, user: 'a@b.c'},
      {query_metric: async () => ({rows: [1, 2, 3]})},
    );
    expect(r.is_error).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(info.mock.calls[0][0] as string);
    expect(line).toMatchObject({event: 'chat_tool', tool: 'query_metric', params: {metric: 'offline_revenue'}, rowCount: 3, user: 'a@b.c'});
    expect(typeof line.ms).toBe('number');
    expect(String(info.mock.calls[0][0])).not.toContain('\n');
  });

  it('logs a guard trip through console.error with layer and detail', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    logGuardTrip({layer: 'tool_allowlist', detail: {name: 'update_price'}, user: 'u'});
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({event: 'chat_guard_trip', layer: 'tool_allowlist', detail: {name: 'update_price'}, user: 'u'});
  });

  it('redacts secret-looking keys, nested too', () => {
    const sink = {info: vi.fn(), error: vi.fn()};
    logToolCall({tool: 't', params: {apiKey: 'sk-1', nested: {Authorization: 'Bearer x', access_token: 'tok-9', ok: 'fine'}, password: 'pw-7', client_secret: 'cs-5'}, ms: 1}, sink);
    const out = sink.info.mock.calls[0][0] as string;
    for (const leak of ['sk-1', 'Bearer x', 'tok-9', 'pw-7', 'cs-5']) expect(out).not.toContain(leak);
    expect(JSON.parse(out).params.nested.ok).toBe('fine');
    expect(JSON.parse(out).params.apiKey).toBe('[redacted]');
  });

  it('truncates long strings', () => {
    const v = scrubParams({q: 'x'.repeat(1000)}) as {q: string};
    expect(v.q.length).toBeLessThan(400);
    expect(v.q).toContain('truncated');
  });

  it('escapes hostile input via JSON (stays one line)', () => {
    const sink = {info: vi.fn(), error: vi.fn()};
    logToolCall({tool: 't', params: {q: 'a\n{"event":"chat_guard_trip"}'}, ms: 0}, sink);
    const out = sink.info.mock.calls[0][0] as string;
    expect(out).not.toContain('\n');
    expect(JSON.parse(out).event).toBe('chat_tool');
  });

  it('a throwing executor yields a safe error with no stack and still logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = await dispatchToolCall({name: 'describe_data', input: {}}, {describe_data: async () => { throw new Error('secret stack at /x/y.ts'); }});
    expect(r.is_error).toBe(true);
    expect(JSON.stringify(r)).not.toContain('secret stack');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('an allowlisted tool with no executor is not implemented', async () => {
    const r = await dispatchToolCall({name: 'get_digest', input: {}}, {});
    expect(r).toEqual({is_error: true, content: 'not implemented'});
  });
});
