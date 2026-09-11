import type {PosOrder} from './pos-sales-types';
import type {DailyProgress, TargetTier} from './pos-target-types';
import {computeKpis} from './pos-sales-compute';

// Pure helpers for the daily-target health bar. No server/client concerns so
// they're unit-testable and shared. "Today" is the Asia/Manila calendar day
// (UTC+8, no DST) so the goal resets at local midnight, matching how an owner
// thinks about a bazaar day. This is deliberately independent of the Offline
// Sales range tabs, which still use UTC (see COOP_INTEGRATION_PLAN.md Surface E).

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8, fixed year-round

/**
 * The UTC instant at which the current Asia/Manila calendar day began. Shift
 * `now` into Manila wall-clock, truncate to midnight, then shift back to UTC.
 */
export function manilaDayStart(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + MANILA_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MANILA_OFFSET_MS);
}

/** Sum of today's (Manila-day) revenue; voided sales excluded via computeKpis. */
export function todaysRevenue(orders: PosOrder[], now: Date = new Date()): number {
  const startIso = manilaDayStart(now).toISOString();
  const todays = orders.filter((o) => o.created_at >= startIso);
  return computeKpis(todays).revenue;
}

// Tier thresholds as a percentage of the target (rawPct). Below `low` the bar is
// red, then amber, then near-goal, then green once reached.
export const TARGET_TIER_PCT = {mid: 40, high: 75} as const;

function tierFor(rawPct: number, hasTarget: boolean): TargetTier {
  if (!hasTarget) return 'low';
  if (rawPct >= 100) return 'goal';
  if (rawPct >= TARGET_TIER_PCT.high) return 'high';
  if (rawPct >= TARGET_TIER_PCT.mid) return 'mid';
  return 'low';
}

/** Build the full progress view of `revenue` against `target`. */
export function progress(revenue: number, target: number): DailyProgress {
  const hasTarget = target > 0;
  const rawPct = hasTarget ? (revenue / target) * 100 : 0;
  const pct = Math.max(0, Math.min(100, rawPct));
  const remaining = hasTarget ? Math.max(0, target - revenue) : 0;
  const reached = hasTarget && revenue >= target;
  return {revenue, target, hasTarget, pct, rawPct, remaining, reached, tier: tierFor(rawPct, hasTarget)};
}
