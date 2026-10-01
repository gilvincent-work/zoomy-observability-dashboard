// F5: the manual Messages-API tool loop. Pure of Next/server-only: the client is injected, so tests need no network.
// Pattern from Spike A (knowledge/tasks/2026-10-01-talk-to-data-spikes.md): assistant content is appended UNCHANGED
// (thinking blocks included), all tool_result blocks go back in ONE user message with results first, and the
// system + tools prefix is identical on every request so the prompt cache holds.
import type Anthropic from '@anthropic-ai/sdk';
import {logNumberViolation, logTurn, type AuditSink} from './audit';
import {checkNumbers} from './number-check';
import {assertRequestShape} from './request-shape';
import type {ChatStreamEvent, ChatUsage, ToolDefinition} from './stream-types';
import {statusFor} from './tool-executors';
import {dispatchToolCall, type ToolExecutors} from './tools';

/** The only part of the Anthropic SDK the loop touches. The real `new Anthropic()` satisfies it. */
export interface MessageStreamLike extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}
export interface MessagesClient {
  messages: {
    stream(params: Anthropic.MessageStreamParams, options?: {signal?: AbortSignal}): MessageStreamLike;
  };
}

export type SystemBlock = {type: 'text'; text: string; cache_control?: {type: 'ephemeral'}};
export type ChatEffort = 'low' | 'medium' | 'high';

export interface ChatLoopOptions {
  client: MessagesClient;
  model: string;
  maxTokens: number;
  effort: ChatEffort;
  system: SystemBlock[];
  tools: readonly ToolDefinition[];
  /** The sanitised conversation from the client; the last entry is the new user question. */
  messages: {role: 'user' | 'assistant'; content: string}[];
  /** Per-turn context (today's date, coverage). Goes ONLY into the latest user turn, never into the cached prefix. */
  preamble: string;
  executors: ToolExecutors;
  emit: (e: ChatStreamEvent) => void;
  user: string | null;
  maxSteps?: number;
  /** Wall-clock budget in ms (default 50_000; the route's maxDuration is 60 s). Checked before each model step, never mid-step. */
  deadlineMs?: number;
  /** Test seam: the clock, in ms. Defaults to Date.now. */
  clock?: () => number;
  signal?: AbortSignal;
  sink?: AuditSink;
}

export interface ChatLoopSummary {
  steps: number;
  usage: ChatUsage;
  stopReason: string | null;
}

export const REFUSAL_TEXT = "I can't help with that one.";
export const CUT_OFF_TEXT = '\n\nThe answer was cut off.';
/** The default wall-clock budget of one turn: the route allows 60 s, so a graceful stop has 10 s of room. */
export const CHAT_DEADLINE_MS = 50_000;
export const DEADLINE_TEXT = 'That took longer than I allow. Try a narrower question.';
export const MAX_STEPS_TEXT = 'That took more steps than I allow. Try asking a narrower question.';
// DASH-01 as a gate: the first time a step asks to render before any text was written, every render call in that step is
// refused once with this message. After that the calls go through even if no text came (bounded cost: one extra step).
export const ORDER_NUDGE_TEXT = 'Nothing was drawn and your call was fine. Write the caveat (only if there is one) and one headline sentence as text now, in this same message, then repeat the same render calls.';
export const SAFE_ERROR_TEXT = 'Coop hit a problem answering that. Please try again.';
// The system block that holds the selected week's digest (context.ts buildDigestBlock). Its figures are a legitimate source
// for the number check (the answer may quote the digest without a tool call); the skill text and catalog are not.
const DIGEST_HEADING = '## Selected period';

export async function runChatLoop(opts: ChatLoopOptions): Promise<ChatLoopSummary> {
  const {client, emit, signal, sink} = opts;
  const maxSteps = opts.maxSteps ?? 8;
  const deadlineMs = opts.deadlineMs ?? CHAT_DEADLINE_MS;
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const usage: ChatUsage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
  let steps = 0;
  let stopReason: string | null = null;
  let textSeen = false;
  let nudged = false;
  // F11: the answer text and the (non-error) tool results of this turn, for the log-only number check.
  let answer = '';
  const seen: unknown[] = [];

  const convo: Anthropic.MessageParam[] = opts.messages.map((m, i) =>
    i === opts.messages.length - 1 && m.role === 'user'
      ? {role: 'user', content: [{type: 'text', text: opts.preamble}, {type: 'text', text: m.content}]}
      : {role: m.role, content: m.content},
  );

  // Log-only (Slice 6 #1): figures the answer displays that no tool result, question, preamble or digest holds. It never
  // changes, delays or blocks the answer, and a failure of the check itself is swallowed.
  const auditNumbers = (): void => {
    try {
      const context = [...opts.messages.map((m) => m.content), opts.preamble, ...opts.system.filter((b) => b.text.startsWith(DIGEST_HEADING)).map((b) => b.text)].join('\n');
      const {violations, checked} = checkNumbers(answer, seen, {context});
      if (violations.length > 0) logNumberViolation({violations, checked, user: opts.user}, sink);
    } catch {
      // the check is a safety net, never a dependency
    }
  };

  const finish = (reason: string | null, done: boolean): ChatLoopSummary => {
    stopReason = reason;
    if (done) emit({t: 'done', steps, usage});
    logTurn({steps, usage, ms: clock() - t0, stopReason, user: opts.user}, sink);
    return {steps, usage, stopReason};
  };

  for (;;) {
    if (signal?.aborted) return finish('aborted', false);
    // Wall-clock budget: stop gracefully BEFORE starting another model step, so Vercel never has to kill the stream mid-answer.
    if (clock() - t0 > deadlineMs) {
      emit({t: 'text', d: `${answer.trim() ? '\n\n' : ''}${DEADLINE_TEXT}`});
      return finish('deadline', true);
    }
    steps += 1;

    let res: Anthropic.Message;
    try {
      const params = {
        model: opts.model,
        max_tokens: opts.maxTokens,
        thinking: {type: 'adaptive' as const},
        output_config: {effort: opts.effort},
        system: opts.system,
        // No tools (degraded digest-only mode): the API rejects an empty tools list, so omit tools and tool_choice.
        ...(opts.tools.length > 0 ? {tools: [...opts.tools], tool_choice: {type: 'auto' as const}} : {}),
        messages: [...convo],
      };
      assertRequestShape(params, sink);
      const stream = client.messages.stream(params, {signal});
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (ev.delta.text.trim() !== '') textSeen = true;
          answer += ev.delta.text;
          emit({t: 'text', d: ev.delta.text});
        }
      }
      res = await stream.finalMessage();
    } catch (err) {
      if (signal?.aborted) return finish('aborted', false);
      const e = err as {name?: unknown; status?: unknown};
      (sink ?? console).error(JSON.stringify({event: 'chat_error', name: String(e?.name ?? 'Error'), status: typeof e?.status === 'number' ? e.status : null, user: opts.user}));
      emit({t: 'error', message: SAFE_ERROR_TEXT});
      return finish('error', false);
    }

    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    usage.cacheRead += res.usage?.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage?.cache_creation_input_tokens ?? 0;

    if (res.stop_reason === 'refusal') {
      emit({t: 'text', d: REFUSAL_TEXT});
      return finish('refusal', true);
    }
    if (res.stop_reason === 'max_tokens') {
      emit({t: 'text', d: CUT_OFF_TEXT});
      return finish('max_tokens', true);
    }
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || calls.length === 0) {
      auditNumbers();
      return finish(res.stop_reason, true);
    }

    if (steps >= maxSteps) {
      emit({t: 'text', d: MAX_STEPS_TEXT});
      return finish('max_steps', true);
    }
    // The assistant turn goes back exactly as returned (thinking blocks included), then ONE user message of results.
    convo.push({role: 'assistant', content: res.content as Anthropic.ContentBlockParam[]});
    for (const c of calls) emit({t: 'status', text: statusFor(c.name, c.input)});
    const isRender = (name: string) => name.startsWith('render_');
    const nudge = !textSeen && !nudged && calls.some((c) => isRender(c.name));
    if (nudge) nudged = true;
    const results = await Promise.all(
      calls.map((c) => (nudge && isRender(c.name) ? {is_error: true, content: {error: ORDER_NUDGE_TEXT}} : dispatchToolCall({name: c.name, input: c.input, user: opts.user}, opts.executors, sink))),
    );
    for (const r of results) if (!r.is_error) seen.push(r.content);
    convo.push({
      role: 'user',
      content: calls.map((c, i): Anthropic.ToolResultBlockParam => ({
        type: 'tool_result',
        tool_use_id: c.id,
        content: JSON.stringify(results[i].content) ?? 'null',
        ...(results[i].is_error ? {is_error: true} : {}),
      })),
    });
  }
}
