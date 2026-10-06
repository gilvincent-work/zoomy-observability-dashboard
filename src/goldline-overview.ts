// Pure rollups behind the Goldline Overview page (no I/O, so it's unit-testable).
// gl_sales arrives as one row per store × SKU × period; the POS export is periodic
// (semi-monthly), so "this window" = the latest period and the delta compares it
// to the period just before it. Categories come from the gl_products crosswalk
// (POS sku_code → product_line); SKUs not mapped yet roll into "Uncategorized".

export type OverviewSaleRow = {
  sku_code: string;
  gross: number;
  units: number;
  net: number;
  period_start: string | null;
  period_end: string | null;
};

export type OverviewKpi = {current: number; prior: number | null; deltaPct: number | null};

export type OverviewCategory = {name: string; net: number; uncategorized: boolean};

export type GoldlineOverview = {
  hasSales: boolean;
  window: {start: string | null; end: string | null};
  hasPrior: boolean;
  net: OverviewKpi;
  units: OverviewKpi;
  gross: OverviewKpi;
  categories: OverviewCategory[]; // net desc, current window only
  unmappedSkus: number; // distinct SKUs in the window with no product_line
};

export const UNCATEGORIZED = 'Uncategorized';

const periodKey = (r: OverviewSaleRow) => `${r.period_start ?? ''}|${r.period_end ?? ''}`;

/** Percent change rounded to one decimal; null when there's nothing to compare to. */
export function deltaPct(current: number, prior: number | null): number | null {
  if (prior == null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export function buildOverview(rows: OverviewSaleRow[], lineBySku: Map<string, string>): GoldlineOverview {
  // Distinct periods, latest first (by end date, then start date).
  const periods = new Map<string, {start: string | null; end: string | null}>();
  for (const r of rows) periods.set(periodKey(r), {start: r.period_start, end: r.period_end});
  const ordered = [...periods.entries()].sort(([, a], [, b]) => {
    const e = (b.end ?? '').localeCompare(a.end ?? '');
    return e !== 0 ? e : (b.start ?? '').localeCompare(a.start ?? '');
  });
  const [currentKey, current] = ordered[0] ?? [null, {start: null, end: null}];
  const priorKey = ordered[1]?.[0] ?? null;

  const sum = (key: string | null) => {
    const t = {net: 0, units: 0, gross: 0};
    if (key == null) return t;
    for (const r of rows) {
      if (periodKey(r) !== key) continue;
      t.net += r.net;
      t.units += r.units;
      t.gross += r.gross;
    }
    return t;
  };
  const cur = sum(currentKey);
  const pri = priorKey != null ? sum(priorKey) : null;
  const kpi = (k: 'net' | 'units' | 'gross'): OverviewKpi => ({
    current: cur[k],
    prior: pri ? pri[k] : null,
    deltaPct: deltaPct(cur[k], pri ? pri[k] : null),
  });

  // Categories for the current window.
  const byLine = new Map<string, number>();
  const unmapped = new Set<string>();
  for (const r of rows) {
    if (periodKey(r) !== currentKey) continue;
    const line = lineBySku.get(r.sku_code)?.trim();
    if (!line) unmapped.add(r.sku_code);
    const name = line || UNCATEGORIZED;
    byLine.set(name, (byLine.get(name) ?? 0) + r.net);
  }
  const categories = [...byLine.entries()]
    .map(([name, net]) => ({name, net, uncategorized: name === UNCATEGORIZED}))
    .filter((c) => c.net > 0)
    // Real categories first by value; the Uncategorized catch-all always sinks last.
    .sort((a, b) => Number(a.uncategorized) - Number(b.uncategorized) || b.net - a.net);

  return {
    hasSales: rows.length > 0,
    window: current,
    hasPrior: priorKey != null,
    net: kpi('net'),
    units: kpi('units'),
    gross: kpi('gross'),
    categories,
    unmappedSkus: unmapped.size,
  };
}

/** "Good morning" / "Good afternoon" / "Good evening" for an hour 0–23. */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
