// Pure helpers for the Offline Sales → Rankings page (Top products / Top bundles
// "View all"). Kept framework-free so they unit-test without React: the client
// view (components/analyst/rankings-view.tsx) filters → sorts → paginates with
// these, reusing `paginate` from pos-sales-compute for the page math.

export type SortDir = 'top' | 'bottom'; // 'top' = best first (desc for metrics, A→Z for name)

// Page sizes offered on the Rankings page; 10 is the default (matches the
// transactions list's ORDERS_PAGE_SIZE, but kept separate so the two can diverge).
export const RANKINGS_PAGE_SIZES = [10, 25, 50] as const;
export const RANKINGS_DEFAULT_PAGE_SIZE = 10;

/** Case-insensitive substring match on `name`. Empty/whitespace query = passthrough. */
export function filterByName<T extends {name: string}>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(needle));
}

/**
 * Sort a copy of `rows` by `key`, respecting direction. Numeric keys sort by
 * magnitude ('top' = largest first); a string key (name) sorts alphabetically
 * ('top' = A→Z). Ties break by name ascending so ordering is stable and
 * deterministic across renders. Never mutates the input.
 */
export function sortRows<T extends {name: string}>(rows: T[], key: keyof T & string, dir: SortDir): T[] {
  const out = [...rows];
  const factor = dir === 'top' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    let d: number;
    if (typeof av === 'number' && typeof bv === 'number') {
      d = factor * (av - bv);
    } else {
      d = (dir === 'top' ? 1 : -1) * String(av).localeCompare(String(bv));
    }
    if (d !== 0) return d;
    return a.name.localeCompare(b.name); // stable tiebreak
  });
  return out;
}

// ── Event scope ─────────────────────────────────────────────────────────────
// The rankings page doubles as the "View all" for an event tile's Top sellers:
// `?event=<id>` scopes it to that event's sales, `&day=YYYY-MM-DD` to one of the
// event's days, and `sort` / `dir` seed the Products tab with the tile's
// Revenue/Units + Top/Bottom toggles so the full list opens the way it was left.

export type RankingsSort = 'revenue' | 'units';

export type RankingsParams = {
  tab?: 'products' | 'bundles';
  event?: string | null;
  day?: string | null;
  sort?: RankingsSort;
  dir?: SortDir;
};

/** Parse `?sort=`; anything but 'units' falls back to the default 'revenue'. */
export function parseRankingsSort(v: string | null | undefined): RankingsSort {
  return v === 'units' ? 'units' : 'revenue';
}

/** Parse `?dir=`; anything but 'bottom' falls back to the default 'top'. */
export function parseRankingsDir(v: string | null | undefined): SortDir {
  return v === 'bottom' ? 'bottom' : 'top';
}

/** A `?day=` only counts when it is one of the event's own days; else whole event. */
export function pickEventDay(day: string | null | undefined, eventDays: string[]): string | null {
  return day && eventDays.includes(day) ? day : null;
}

/**
 * Build a /offline-sales/rankings URL. Defaults are omitted (products tab,
 * revenue, top) so links stay short and the plain overview link is unchanged.
 */
export function rankingsHref(p: RankingsParams = {}): string {
  const qs = new URLSearchParams();
  if (p.tab === 'bundles') qs.set('tab', 'bundles');
  if (p.event) qs.set('event', p.event);
  if (p.event && p.day) qs.set('day', p.day);
  if (p.sort === 'units') qs.set('sort', 'units');
  if (p.dir === 'bottom') qs.set('dir', 'bottom');
  const s = qs.toString();
  return s ? `/offline-sales/rankings?${s}` : '/offline-sales/rankings';
}
