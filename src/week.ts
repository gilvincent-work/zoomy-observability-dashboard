import type {DigestArchiveRow} from './types';

// Resolve which week (archive row) is selected from the `?week=<window_from>` URL
// param. Falls back to the first (newest) row. Pure — shared by the server pages.
export function pickIndex(digests: DigestArchiveRow[], week?: string): number {
  if (!week) return 0;
  const i = digests.findIndex((d) => d.window_from === week);
  return i >= 0 ? i : 0;
}

const RANGE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function isoDay(iso: string): {m: number; d: number; y: number} | null {
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return mm ? {y: Number(mm[1]), m: Number(mm[2]) - 1, d: Number(mm[3])} : null;
}

/**
 * The actual data window as a human range, e.g. "Jul 4 – Aug 2, 2026" (or
 * "Jul 4 – 30, 2026" when the same month, "Dec 28, 2025 – Jan 3, 2026" across a
 * year). Falls back to the digest's own label when the ISO bounds are missing.
 */
export function fmtRange(from: string, to: string, fallback = ''): string {
  const a = isoDay(from);
  const b = isoDay(to);
  if (!a || !b) return fallback;
  const left = a.y === b.y
    ? a.m === b.m
      ? `${RANGE_MONTHS[a.m]} ${a.d}`
      : `${RANGE_MONTHS[a.m]} ${a.d}`
    : `${RANGE_MONTHS[a.m]} ${a.d}, ${a.y}`;
  const right = a.m === b.m && a.y === b.y ? `${b.d}` : `${RANGE_MONTHS[b.m]} ${b.d}`;
  return `${left} – ${right}, ${b.y}`;
}
