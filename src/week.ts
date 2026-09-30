import type {DigestArchiveRow} from './types';

// Resolve which week (archive row) is selected from the `?week=<window_from>` URL
// param. Falls back to the first (newest) row. Pure — shared by the server pages.
export function pickIndex(digests: DigestArchiveRow[], week?: string): number {
  if (!week) return 0;
  const i = digests.findIndex((d) => d.window_from === week);
  return i >= 0 ? i : 0;
}

/**
 * A period is empty only when it has no sales data from any channel. The batch's
 * `degraded` flag means "no PawPal chats scanned", which says nothing about sales —
 * a week with zero chats but full Shopee/Lazada/website numbers is a normal week.
 */
export function hasNoSalesData(row: DigestArchiveRow): boolean {
  const d = row.digest;
  return !(d.sales || d.shopee || d.lazada || (d.comparison && Object.keys(d.comparison).length));
}

/** Weekly (≤ 8 days) vs monthly period, from the window's length. */
export function periodKind(row: DigestArchiveRow): 'weekly' | 'monthly' {
  const days = (Date.parse(row.window_to) - Date.parse(row.window_from)) / 86_400_000;
  return days <= 8 ? 'weekly' : 'monthly';
}

const RANGE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PHT_MS = 8 * 3_600_000;
// Timestamps are read as PHT calendar days. An end bound at exactly PHT midnight is
// exclusive (the batch's [from, to) windows), so it shows as the day before.
// Date-only strings ("2026-08-13", custom ranges) are already inclusive PHT days.
function isoDay(iso: string, end = false): {m: number; d: number; y: number} | null {
  const s = String(iso ?? '');
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!mm) return null;
  const t = s.length > 10 ? Date.parse(s) : NaN;
  if (Number.isNaN(t)) return {y: Number(mm[1]), m: Number(mm[2]) - 1, d: Number(mm[3])};
  let p = t + PHT_MS;
  if (end && p % 86_400_000 === 0) p -= 1;
  const dt = new Date(p);
  return {y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate()};
}

/**
 * The actual data window as a human range, e.g. "Jul 4 – Aug 2, 2026" (or
 * "Jul 4 – 30, 2026" when the same month, "Dec 28, 2025 – Jan 3, 2026" across a
 * year). Falls back to the digest's own label when the ISO bounds are missing.
 */
export function fmtRange(from: string, to: string, fallback = ''): string {
  const a = isoDay(from);
  const b = isoDay(to, true);
  if (!a || !b) return fallback;
  const left = a.y === b.y
    ? a.m === b.m
      ? `${RANGE_MONTHS[a.m]} ${a.d}`
      : `${RANGE_MONTHS[a.m]} ${a.d}`
    : `${RANGE_MONTHS[a.m]} ${a.d}, ${a.y}`;
  const right = a.m === b.m && a.y === b.y ? `${b.d}` : `${RANGE_MONTHS[b.m]} ${b.d}`;
  return `${left} – ${right}, ${b.y}`;
}
