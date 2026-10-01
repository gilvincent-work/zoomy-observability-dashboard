// The rule inventory for the Ask Coop Data Analyst skill (design 4d). Every `[ID]` tag in the skill markdown must be
// listed here exactly once. `enforcedBy: 'code'` rules carry the ⚙ tag in the text and need a test titled with the id.
import {SMALL_SAMPLE_N} from '../checks';

export type RuleEnforcement = 'code' | 'guide';

export const RULES: readonly {id: string; enforcedBy: RuleEnforcement; where: string}[] = [
  {id: 'THINK-01', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-02', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-03', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-04', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-05', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-06', enforcedBy: 'guide', where: 'guide'},
  {id: 'THINK-07', enforcedBy: 'guide', where: 'guide'},
  {id: 'ANL-01', enforcedBy: 'guide', where: 'guide'},
  {id: 'ANL-02', enforcedBy: 'guide', where: 'guide'},
  {id: 'ANL-03', enforcedBy: 'guide', where: 'guide'},
  {id: 'ANL-04', enforcedBy: 'guide', where: 'guide'},
  {id: 'ANL-05', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-01', enforcedBy: 'code', where: 'src/chat/metrics-registry.ts one definition per metric'},
  {id: 'BI-02', enforcedBy: 'code', where: 'src/chat/checks.ts reconciles'},
  {id: 'BI-03', enforcedBy: 'code', where: 'src/chat/metrics-registry.ts one grain, voided excluded, pick lines not summed'},
  {id: 'BI-04', enforcedBy: 'code', where: 'src/chat/checks.ts round_row_count'},
  {id: 'BI-05', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-06', enforcedBy: 'code', where: 'src/chat/query-metric.ts "No tag" bucket kept on its own'},
  {id: 'BI-07', enforcedBy: 'code', where: 'src/chat/query-metric.ts shares from unrounded values'},
  {id: 'BI-08', enforcedBy: 'code', where: 'src/chat/query-metric.ts "Showing the first N of M" caveat (claim restriction is guide)'},
  {id: 'BI-10', enforcedBy: 'code', where: 'src/chat/range.ts previous period of equal length'},
  {id: 'BI-11', enforcedBy: 'code', where: 'src/chat/query-metric.ts empty earlier period is null, never 0'},
  {id: 'BI-12', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-13', enforcedBy: 'code', where: 'src/chat/checks.ts small_sample'},
  {id: 'BI-14', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-15', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-20', enforcedBy: 'code', where: 'src/chat/metrics-registry.ts method line returned with allocated measures'},
  {id: 'BI-21', enforcedBy: 'code', where: 'src/chat/metrics-registry.ts price at the sale date'},
  {id: 'BI-22', enforcedBy: 'code', where: 'src/chat/checks.ts reconciles (allocation)'},
  {id: 'BI-23', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-24', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-25', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-30', enforcedBy: 'code', where: 'src/chat/coverage.ts source and coverage in the result'},
  {id: 'BI-31', enforcedBy: 'code', where: 'src/chat/checks.ts mock_source'},
  {id: 'BI-32', enforcedBy: 'code', where: 'src/chat/checks.ts partial_coverage'},
  {id: 'BI-33', enforcedBy: 'code', where: 'src/chat/checks.ts untagged_share'},
  {id: 'BI-34', enforcedBy: 'code', where: 'src/chat/checks.ts small_sample'},
  {id: 'BI-35', enforcedBy: 'guide', where: 'guide'},
  {id: 'BI-36', enforcedBy: 'guide', where: 'guide'},
];

/** Numbers the skill text uses as `{{NAME}}` placeholders, taken from code so the text cannot drift. */
export const SKILL_CONSTANTS: Record<string, number> = {SMALL_SAMPLE_N};

export const SKILL_TOPICS = ['bi-reconciliation', 'period-comparison', 'allocation-and-prices', 'data-quality'] as const;
