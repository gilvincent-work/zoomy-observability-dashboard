// The wording grader of the live golden eval, made cheap and tolerant (owner request after the 2026-10-02 caching review).
// Pure of any network: the Messages call is injected, so test/eval-grader.test.ts runs offline.
//
// WHAT CHANGED AND WHY
//  - The old grader call set no `thinking` and no effort, so on Sonnet 5.5 it ran adaptive thinking at the default effort (high). Thinking tokens
//    count toward max_tokens (1,200 before), so a long think could cut the JSON verdict and the case was scored FAIL.
//  - Docs (checked 2026-10-02, platform.claude.com thinking-troubleshooting, effort, prompting-claude-sonnet-5-5): Sonnet 5.5 REJECTS
//    thinking {type: "disabled"} with a 400 at every effort level. The documented way to turn off up-front thinking is {type: "between_tools"},
//    accepted at effort high or below (no other field may be sent with it). With no tools in the request it means "answer without thinking".
//    Opus 5.5 always thinks ("disabled" is a 400), so its cheapest shape is effort low. Haiku 4.5 has extended thinking only (off by default,
//    "disabled" accepted) and does NOT support the effort parameter.
//  - max_tokens is 2,500 (the JSON is a few hundred tokens), and a reply that stops at max_tokens or does not parse is UNGRADED, not FAIL.
import {GRADER_SYSTEM, parseVerdict, rubricPrompt} from './golden-cases';
import {type ApiUsage, type Budget, type Usage, usageOf, zeroUsage} from './eval-budget';

export const GRADER_MAX_TOKENS = 2500;

/** The request fields that make the grader cheap for a model. Fields the model rejects are never sent. */
export interface GraderShape {
  thinking?: {type: 'between_tools'} | {type: 'disabled'};
  output_config?: {effort: 'low'};
  /** One line for people: what was chosen and why. */
  note: string;
}

export function graderShape(model: string): GraderShape {
  if (model.startsWith('claude-sonnet-5-5')) return {thinking: {type: 'between_tools'}, output_config: {effort: 'low'}, note: 'Sonnet 5.5: "disabled" is a 400; between_tools is the documented off switch, effort low'};
  if (model.startsWith('claude-opus-5-5')) return {output_config: {effort: 'low'}, note: 'Opus 5.5: thinking is always on and "disabled" is a 400; effort low is the cheapest'};
  if (model.startsWith('claude-haiku-4-5')) return {thinking: {type: 'disabled'}, note: 'Haiku 4.5: thinking disabled; the effort parameter is not supported, so none is sent'};
  if (/^claude-(sonnet|opus)-(4-\d|5)(-|$)/.test(model) && !model.startsWith('claude-opus-5-')) return {thinking: {type: 'disabled'}, note: 'this model accepts thinking disabled'};
  return {note: 'model not in the grader table: no thinking or effort field is sent (the safe shape; the call may think, but the cap still holds)'};
}

/** What the grader call needs from the Messages API (the real `anthropic.messages.create` satisfies it; tests pass a fake). */
export type GraderCreate = (params: Record<string, unknown>) => Promise<{
  content: {type: string; text?: string}[];
  stop_reason?: string | null;
  usage?: ApiUsage | null;
}>;

export type Grade = {state: 'graded'; verdict: boolean[]} | {state: 'ungraded'; reason: string};

/** A reply cut at max_tokens or without a readable verdict is UNGRADED (never a silent pass, and not a FAIL of the answer either). */
export function interpretGrade(reply: {text: string; stopReason: string | null | undefined}, count: number): Grade {
  if (reply.stopReason === 'max_tokens') return {state: 'ungraded', reason: 'the grader reply was cut at max_tokens'};
  const verdict = parseVerdict(reply.text, count);
  return verdict === null ? {state: 'ungraded', reason: 'the grader reply was not a readable verdict'} : {state: 'graded', verdict};
}

export interface GraderRun {
  grade: Grade;
  usage: Usage;
  cost: number;
}

/**
 * One grader call. The budget is checked BEFORE the call (a refusal throws and is never swallowed) and the usage is recorded after it. An API
 * error is UNGRADED too (the answer was not judged), and costs nothing because no usage came back.
 */
export async function runGrader(a: {create: GraderCreate; budget: Budget; model: string; question: string; answer: string; results: unknown[]; rubric: readonly string[]}): Promise<GraderRun> {
  a.budget.guard();
  const {note: _note, ...shape} = graderShape(a.model);
  let res: Awaited<ReturnType<GraderCreate>>;
  try {
    res = await a.create({
      model: a.model, max_tokens: GRADER_MAX_TOKENS, ...shape, system: GRADER_SYSTEM,
      messages: [{role: 'user', content: rubricPrompt(a.question, a.answer, a.results, a.rubric)}],
    });
  } catch (e) {
    const status = (e as {status?: unknown})?.status;
    return {grade: {state: 'ungraded', reason: `the grader call failed${typeof status === 'number' ? ` (HTTP ${status})` : ''}`}, usage: zeroUsage(), cost: 0};
  }
  const usage = usageOf(res.usage);
  const cost = a.budget.record(usage, a.model);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return {grade: interpretGrade({text, stopReason: res.stop_reason}, a.rubric.length), usage, cost};
}
