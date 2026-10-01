import {describe, expect, it, vi} from 'vitest';
import {dispatchToolCall} from '../src/chat/tools';

const sink = () => ({info: vi.fn(), error: vi.fn()});

// A refused request (the executor returns {error: 'allowed values ...'}) must reach the model flagged as an
// error so it corrects itself instead of treating the message as a result.
describe('dispatchToolCall: refused requests are errors', () => {
  it('an executor that returns {error} is reported as is_error with the message intact', async () => {
    const r = await dispatchToolCall({name: 'query_metric', input: {}}, {query_metric: async () => ({error: "Allowed dimensions for top_products: none"})}, sink());
    expect(r).toEqual({is_error: true, content: {error: 'Allowed dimensions for top_products: none'}});
  });

  it('a normal result, even one containing an "error" column or nested field, is not an error', async () => {
    const ok = await dispatchToolCall({name: 'query_metric', input: {}}, {query_metric: async () => ({id: 'r1', rows: [{error: 'x'}], meta: {error: 'y'}})}, sink());
    expect(ok.is_error).toBe(false);
    const arr = await dispatchToolCall({name: 'describe_data', input: {}}, {describe_data: async () => [{error: 'x'}]}, sink());
    expect(arr.is_error).toBe(false);
  });

  it('a result with an error key AND other keys is a result, not a refusal', async () => {
    const r = await dispatchToolCall({name: 'query_metric', input: {}}, {query_metric: async () => ({error: 'x', rows: []})}, sink());
    expect(r.is_error).toBe(false);
  });
});
