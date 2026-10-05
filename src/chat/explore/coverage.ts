// The per-turn Explore coverage line (spec 6.7). One FIXED statement, validated like any other, run once a minute per instance. Real figures live
// in the per-turn preamble (never the cached prefix), so they cannot go stale. If it fails the line is omitted and one log line is written.
import {logExploreEvent, type AuditSink} from '../audit';
import type {RunQuery} from './executor';
import type {ExploreLimits, ValidateErr, ValidateOk} from './types';

export const EXPLORE_COVERAGE_SQL = `with oc as (
  select min((o.created_at at time zone 'Asia/Manila')::date) filter (where o.status = 'completed') as orders_from,
         max((o.created_at at time zone 'Asia/Manila')::date) filter (where o.status = 'completed') as orders_to,
         count(*) filter (where o.status = 'completed') as completed_count,
         count(*) filter (where o.status = 'voided') as voided_count
  from coop_explore_orders o
), pf as (
  select min(o.created_at) as first_tagged,
         min((o.created_at at time zone 'Asia/Manila')::date) as first_tagged_day
  from coop_explore_orders o
  where o.status = 'completed' and o.pet_type is not null
), pt as (
  select count(*) as since_count, count(o.pet_type) as since_tagged
  from coop_explore_orders o
  join pf on o.created_at >= pf.first_tagged
  where o.status = 'completed'
), lc as (
  select min((l.collected_at at time zone 'Asia/Manila')::date) as leads_from,
         max((l.collected_at at time zone 'Asia/Manila')::date) as leads_to,
         count(*) as leads_count
  from coop_explore_event_leads l
)
select oc.orders_from, oc.orders_to, oc.completed_count, oc.voided_count, pf.first_tagged_day, pt.since_count, pt.since_tagged, lc.leads_from, lc.leads_to, lc.leads_count
from oc join pf on oc.completed_count >= 0 join pt on oc.completed_count >= 0 join lc on oc.completed_count >= 0`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Pure: the one-row result of EXPLORE_COVERAGE_SQL (in column order) -> the preamble line, or null when there is nothing to say. */
export function coverageLine(row: unknown[]): string | null {
  const [from, to, completed, voided, taggedDay, sinceCount, sinceTagged, lFrom, lTo, leads] = row;
  const parts: string[] = [];
  const d1 = day(from);
  const d2 = day(to);
  if (d1 && d2) parts.push(`Orders from ${d1} to ${d2} (${num(completed) ?? 0} completed, ${num(voided) ?? 0} voided)`);
  const d3 = day(taggedDay);
  const sc = num(sinceCount);
  const st = num(sinceTagged);
  if (d3 && sc && st !== null) parts.push(`pet tagged on ${Math.round((st / sc) * 100)}% of completed orders since ${d3}`);
  const d4 = day(lFrom);
  const d5 = day(lTo);
  if (d4 && d5) parts.push(`event leads from ${d4} to ${d5} (${num(leads) ?? 0} sign-ups, booth leads, not buyers)`);
  return parts.length ? `[explore coverage] ${parts.join('; ')}.` : null;
}

export interface CoverageDeps {
  runQuery: RunQuery;
  validate: (sql: unknown, limits?: Partial<ExploreLimits>) => Promise<ValidateOk | ValidateErr>;
  limits: ExploreLimits;
  sink?: AuditSink;
  clock?: () => number;
}

const TTL_MS = 60_000;
let memo: {at: number; line: string | null} | null = null;
export const resetCoverageCache = (): void => {
  memo = null;
};

/** The line for the preamble, cached for one minute per instance. Never throws; a failure logs chat_explore_coverage_failed and returns null. */
export async function loadCoverageLine(deps: CoverageDeps): Promise<string | null> {
  const now = (deps.clock ?? Date.now)();
  if (memo && now - memo.at < TTL_MS) return memo.line;
  try {
    const v = await deps.validate(EXPLORE_COVERAGE_SQL, deps.limits);
    if (!v.ok) throw new Error(v.code);
    const raw = await deps.runQuery(v.sent, {timeoutMs: deps.limits.timeoutMs, maxRows: 1});
    const line = raw.rows[0] ? coverageLine(raw.rows[0]) : null;
    memo = {at: now, line};
    return line;
  } catch (e) {
    logExploreEvent('chat_explore_coverage_failed', {code: e instanceof Error && /^E_[A-Z_]+$/.test(e.message) ? e.message : 'failed'}, deps.sink);
    return null;
  }
}
