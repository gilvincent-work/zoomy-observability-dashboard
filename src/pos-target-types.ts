// Shapes for the gamified daily-target health bar (Phase 5 Surface E). The
// target is an owner-set daily revenue goal stored in pos_settings; progress is
// today's POS revenue against it, computed for the Asia/Manila calendar day.

/** The owner-set daily revenue goal, read from pos_settings. */
export interface DailyTarget {
  amount: number; // peso goal for the day; 0 means "no target set yet"
  updated_at: string | null; // ISO of the last edit, or null (seed / mock)
}

/** Color/urgency tiers for the bar fill, from behind to goal reached. */
export type TargetTier = 'low' | 'mid' | 'high' | 'goal';

/** Today's revenue measured against the target: everything the bar renders. */
export interface DailyProgress {
  revenue: number; // today's revenue (Asia/Manila day), voided sales excluded
  target: number; // the goal amount (0 when unset)
  hasTarget: boolean; // target > 0
  pct: number; // 0..100, clamped for the fill width
  rawPct: number; // uncapped; can exceed 100 once the goal is beaten
  remaining: number; // >= 0; peso left to reach the goal (0 once reached)
  reached: boolean; // revenue >= target (and a target exists)
  tier: TargetTier;
}
