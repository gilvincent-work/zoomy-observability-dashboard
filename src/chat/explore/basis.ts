// Evidence notes for an Explore result, written by CODE from the parsed query and fixed coverage figures, never by the model (spec R6).
// Pure. The sentences are part of the result's caveats and coverage_note, so the model sees them and quoting their figures is not a new claim.
import type {ValidateOk} from './types';

export const ORDERS_BY_TAG_NOTE = 'Orders counted are those tagged to the event in the POS (untagged sales on the event dates are not included).';
export const ORDERS_BY_DATE_NOTE = 'Orders attributed to the event by date window (includes untagged sales rung up on the event dates).';

export interface LeadFacts {
  count: number;
  withPet: number;
  /** Manila date (YYYY-MM-DD) of the earliest lead that has a pet value, or null when none has. */
  petFrom: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
};

/** How many leads exist, how many carry a pet value, and since when the pet field was collected (all leads in the view, not only this result's scope). */
export function leadsCoverageNote(f: LeadFacts): string {
  const from = f.petFrom ? dayLabel(f.petFrom) : null;
  return `${f.count} lead${f.count === 1 ? '' : 's'} in the leads view, ${f.withPet} with a pet value${from ? ` (pet was only collected from ${from})` : ''}.`;
}

/** Orders joined to events: say whether orders were counted by the POS event tag (orders.event_id), by the event date window (starts_on / ends_on), or both. */
export function ordersBasisNotes(v: Pick<ValidateOk, 'relations' | 'columnRefs'>): string[] {
  if (!v.relations.includes('coop_explore_orders') || !v.relations.includes('coop_explore_events')) return [];
  const byTag = v.columnRefs.some((c) => c.relation === 'coop_explore_orders' && c.column === 'event_id');
  const byDate = v.columnRefs.some((c) => c.column === 'starts_on' || c.column === 'ends_on');
  return [...(byTag ? [ORDERS_BY_TAG_NOTE] : []), ...(byDate ? [ORDERS_BY_DATE_NOTE] : [])];
}
