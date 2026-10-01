// Types for the plain-JS live-eval runner, so the tests that exercise its pure functions typecheck with the rest of the project.
export const LOCAL_HOSTS: string[];
export const MECHANICAL_MIN: number;
export const RUBRIC_MIN: number;

export function assertLocalRun(env: Record<string, string | undefined>): {ok: boolean; problems: string[]};

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
}

export interface Summary {
  model: string;
  effort: string;
  runs: number;
  totalCost: number;
  cases: {key: string; id: string; kind: string; category: string; steps: string[]; mechPasses: number; of: number; mech: boolean; rubric: boolean[]; graded: number; failures: string[]}[];
  chain: {passes: number; of: number; pass: boolean; failures: string[]} | null;
  guard: {attemptedNonRead: number; trips: number; unknownTools: number; errors: number};
  numberViolations: number;
  mech: {passed: number; total: number};
  rubric: {passed: number; total: number};
  steps: Record<string, {cases: number; mech: number; rubricPassed: number; rubricTotal: number}>;
  ok: boolean;
}

export function majority(runs: LiveRun[]): Summary;
export function renderTable(summary: Summary): string[];
