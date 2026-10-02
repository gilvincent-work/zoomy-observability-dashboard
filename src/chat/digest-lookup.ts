// F10: the shaping behind get_digest and lookup_product. Pure: rows and data are injected, nothing is read here.
// Both return a MetricResult (so the render tools can draw it) or a steering {error}. The model never computes a figure:
// digest values are passed through as published (money and percents pre-formatted by label), product figures are counted here.
// Design: knowledge/architecture/2026-10-01-talk-to-data-design.md Slice 5.
import {formatPeso} from '../pos-format';
import {manilaDayKey} from '../pos-sales-compute';
import type {DigestFigure} from '../types';
import {phtDate} from './coverage';
import type {DigestRow} from './read/digest';
import type {Check, MeasureDecl, MetricData, MetricError, MetricResult, MetricRow, ResultColumn} from './result-types';

// ---- shared ---------------------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (items: readonly string[]): string => items.join(', ');
const fail = (error: string): MetricError => ({error});
const dayOf = (iso: string): string => iso.slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const col = (key: string, label: string, unit: ResultColumn['unit'], role: ResultColumn['role']): ResultColumn => ({key, label, unit, role});

// ---- get_digest -----------------------------------------------------------------------------------------------------

export const DIGEST_WINDOWS = ['latest', 'previous', 'recent_weeks'] as const;
export const DIGEST_SECTIONS = ['comparison', 'figures', 'sales', 'customers', 'shopee', 'lazada', 'products', 'weekly_revenue'] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];
/** A stored digest this old or older (days since its window ended) is flagged as stale. A weekly digest plus two days of grace. */
export const DIGEST_STALE_DAYS = 9;

export interface DigestSource {
  source: 'live' | 'mock';
  rows: DigestRow[];
}

const FIGURE_COLUMNS: ResultColumn[] = [
  col('area', 'Area', 'text', 'category'),
  col('figure', 'Figure', 'text', 'category'),
  col('value', 'Value', 'text', 'category'), // pre-formatted: the digest mixes pesos, counts and percents in one list
  col('basis', 'Time basis', 'text', 'category'),
];
const COMPARISON_COLUMNS: ResultColumn[] = [
  col('channel', 'Channel', 'text', 'category'),
  col('revenue', 'Revenue', 'PHP', 'measure'),
  col('orders', 'Orders', 'count', 'measure'),
  col('aov', 'Average order value', 'PHP', 'measure'),
  col('units', 'Units', 'units', 'measure'),
  col('ad_spend', 'Ad spend', 'PHP', 'measure'),
  col('roas', 'ROAS', 'ratio', 'measure'),
];
const PRODUCT_COLUMNS: ResultColumn[] = [
  col('source', 'Channel', 'text', 'category'),
  col('product', 'Product', 'text', 'category'),
  col('revenue', 'Revenue', 'PHP', 'measure'),
  col('units', 'Units', 'units', 'measure'),
];

function formatFigure(f: DigestFigure): string {
  if (/\(PHP\)|₱/i.test(f.label)) return formatPeso(f.value);
  if (/%/.test(f.label)) return `${Math.round(f.value * 100) / 100}%`;
  return f.value.toLocaleString('en-PH', {maximumFractionDigits: 2});
}

function basisOf(f: DigestFigure, facetWindow: string): string {
  if (f.timeBasis === 'allTime') return 'all time';
  if (f.timeBasis === 'recurring') return 'recurring (ongoing)';
  return facetWindow ? `window ${facetWindow}` : 'this digest window';
}

/** Valid figures only; an unusable entry is dropped. `area` names the part of the digest they came from. */
function figureRows(area: string, figures: unknown, facetWindow = ''): MetricRow[] {
  if (!Array.isArray(figures)) return [];
  const out: MetricRow[] = [];
  for (const raw of figures) {
    if (!isRec(raw) || typeof raw.label !== 'string' || num(raw.value) === null) continue;
    const f = {label: raw.label, value: raw.value as number, timeBasis: raw.timeBasis === 'allTime' || raw.timeBasis === 'recurring' ? raw.timeBasis : 'window'} as DigestFigure;
    out.push({area, figure: f.label, value: formatFigure(f), basis: basisOf(f, facetWindow)});
  }
  return out;
}

const FACETS: Record<'shopee' | 'lazada', readonly string[]> = {shopee: ['sales', 'ads', 'traffic', 'products'], lazada: ['sales', 'finance', 'inventory', 'ads']};

function facetRows(channel: 'shopee' | 'lazada', block: unknown): MetricRow[] {
  if (!isRec(block)) return [];
  return FACETS[channel].flatMap((name) => {
    const facet = block[name];
    if (!isRec(facet)) return [];
    const w = isRec(facet.window) ? text(facet.window.label) : '';
    return figureRows(name, facet.figures, w);
  });
}

function productRows(doc: Rec): MetricRow[] {
  const rows: MetricRow[] = [];
  const add = (source: string, products: unknown, withUnits: boolean): void => {
    if (!Array.isArray(products)) return;
    for (const p of products) {
      if (!isRec(p) || typeof p.title !== 'string') continue;
      rows.push({source, product: p.title, revenue: num(p.revenue), units: withUnits ? num(p.units) : null});
    }
  };
  if (isRec(doc.sales)) add('Website', doc.sales.topProducts, false);
  for (const channel of ['shopee', 'lazada'] as const) {
    const block = doc[channel];
    if (!isRec(block)) continue;
    for (const name of FACETS[channel]) {
      const facet = block[name];
      if (isRec(facet)) add(channel === 'shopee' ? 'Shopee' : 'Lazada', facet.topProducts, true);
    }
  }
  return rows;
}

function comparisonRows(doc: Rec): MetricRow[] {
  if (!isRec(doc.comparison)) return [];
  const out: MetricRow[] = [];
  for (const [key, label] of [['shopee', 'Shopee'], ['lazada', 'Lazada'], ['website', 'Website']] as const) {
    const c = doc.comparison[key];
    if (!isRec(c)) continue;
    out.push({channel: label, revenue: num(c.revenue), orders: num(c.orders), aov: num(c.aov), units: num(c.units), ad_spend: num(c.adSpend), roas: num(c.roas)});
  }
  return out;
}

/** The rows and columns of each section, or null when this digest has nothing for it. */
function sectionOf(doc: Rec, section: DigestSection): {columns: ResultColumn[]; rows: MetricRow[]} | null {
  let built: {columns: ResultColumn[]; rows: MetricRow[]};
  switch (section) {
    case 'comparison': built = {columns: COMPARISON_COLUMNS, rows: comparisonRows(doc)}; break;
    case 'figures': built = {columns: FIGURE_COLUMNS, rows: figureRows('digest', doc.figures)}; break;
    case 'sales': built = {columns: FIGURE_COLUMNS, rows: isRec(doc.sales) ? figureRows('website sales', doc.sales.figures) : []}; break;
    case 'customers': built = {columns: FIGURE_COLUMNS, rows: isRec(doc.customers) ? figureRows('customers', doc.customers.figures) : []}; break; // names and outreach notes are never returned
    case 'shopee': built = {columns: FIGURE_COLUMNS, rows: facetRows('shopee', doc.shopee)}; break;
    case 'lazada': built = {columns: FIGURE_COLUMNS, rows: facetRows('lazada', doc.lazada)}; break;
    case 'products': built = {columns: PRODUCT_COLUMNS, rows: productRows(doc)}; break;
    case 'weekly_revenue': return null; // built across digests by weeklyRevenue(), not from one document
  }
  return built.rows.length > 0 ? built : null;
}

const PUBLISHED: MeasureDecl = {
  key: 'published',
  label: 'Published figure',
  kind: 'measured',
  unit: 'text',
  method: 'Figures exactly as published in the stored weekly digest; nothing is recomputed. A figure with a time basis of all time is not for this window.',
};

export interface DigestResult {
  result: MetricResult;
  headline: string;
  window: {label: string; from: string; to: string; which: 'latest' | 'previous'};
}

/** Completed offline POS revenue for a date range, or null when there is no POS data for it. Injected so this file stays pure. */
export type OfflineRevenueFor = (from: string, to: string) => number | null;

const WEEKLY_COLUMNS: ResultColumn[] = [
  col('week', 'Week starting', 'date', 'time'),
  col('shopee', 'Shopee', 'PHP', 'measure'),
  col('lazada', 'Lazada', 'PHP', 'measure'),
  col('website', 'Website', 'PHP', 'measure'),
  col('offline_pos', 'Offline POS', 'PHP', 'measure'),
];
const OFFLINE_WEEK: MeasureDecl = {
  key: 'offline_pos',
  label: 'Offline POS revenue',
  kind: 'measured',
  unit: 'PHP',
  method: 'Completed offline POS sales between the first and last day of each digest week, from the live POS data (not from the digest).',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WEEKS = 26;
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Week by week over the owner's dates (Monday to Sunday weeks, so the first and last may stick out of the range). Offline POS is
 * computed for every week; the online channels are filled only where a stored weekly digest starts in that week, and the weeks
 * without one are listed, never guessed. The dates are the OWNER's: without them the tool asks for them instead of defaulting.
 */
function weeklyRevenue(src: DigestSource, now: Date, offline: OfflineRevenueFor | null, rawFrom: unknown, rawTo: unknown): DigestResult | MetricError {
  const from = typeof rawFrom === 'string' ? rawFrom : '';
  const to = typeof rawTo === 'string' ? rawTo : '';
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return fail('A week-by-week series needs the owner\'s dates. Ask them for a start and an end date (for example "last 8 weeks" or "1 Sep to 30 Sep"), then call again with from and to as YYYY-MM-DD. Do not pick dates yourself.');
  if (from > to) return fail('from is after to. Ask the owner for the dates again.');
  const first = mondayOf(from);
  const starts: string[] = [];
  for (let d = first; d <= to; d = addDays(d, 7)) starts.push(d);
  if (starts.length > MAX_WEEKS) return fail(`That is ${starts.length} weeks; the limit is ${MAX_WEEKS}. Ask the owner for a shorter range.`);

  const digests = src.rows.map((row) => {
    const doc = row.digest as unknown as Rec;
    const w = isRec(doc.window) ? doc.window : {};
    return {start: dayOf(text(w.from) || row.window_from), byChannel: new Map(comparisonRows(doc).map((r) => [String(r.channel), num(r.revenue)] as const))};
  });
  const weeks = starts.map((start) => {
    const end = addDays(start, 6);
    const hit = digests.find((g) => g.start >= start && g.start <= end);
    const row: MetricRow = {week: start, shopee: hit?.byChannel.get('Shopee') ?? null, lazada: hit?.byChannel.get('Lazada') ?? null, website: hit?.byChannel.get('Website') ?? null, offline_pos: offline ? offline(start, end) : null};
    return {start, end, online: hit !== undefined, row};
  });
  const usable = weeks.filter((x) => ['shopee', 'lazada', 'website', 'offline_pos'].some((k) => x.row[k] !== null));
  if (usable.length === 0) return fail(`There is no data for ${from} to ${to}: no stored weekly digest and no offline POS sales in those weeks. Say so plainly and ask which dates they want instead.`);

  const lastEnd = weeks[weeks.length - 1].end;
  const missing = weeks.filter((x) => !x.online).map((x) => x.start);
  const label = `${weeks.length} week${weeks.length === 1 ? '' : 's'}, ${first} to ${lastEnd}`;
  const newestOnline = [...digests].sort((a, b) => b.start.localeCompare(a.start))[0]?.start ?? '';
  const checks: Check[] = [];
  if (src.source === 'mock') checks.push({code: 'mock_source', status: 'warn', text: 'These are built-in sample digests, not real figures.'});
  if (missing.length > 0) {
    checks.push({
      code: 'partial_coverage',
      status: 'warn',
      text: `Online channels (Shopee, Lazada, Website) are only available for the weeks that have a stored weekly digest: ${weeks.length - missing.length} of ${weeks.length} weeks in the range. No online figures for the week${missing.length === 1 ? '' : 's'} starting ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' and others' : ''}${newestOnline ? `; the newest stored digest starts ${newestOnline}` : ''}. Offline POS is shown for every week from the live POS data.`,
      values: {weeks: weeks.length, online_weeks: weeks.length - missing.length},
    });
  } else {
    checks.push({code: 'partial_coverage', status: 'info', text: 'Every week in the range has a stored digest for the online channels; Offline POS comes from the live POS data for the same weeks.'});
  }
  checks.push({code: 'partial_coverage', status: 'info', text: 'Weeks run Monday to Sunday, so the first and last week may extend past the dates asked.'});
  const result: MetricResult = {
    id: '',
    metric: 'digest',
    dimension: 'weekly_revenue',
    columns: WEEKLY_COLUMNS,
    rows: usable.map((x) => x.row),
    meta: {
      source: 'digest',
      range: {from: first, to: lastEnd, label},
      dataFrom: first,
      dataTo: lastEnd,
      rowCount: usable.length,
      coverage: missing.length > 0 ? 'partial' : 'full',
      coveredFrom: first,
      coveredTo: lastEnd,
      caveats: checks.map((c) => c.text),
      share_basis: null,
      measure: 'offline_pos',
      measures: [PUBLISHED, OFFLINE_WEEK],
      insights: [],
      checks,
      reliable: !checks.some((c) => c.status === 'fail'),
    },
  };
  void now;
  return {result, headline: '', window: {label, from: first, to: lastEnd, which: 'latest'}};
}

export function shapeDigest(input: unknown, src: DigestSource | null, now: Date, offline: OfflineRevenueFor | null = null): DigestResult | MetricError {
  const o = isRec(input) ? input : {};
  if (typeof o.window !== 'string' || !(DIGEST_WINDOWS as readonly string[]).includes(o.window)) return fail(`window ${JSON.stringify(o.window ?? null)} is not allowed. Allowed values for window: ${list(DIGEST_WINDOWS)}.`);
  if (typeof o.section !== 'string' || !(DIGEST_SECTIONS as readonly string[]).includes(o.section)) return fail(`section ${JSON.stringify(o.section ?? null)} is not allowed. Allowed values for section: ${list(DIGEST_SECTIONS)}.`);
  const section = o.section as DigestSection;
  if ((o.window === 'recent_weeks') !== (section === 'weekly_revenue')) return fail('window "recent_weeks" and section "weekly_revenue" go together: use both for a week-by-week series, or "latest"/"previous" with any other section.');
  if (o.window === 'recent_weeks') {
    if (!src || src.rows.length === 0) return fail('The weekly digest is not available right now (not connected, or none has been stored yet). Say so plainly. Offline POS figures still come from query_metric.');
    return weeklyRevenue(src, now, offline, o.from, o.to);
  }
  const which = o.window as 'latest' | 'previous';

  if (!src || src.rows.length === 0) {
    return fail('The weekly digest is not available right now (not connected, or none has been stored yet). Say so plainly. Offline POS figures still come from query_metric; Shopee, Lazada and Website figures cannot be answered without it.');
  }
  const row = which === 'latest' ? src.rows[0] : src.rows[1];
  if (!row) return fail('Only one weekly digest is stored, so there is no previous window. Use window "latest".');

  const doc = row.digest as unknown as Rec;
  const built = sectionOf(doc, section);
  if (!built) {
    const have = DIGEST_SECTIONS.filter((s) => sectionOf(doc, s) !== null);
    return fail(`The ${which} digest has no ${section} section. Sections it has: ${have.length ? list(have) : 'none'}.`);
  }

  const w = isRec(doc.window) ? doc.window : {};
  const from = dayOf(text(w.from) || row.window_from);
  const to = dayOf(text(w.to) || row.window_to);
  const label = text(w.label) || `${from} to ${to}`;

  // Staleness is judged on the NEWEST stored digest: if even that is old, every window here is old.
  const newest = src.rows[0];
  const newestDoc = isRec(newest.digest) ? (newest.digest as unknown as Rec) : {};
  const newestTo = dayOf((isRec(newestDoc.window) ? text(newestDoc.window.to) : '') || newest.window_to);
  const age = daysBetween(newestTo, phtDate(now));

  const checks: Check[] = [];
  if (src.source === 'mock') checks.push({code: 'mock_source', status: 'warn', text: 'These are built-in sample digests, not real figures.'});
  if (age >= DIGEST_STALE_DAYS) checks.push({code: 'partial_coverage', status: 'warn', text: `The newest stored digest ended ${newestTo}, ${age} days ago, so anything since is not in it. For recent offline sales use query_metric.`, values: {newest_ended: newestTo, days_ago: age}});
  if (doc.degraded === true) checks.push({code: 'partial_coverage', status: 'warn', text: 'This digest is marked degraded: some sources were missing when it was built.'});
  checks.push({code: 'partial_coverage', status: 'info', text: `This is the ${label} digest (${from} to ${to}) as published. It is one reporting window, not a full month or a custom range, and nothing is recomputed.`, values: {from, to}});

  const result: MetricResult = {
    id: '',
    metric: 'digest',
    dimension: section,
    columns: built.columns,
    rows: built.rows,
    meta: {
      source: 'digest',
      range: {from, to, label},
      dataFrom: from,
      dataTo: to,
      rowCount: built.rows.length,
      coverage: 'full',
      coveredFrom: from,
      coveredTo: to,
      caveats: checks.map((c) => c.text),
      share_basis: null,
      measure: PUBLISHED.key,
      measures: [PUBLISHED],
      insights: [],
      checks,
      reliable: !checks.some((c) => c.status === 'fail'),
    },
  };
  return {result, headline: text(doc.headline), window: {label, from, to, which}};
}

// ---- lookup_product -------------------------------------------------------------------------------------------------

export const PRODUCT_SHOWS = ['details', 'price_history'] as const;
export const MAX_QUERY = 80;
const MAX_LISTED = 5;

const DETAIL_COLUMNS: ResultColumn[] = [
  col('sku', 'SKU', 'text', 'category'),
  col('name', 'Product', 'text', 'category'),
  col('price', 'Current price', 'PHP', 'measure'),
  col('units_direct', 'Units sold directly', 'units', 'measure'),
  col('units_in_bundles', 'Units picked inside bundles', 'units', 'measure'),
  col('revenue_direct', 'Revenue from direct sales', 'PHP', 'measure'),
  col('orders', 'Orders with this product', 'count', 'measure'),
  col('first_sold', 'First sold', 'date', 'time'),
  col('last_sold', 'Last sold', 'date', 'time'),
];
const HISTORY_COLUMNS: ResultColumn[] = [
  col('changed_on', 'Changed on', 'date', 'time'),
  col('old_price', 'Old price', 'PHP', 'measure'),
  col('new_price', 'New price', 'PHP', 'measure'),
];

const LOOKUP_MEASURE: MeasureDecl = {
  key: 'details',
  label: 'Product details',
  kind: 'measured',
  unit: 'text',
  method: 'Counted from completed (not voided) POS orders. Revenue is direct sales only: units picked inside a bundle carry no revenue of their own (see query_metric bundle_picks for allocated revenue).',
};

interface Known {
  sku: string;
  name: string;
}

function knownProducts(data: MetricData): Known[] {
  const seen = new Map<string, Known>();
  for (const order of data.orders) {
    for (const line of order.items) {
      if (line.product_id && !seen.has(line.product_id)) seen.set(line.product_id, {sku: line.product_id, name: line.name || line.product_id});
    }
  }
  return [...seen.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const label = (p: Known): string => (p.name === p.sku ? p.sku : `${p.sku} (${p.name})`);

/** Close matches for a query that found nothing: a shared word, or a small edit distance to the SKU or name. */
function closeMatches(q: string, products: Known[]): Known[] {
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return products
    .map((p) => {
      const name = p.name.toLowerCase();
      const sku = p.sku.toLowerCase();
      const shared = words.filter((w) => name.includes(w) || sku.includes(w)).length;
      const dist = Math.min(levenshtein(q, sku), levenshtein(q, name));
      return {p, score: shared > 0 ? shared * 10 - dist : dist <= 2 ? 5 - dist : 0};
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.sku.localeCompare(b.p.sku))
    .slice(0, 3)
    .map((x) => x.p);
}

export function lookupProduct(input: unknown, data: MetricData): MetricResult | MetricError {
  const o = isRec(input) ? input : {};
  if (typeof o.show !== 'string' || !(PRODUCT_SHOWS as readonly string[]).includes(o.show)) return fail(`show ${JSON.stringify(o.show ?? null)} is not allowed. Allowed values for show: ${list(PRODUCT_SHOWS)}.`);
  const query = typeof o.query === 'string' ? o.query.trim() : '';
  if (query === '') return fail('query must be a product name or SKU (not empty). To list the products that sold, use query_metric with top_products.');
  if (query.length > MAX_QUERY) return fail(`query is too long (at most ${MAX_QUERY} characters): give a product name or a SKU.`);

  const products = knownProducts(data);
  if (products.length === 0) return fail('No products are known yet (there are no sold lines in the data). Use describe_data to see what is available.');

  const q = query.toLowerCase();
  const bySku = products.find((p) => p.sku.toLowerCase() === q);
  const byName = products.filter((p) => p.name.toLowerCase() === q);
  const partial = products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  const exact = bySku ?? (byName.length === 1 ? byName[0] : undefined);
  const found = exact ?? (partial.length === 1 ? partial[0] : undefined);

  if (!found) {
    if (partial.length > 1 || byName.length > 1) {
      const some = (byName.length > 1 ? byName : partial).slice(0, MAX_LISTED).map(label);
      return fail(`More than one product matches "${query}": ${list(some)}. Call lookup_product again with the exact SKU.`);
    }
    const close = closeMatches(q, products);
    return fail(
      close.length
        ? `No product has the SKU or name "${query}". Close matches: ${list(close.map(label))}. Call lookup_product again with one of these SKUs, or use query_metric with top_products to see what sold.`
        : `No product has the SKU or name "${query}". Use query_metric with top_products to see the products that sold, then call lookup_product with an exact SKU.`,
    );
  }

  const completed = data.orders.filter((o2) => o2.status !== 'voided' && !Number.isNaN(Date.parse(o2.created_at)));
  let dataFrom: string | null = null;
  let dataTo: string | null = null;
  for (const o2 of completed) {
    const d = manilaDayKey(o2.created_at);
    if (dataFrom === null || d < dataFrom) dataFrom = d;
    if (dataTo === null || d > dataTo) dataTo = d;
  }

  const caveats: string[] = ['Stock levels are not available to Ask Coop: stock by location is on the Inventory page.'];
  const checks: Check[] = [];
  if (data.source === 'mock') checks.push({code: 'mock_source', status: 'warn', text: 'This is sample data, not real sales.'});

  let columns: ResultColumn[];
  let rows: MetricRow[];
  if (o.show === 'price_history') {
    columns = HISTORY_COLUMNS;
    rows = data.priceChanges
      .filter((c) => c.product_id === found.sku)
      .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
      .map((c) => ({changed_on: manilaDayKey(c.changed_at), old_price: c.old_price, new_price: c.new_price}));
    if (rows.length === 0) caveats.push('No price change is recorded for this product.');
  } else {
    columns = DETAIL_COLUMNS;
    let direct = 0;
    let bundled = 0;
    let revenue = 0; // whole centavos
    let orders = 0;
    let first: string | null = null;
    let last: string | null = null;
    for (const order of completed) {
      const lines = order.items.filter((l) => l.product_id === found.sku);
      if (lines.length === 0) continue;
      orders += 1;
      const d = manilaDayKey(order.created_at);
      if (first === null || d < first) first = d;
      if (last === null || d > last) last = d;
      for (const l of lines) {
        if (l.bundle_group) bundled += l.qty;
        else {
          direct += l.qty;
          revenue += Math.round(l.line_total * 100);
        }
      }
    }
    const price = data.prices.find((p) => p.product_id === found.sku)?.price ?? null;
    if (price === null) caveats.push('No current price is recorded for this product.');
    rows = [{sku: found.sku, name: found.name, price, units_direct: direct, units_in_bundles: bundled, revenue_direct: revenue / 100, orders, first_sold: first, last_sold: last}];
  }
  for (const c of checks) caveats.push(c.text);

  const from = dataFrom ?? '';
  const to = dataTo ?? '';
  return {
    id: '',
    metric: 'product_lookup',
    dimension: o.show,
    columns,
    rows,
    meta: {
      source: data.source,
      range: {from, to, label: from && to ? `all available orders, ${from} to ${to}` : 'no orders'},
      dataFrom,
      dataTo,
      rowCount: rows.length,
      coverage: 'full',
      coveredFrom: dataFrom,
      coveredTo: dataTo,
      caveats,
      share_basis: null,
      measure: LOOKUP_MEASURE.key,
      measures: [LOOKUP_MEASURE],
      insights: [],
      checks,
      reliable: true,
    },
  };
}
