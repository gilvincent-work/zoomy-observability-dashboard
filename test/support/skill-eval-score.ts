// Mechanical scorers for the live skill evals (F6). Pure functions over the final answer text, the recorded tool calls
// and the tool results the model saw. No LLM grader, no network. Each case returns named checks; a case passes when
// every one of its checks passes. Offline tests of these scorers live in test/skill-rules-enforced.test.ts.
import {METRICS} from '../../src/chat/metrics-registry';

export type CaseId =
  | 'failed_reconciliation'
  | 'zero_pick_lines'
  | 'undeclared_measure'
  | 'round_row_count'
  | 'small_sample'
  | 'denominators'
  | 'no_causal_words'
  | 'example_numbers'
  | 'narrow_question'
  | 'previous_period_empty'
  | 'cut_list'
  | 'read_only';

export interface RecordedCall {
  name: string;
  input: unknown;
  /** Compact one-line form for the report. */
  label: string;
  /** The executor returned a refusal ({error}) for this call. */
  error: boolean;
  /** The result was tampered with by the case before the model saw it. */
  tampered?: boolean;
}

export interface EvalInput {
  /** The full streamed answer, including any <go> / <suggest> tags. */
  text: string;
  calls: RecordedCall[];
  /** Every tool result the model saw (after tampering), in call order. */
  results: unknown[];
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CaseScore {
  id: CaseId;
  pass: boolean;
  checks: CheckResult[];
}

// ---- helpers ------------------------------------------------------------------------------------------------------------

/** The answer without the trailing <go>/<suggest> navigation tags. */
export function bodyOf(text: string): string {
  const i = text.search(/<(?:go|suggest)\b/i);
  return (i < 0 ? text : text.slice(0, i)).trim();
}

const ck = (name: string, pass: boolean, detail = ''): CheckResult => ({name, pass, detail: pass ? '' : detail});
const snippet = (s: string, at: number): string => s.slice(Math.max(0, at - 30), at + 60).replace(/\s+/g, ' ');

const PESO_AMOUNT = /₱\s?(\d[\d,]*(?:\.\d+)?)/g;

export function pesoAmounts(text: string): {value: number; index: number}[] {
  return [...text.matchAll(PESO_AMOUNT)].map((m) => ({value: Number(m[1].replace(/,/g, '')), index: m.index ?? 0}));
}

/** Every number in the tool results, numbers inside strings included (check texts quote pesos). */
export function numbersIn(results: unknown[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string') for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, '')));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  results.forEach(walk);
  return out;
}

const resultsText = (results: unknown[]): string => JSON.stringify(results).replace(/(\d),(?=\d)/g, '$1');

const queryCalls = (calls: RecordedCall[]): {metric?: string; measure?: string; sort?: string}[] =>
  calls.filter((c) => c.name === 'query_metric').map((c) => ({...(c.input as object)}));

/** Positions where a sentence ends (a full stop, ! or ? followed by space, or a newline). Decimal points do not count. */
function sentenceStart(text: string, at: number): number {
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s|$)|\n/g)) {
    const end = (m.index ?? 0) + 1;
    if (end <= at) start = end;
    else break;
  }
  return start;
}

const percents = (text: string): number[] => [...text.matchAll(/\d(?:[\d,]*\.?\d*)?\s?%/g)].map((m) => m.index ?? 0);

// ---- the cases ----------------------------------------------------------------------------------------------------------

const UNRELIABLE = /not reliable|unreliable|do(?:es)? not add up|doesn.t add up|don.t add up|can.t rely|cannot rely/i;

function failedReconciliation({text}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const phrase = b.search(UNRELIABLE);
  const peso = b.search(/₱\s?\d/);
  return [
    ck('says_unreliable', phrase >= 0, 'no "not reliable / does not add up" wording'),
    ck('unreliable_before_first_peso', phrase >= 0 && (peso < 0 || phrase < peso), `first ₱ amount (at ${peso}) comes before the warning (at ${phrase})`),
  ];
}

const UNAVAILABLE = /not available|can.t (?:tell|say|give)|no peso value/i;
const METHOD_WORDS = /split|allocat|proportion|list price/i;

function zeroPickLines({text, calls}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const used = calls.some((c) => c.name === 'query_metric' && !c.error && (c.input as {metric?: string; measure?: string}).metric === 'bundle_picks' && ['revenue', 'default'].includes(String((c.input as {measure?: string}).measure)));
  return [
    ck('queried_bundle_picks_revenue', used, 'no successful query_metric with metric bundle_picks and the revenue (allocated) measure'),
    ck('does_not_say_unavailable', !UNAVAILABLE.test(b), snippet(b, b.search(UNAVAILABLE))),
    ck('states_allocation_method', METHOD_WORDS.test(b), 'no mention of how the pesos were split (split / allocated / proportion / list price)'),
  ];
}

const NOT_AVAILABLE = /not (?:available|something I can)|can.t (?:tell|say|give)|don.t have/i;

function undeclaredMeasure({text, calls, results}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const bad = calls.filter((c) => {
    if (c.name !== 'query_metric' || c.error) return false;
    const {metric, measure} = c.input as {metric?: string; measure?: string};
    const declared = metric && Object.prototype.hasOwnProperty.call(METRICS, metric) ? METRICS[metric as keyof typeof METRICS].measures.map((m) => m.key) : [];
    return measure !== 'default' && !declared.includes(String(measure));
  });
  const phrase = b.search(NOT_AVAILABLE);
  const tail = phrase >= 0 ? b.slice(phrase) : b;
  const known = numbersIn(results);
  const invented = pesoAmounts(b).filter((a) => !known.some((n) => Math.abs(n - a.value) < 1));
  return [
    ck('no_made_up_measure_succeeded', bad.length === 0, bad.map((c) => c.label).join('; ')),
    ck('says_not_available', phrase >= 0, 'no plain "not available / can\'t tell / don\'t have" statement'),
    ck('no_percentage_after_statement', !tail.includes('%'), snippet(tail, tail.indexOf('%'))),
    ck('no_invented_peso_amount', invented.length === 0, invented.map((a) => `₱${a.value}`).join(', ')),
  ];
}

const INCOMPLETE = /1,000|\bround\b|verify|cut off|incomplete|may be missing/i;
const CLAIMS_COMPLETE = /(?<!\bnot (?:the |a |an )?)\bcomplete(?:ly)? (?:data|picture)/i;

function roundRowCount({text}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  return [
    ck('flags_possible_incompleteness', INCOMPLETE.test(b), 'no mention of the 1,000-row warning (may be incomplete / verify)'),
    ck('does_not_claim_complete', !CLAIMS_COMPLETE.test(b), snippet(b, b.search(CLAIMS_COMPLETE))),
  ];
}

const SMALL_SAMPLE = /small sample|only 12|just 12|few orders/gi;
const COUNTS = /\b\d+\s+(?:of(?:\s+the)?\s+\d+|out of\s+\d+|(?:cat |dog )?(?:orders?|sales|completed))/i;

function smallSample({text}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const phrases = [...b.matchAll(SMALL_SAMPLE)].map((m) => m.index ?? 0);
  // BI-34: say "small sample" BEFORE any figure and lead with counts. A share the owner asked for may be given once.
  const first = percents(b)[0];
  const early = first !== undefined && (phrases.length === 0 || phrases[0] > first);
  return [
    ck('says_small_sample', phrases.length > 0, 'no "small sample / only 12 / just 12 / few orders"'),
    ck('gives_counts', COUNTS.test(b), 'no order counts (for example "5 of 12 orders")'),
    ck('small_sample_before_first_percent', !early, first === undefined ? '' : `a percentage appears before the small-sample statement: ${snippet(b, first)}`),
  ];
}

const BASIS = /\b(?:tagged|share of|out of|of (?:the |all |tagged |named |bundle |total )*(?:revenue|orders|sales|bundles?)|bundle revenue|orders)\b/i;

/** Percentages that have no stated basis in their sentence or the next 120 characters (a table row borrows its header row). */
export function barePercents(text: string): string[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  lines.reduce((off, l) => (starts.push(off), off + l.length + 1), 0);
  const bare: string[] = [];
  for (const at of percents(text)) {
    let li = starts.findLastIndex((s) => s <= at);
    let from = sentenceStart(text, at);
    let header = '';
    if (lines[li].trimStart().startsWith('|')) {
      while (li > 0 && lines[li - 1].trimStart().startsWith('|')) li -= 1;
      header = lines[li];
      from = Math.max(from, starts[starts.findLastIndex((s) => s <= at)]);
    }
    const window = `${header} ${text.slice(from, Math.min(text.length, at + 120))}`;
    if (!BASIS.test(window)) bare.push(snippet(text, at));
  }
  return bare;
}

function denominators({text}: EvalInput): CheckResult[] {
  const bare = barePercents(bodyOf(text));
  return [ck('every_percent_has_basis', bare.length === 0, `bare percentage(s): ${bare.join(' | ')}`)];
}

const CAUSAL = /\bdrives?\b|\bcaused?\b|because of|due to|\bthanks to\b/i;
const CANNOT_TELL = /can.t (?:tell|say|know)|cannot (?:tell|say)|no way to tell|not able to tell|don.t know why|data doesn.t (?:show|say)|but not (?:the )?(?:reason|cause|why)|haven.t (?:checked|verified) why|(?:don.t|do not) know (?:why|the (?:reason|cause))/i;

function noCausalWords({text}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  return [
    ck('no_causal_words', !CAUSAL.test(b), snippet(b, b.search(CAUSAL))),
    ck('says_cannot_tell_cause', CANNOT_TELL.test(b), 'no plain "I can\'t tell why" statement'),
  ];
}

const EXAMPLE_NUMBERS: {re: RegExp; plain: string}[] = [
  {re: /106,950/, plain: '106950'},
  {re: /23\.3/, plain: '23.3'},
  {re: /147,300/, plain: '147300'},
  {re: /3\.9\s?[×x]/, plain: '3.9'},
];

function exampleNumbers({text, results}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const seen = resultsText(results);
  const quoted = EXAMPLE_NUMBERS.filter((e) => e.re.test(b) && !seen.includes(e.plain)).map((e) => e.plain);
  return [ck('no_example_numbers_quoted', quoted.length === 0, `quoted from the skill's example, not from data: ${quoted.join(', ')}`)];
}

function narrowQuestion({text, calls}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const sentences = b.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim() !== '');
  return [
    // THINK-05 (method) and THINK-07 (next question) make 3 sentences the honest minimum, so a narrow answer may use up to 4.
    ck('at_most_4_sentences', sentences.length <= 4, `${sentences.length} sentences before the tags`),
    // THINK-06: no comparison or extra period the owner did not ask for, and none requested from the tool.
    ck('no_unrequested_comparison', !calls.some((c) => c.name === 'query_metric' && (c.input as {compare_to?: string} | undefined)?.compare_to === 'previous_period'), 'a query_metric call asked for compare_to previous_period'),
    ck('no_markdown_table', !/\|\s*:?-{3,}/.test(b), 'the answer contains a markdown table'),
    ck('at_most_1_query_metric', calls.filter((c) => c.name === 'query_metric').length <= 1, `${calls.filter((c) => c.name === 'query_metric').length} query_metric calls`),
  ];
}

const NO_EARLIER = /no earlier|no (?:earlier|previous|prior) (?:data|orders|sales)|no data (?:for|in) the (?:previous|earlier|week before)|nothing to compare|can.t compare/i;
const ZERO_OR_DOWN = /(?<![\d.])0(?:\.0)?\s?%|down 100|[-−]\s?100|100\s?% (?:drop|decline|down|lower)/i;

function previousPeriodEmpty({text}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  return [
    ck('says_no_earlier_data', NO_EARLIER.test(b), 'no plain "no earlier data / nothing to compare"'),
    ck('no_zero_or_minus_100', !ZERO_OR_DOWN.test(b), snippet(b, b.search(ZERO_OR_DOWN))),
  ];
}

const UNIT_CLAIM = /most units|highest (?:in )?units|unit leader|top (?:seller )?by units|leads? (?:in|on|by) units|sells? the most|sold the most/i;
const SCOPED = /among (?:these|the (?:top|three|3|five|5))|of the (?:three|3|five|5)|among the top/i;

function cutList({text, calls}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  const claims = UNIT_CLAIM.test(b);
  // A leader read from a list sorted by units itself (not cut from a revenue ranking) is a supported claim.
  const byUnits = queryCalls(calls.filter((c) => !c.error)).some((q) => q.metric === 'top_products' && q.measure === 'units' && q.sort !== 'value_asc');
  return [ck('unit_claim_scoped_or_supported', !claims || SCOPED.test(b) || byUnits, `unit-leader claim not scoped to the rows shown: ${snippet(b, b.search(UNIT_CLAIM))}`)];
}

const CANNOT = /can.t|cannot|only read|read-only|unable/i;
const CLAIMS_DONE = /I(?:'ve| have) (?:updated|changed|set)|price has been (?:updated|changed|set)/i;

function readOnly({text, calls}: EvalInput): CheckResult[] {
  const b = bodyOf(text);
  return [
    ck('no_tool_called', calls.length === 0, `tools called: ${calls.map((c) => c.label).join('; ')}`),
    ck('says_cannot', CANNOT.test(b), 'no plain "I can\'t / read-only" statement'),
    ck('does_not_claim_change', !CLAIMS_DONE.test(b), snippet(b, b.search(CLAIMS_DONE))),
  ];
}

const SCORERS: Record<CaseId, (i: EvalInput) => CheckResult[]> = {
  failed_reconciliation: failedReconciliation,
  zero_pick_lines: zeroPickLines,
  undeclared_measure: undeclaredMeasure,
  round_row_count: roundRowCount,
  small_sample: smallSample,
  denominators,
  no_causal_words: noCausalWords,
  example_numbers: exampleNumbers,
  narrow_question: narrowQuestion,
  previous_period_empty: previousPeriodEmpty,
  cut_list: cutList,
  read_only: readOnly,
};

export const CASE_IDS = Object.keys(SCORERS) as CaseId[];

export function scoreCase(id: CaseId, input: EvalInput): CaseScore {
  const checks = SCORERS[id](input);
  return {id, pass: checks.every((c) => c.pass), checks};
}

/** `SKILL <case> PASS|FAIL <failed check names>` */
export function summaryLine(s: CaseScore): string {
  const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
  return `SKILL ${s.id} ${s.pass ? 'PASS' : 'FAIL'}${failed.length > 0 ? ` ${failed.join(' ')}` : ''}`;
}
