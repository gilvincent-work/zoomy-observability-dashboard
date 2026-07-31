import type {Category} from './salesSignals';

// Store-level preferences (single-owner product). MOCK FLOW: persisted in the
// browser (localStorage) for now — the real version stores a `store_preferences`
// row server-side and the batch job reads it (needs best-practices/preferences-store.md
// before that wiring). Shapes here are the contract that real persistence will fill.

export type Focus = 'mute' | 'normal' | 'emphasize';
export type Cadence = 'weekly' | 'biweekly';

export interface StorePreferences {
  contentFocus: Record<Category, Focus>; // emphasize / mute insight categories
  delivery: {cadence: Cadence; day: string; time: string; recipients: string[]};
  thresholds: {stockoutDays: number; churnPct: number; revenueDropPct: number};
  channels: {email: boolean; slack: boolean};
}

export const DEFAULT_PREFERENCES: StorePreferences = {
  contentFocus: {inventory: 'normal', crm: 'normal', revenue: 'normal', traffic: 'normal'},
  delivery: {cadence: 'weekly', day: 'Monday', time: '08:00', recipients: ['owner@zoomy.example']},
  thresholds: {stockoutDays: 7, churnPct: 10, revenueDropPct: 15},
  channels: {email: true, slack: false},
};

export const STORAGE_KEY = 'zoomy.preferences.v1';
export const FOCUS_ORDER: Focus[] = ['mute', 'normal', 'emphasize'];
export const CATEGORY_ORDER: Category[] = ['inventory', 'crm', 'revenue', 'traffic'];

/**
 * Merge a possibly-partial / possibly-stale stored value onto the defaults so a
 * schema change (or hand-edited storage) can never crash the UI. Pure.
 */
export function mergePreferences(raw: unknown): StorePreferences {
  const d = DEFAULT_PREFERENCES;
  if (!raw || typeof raw !== 'object') return d;
  const p = raw as Partial<StorePreferences>;
  return {
    contentFocus: {...d.contentFocus, ...(p.contentFocus ?? {})},
    delivery: {...d.delivery, ...(p.delivery ?? {}), recipients: p.delivery?.recipients ?? d.delivery.recipients},
    thresholds: {...d.thresholds, ...(p.thresholds ?? {})},
    channels: {...d.channels, ...(p.channels ?? {})},
  };
}

/** Parse a comma/newline-separated string into a de-duped list of trimmed emails. */
export function parseRecipients(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));
}
