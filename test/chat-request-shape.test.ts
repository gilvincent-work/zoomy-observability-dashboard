import {describe, expect, it, vi} from 'vitest';
import {assertRequestShape} from '../src/chat/request-shape';

const sink = () => ({info: vi.fn(), error: vi.fn()});
const tool = (over: Record<string, unknown> = {}) => ({
  name: 'query_metric',
  description: 'd',
  input_schema: {type: 'object', properties: {}, required: [], additionalProperties: false},
  strict: true,
  ...over,
});
const req = (over: Record<string, unknown> = {}) => ({
  model: 'claude-sonnet-5-5',
  max_tokens: 1200,
  system: 's',
  messages: [{role: 'user', content: 'hi'}],
  tools: [tool()],
  tool_choice: {type: 'auto'},
  ...over,
});

describe('assertRequestShape', () => {
  it('passes a valid request and one with optional keys', () => {
    const s = sink();
    expect(() => assertRequestShape(req(), s)).not.toThrow();
    expect(() => assertRequestShape(req({thinking: {type: 'adaptive'}, cache_control: {type: 'ephemeral'}, tools: [tool({type: 'custom', cache_control: {type: 'ephemeral'}})]}), s)).not.toThrow();
    expect(() => assertRequestShape({model: 'm', max_tokens: 1, messages: []}, s)).not.toThrow();
    expect(s.error).not.toHaveBeenCalled();
  });

  it('fails an extra top-level key and logs a guard trip', () => {
    const s = sink();
    expect(() => assertRequestShape(req({mcp_servers: []}), s)).toThrow(/top-level key/);
    expect(s.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(s.error.mock.calls[0][0]).event).toBe('chat_guard_trip');
  });

  it.each([{type: 'any'}, {type: 'tool', name: 'query_metric'}, {type: 'auto', disable_parallel_tool_use: true}, {type: 'none'}, null])(
    'fails tool_choice %j',
    (tc) => expect(() => assertRequestShape(req({tool_choice: tc}), sink())).toThrow(/tool_choice/),
  );

  it('fails a tool named update_price', () => {
    expect(() => assertRequestShape(req({tools: [tool({name: 'update_price'})]}), sink())).toThrow(/allowlist/);
  });

  it.each([
    {type: 'web_search_20260209', name: 'web_search'},
    {type: 'code_execution_20260521', name: 'code_execution'},
    {type: 'mcp_toolset', name: 'query_metric'},
    {type: 'computer_20251124', name: 'computer'},
    {type: 'web_fetch_20260209', name: 'query_metric'},
  ])('fails server/special tool %j', (t) => {
    expect(() => assertRequestShape(req({tools: [tool(t)]}), sink())).toThrow();
  });

  it('fails a tool without strict true, and unexpected tool keys', () => {
    expect(() => assertRequestShape(req({tools: [tool({strict: undefined})]}), sink())).toThrow(/strict/);
    expect(() => assertRequestShape(req({tools: [tool({strict: false})]}), sink())).toThrow(/strict/);
    expect(() => assertRequestShape(req({tools: [tool({url: 'https://x'})]}), sink())).toThrow(/tool key/);
  });

  it('fails malformed input', () => {
    expect(() => assertRequestShape(null, sink())).toThrow();
    expect(() => assertRequestShape(req({tools: 'x'}), sink())).toThrow();
    expect(() => assertRequestShape(req({tools: [null]}), sink())).toThrow();
  });
});
