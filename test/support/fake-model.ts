// A scripted stand-in for the Anthropic SDK (no network, no keys, no cost). Shared by the Explore loop, audit and injection tests.
import type Anthropic from '@anthropic-ai/sdk';
import {vi} from 'vitest';
import type {MessagesClient} from '../../src/chat/loop';

export type Block = Record<string, unknown>;
export type Scripted = {text?: string[]; content?: Block[]; stop_reason?: string};

export class FakeModel implements MessagesClient {
  requests: string[] = [];
  constructor(private script: (call: number, req: {messages: {role: string; content: unknown}[]}) => Scripted) {}
  messages = {
    stream: (params: unknown) => {
      this.requests.push(JSON.stringify(params));
      const n = this.requests.length;
      const s = this.script(n, JSON.parse(this.requests[n - 1]));
      return {
        async *[Symbol.asyncIterator]() {
          for (const d of s.text ?? []) yield {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: d}} as Anthropic.MessageStreamEvent;
        },
        finalMessage: async () =>
          ({
            id: `msg_${n}`, type: 'message', role: 'assistant', model: 'fake',
            content: s.content ?? [{type: 'text', text: (s.text ?? []).join('')}],
            stop_reason: s.stop_reason ?? 'end_turn', stop_sequence: null,
            usage: {input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0},
          }) as unknown as Anthropic.Message,
      };
    },
  };
}

export const toolUse = (id: string, name: string, input: unknown): Block => ({type: 'tool_use', id, name, input});
/** A step where the model writes `text` (if any) and calls tools. */
export const toolTurn = (text: string, ...uses: Block[]): Scripted => ({text: text ? [text] : [], content: [...(text ? [{type: 'text', text}] : []), ...uses], stop_reason: 'tool_use'});
export const sink = () => ({info: vi.fn(), error: vi.fn(), warn: vi.fn()});
export const lines = (fn: ReturnType<typeof vi.fn>): Record<string, unknown>[] => fn.mock.calls.map((c) => JSON.parse(c[0] as string));
