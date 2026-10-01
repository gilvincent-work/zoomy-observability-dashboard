// Types for the plain-JS live-eval runner, so the tests that exercise its pure functions typecheck with the rest of the project.
export const LOCAL_HOSTS: string[];
export const MECHANICAL_MIN: number;
export const RUBRIC_MIN: number;

export function assertLocalRun(env: Record<string, string | undefined>): {ok: boolean; problems: string[]};

export type EvalTier = 'smoke' | 'full' | 'majority';
export const TIERS: EvalTier[];
export const DEFAULT_TIER: EvalTier;
/** The default hard cap in US dollars for one eval campaign. */
export const DEFAULT_BUDGET_USD: number;
/** The average cost of one model loop, used only for the worst-case estimate printed before a run starts. */
export const AVG_TURN_USD: number;
/** Model loops per tier (smoke: the smoke-flagged golden cases; full: golden + probes + skill + live chain turns). */
export const PLANNED: {smoke: number; full: number};
/** The cap from a raw env value: missing, blank or invalid is the default; 0 or negative is kept (it means refuse to run). */
export function parseCapUsd(raw: unknown): number;
/** The tier from a raw env value; an unknown name falls back to smoke and is flagged `valid: false`. */
export function parseTier(raw: unknown): {tier: EvalTier; valid: boolean};
export function plannedRuns(tier: EvalTier, env?: Record<string, string | undefined>): number;
export interface EvalPlan {
  ok: boolean;
  problems: string[];
  tier: EvalTier;
  runs: number;
  loops: number;
  worstCaseUsd: number;
  capUsd: number;
  force: boolean;
}
/** The plan for this environment and whether it may start (worst case within the cap, a positive cap, a known tier, unless CHAT_EVAL_FORCE=1). */
export function planCheck(env: Record<string, string | undefined>): EvalPlan;
export function caseOutcome(c: RunCase): 'PASS' | 'FAIL' | 'UNGRADED';
/** The CHAT_LIVE_CASES ids to re-run for the majority tier: the cases that FAILED in this run. */
export function failedSelectors(run: LiveRun): string[];
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
/** cacheRead / (cacheRead + cacheWrite + input), or null when there is nothing to divide. */
export function cacheHitRatio(u: TokenUsage): number | null;

/** One case of one run, as the live test writes it. */
export interface RunCase {
  id: string;
  kind: 'golden' | 'skill' | 'probe';
  category: string;
  steps: string[];
  /** Every mechanical expectation held. */
  mech: boolean;
  failures: string[];
  /** One entry per rubric item (true = pass), or null when the wording was not graded. */
  rubric: boolean[] | null;
  /** The grader reply was truncated or unreadable: neither a pass nor a fail. */
  ungraded?: boolean;
  /** Tokens and dollars this case used (chat steps plus the grader call). */
  usage?: TokenUsage;
  cost?: number;
}

export interface LiveRun {
  model: string;
  effort: string;
  cases: RunCase[];
  chain: {mech: boolean; failures: string[]} | null;
  guard: {attemptedNonRead: number; trips: number; unknownTools: number};
  errors: number;
  totalCost: number;
  /** Figures the log-only number check flagged across the run. */
  numberViolations?: number;
  tier?: EvalTier;
  usage?: TokenUsage;
  /** The cap this run ran under, what it spent (chat and grader) and whether the cap stopped it. */
  budget?: {capUsd: number; spentUsd: number; exceeded: boolean};
  budgetExceeded?: boolean;
}

export interface Summary {
  model: string;
  effort: string;
  runs: number;
  totalCost: number;
  capUsd: number | null;
  tier: string | null;
  usage: TokenUsage;
  cacheHitRatio: number | null;
  /** Cases whose grader reply was truncated or unreadable (reported apart from pass and fail). */
  ungraded: number;
  budgetExceeded: boolean;
  cases: {
    key: string; id: string; kind: string; category: string; steps: string[]; mechPasses: number; of: number; mech: boolean; rubric: boolean[]; graded: number; failures: string[];
    outcome: 'PASS' | 'FAIL' | 'UNGRADED'; ungradedRuns: number; usage: TokenUsage; cost: number;
  }[];
  chain: {passes: number; of: number; pass: boolean; failures: string[]} | null;
  guard: {attemptedNonRead: number; trips: number; unknownTools: number; errors: number};
  numberViolations: number;
  mech: {passed: number; total: number};
  rubric: {passed: number; total: number};
  steps: Record<string, {cases: number; mech: number; rubricPassed: number; rubricTotal: number}>;
  ok: boolean;
}

export function majority(runs: LiveRun[], opts?: {capUsd?: number; tier?: string}): Summary;
export function renderTable(summary: Summary): string[];
/** The spend table: per case PASS / FAIL / UNGRADED, runs used, tokens and dollars, the total against the cap and the cache hit ratio. */
export function spendLines(summary: Summary): string[];
