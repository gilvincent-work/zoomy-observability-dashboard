// F4: what the data covers (the coverage note and describe_data). Pure.
import {manilaDayKey} from '../pos-sales-compute';
import {METRICS, METRIC_IDS} from './metrics-registry';
import type {MetricData} from './result-types';

export interface CoverageSummary {
  source: 'live' | 'mock';
  dataFrom: string | null;
  dataTo: string | null;
  orders: number;
  untaggedOrders: number;
  untaggedShare: number | null;
  priceChangesSeen: boolean;
  eventsCount: number;
}

/** Orders are completed (not voided) orders with a readable date; dates are Philippine-time day keys. */
export function buildCoverage(data: MetricData): CoverageSummary {
  let dataFrom: string | null = null;
  let dataTo: string | null = null;
  let orders = 0;
  let untaggedOrders = 0;
  for (const o of data.orders) {
    if (o.status === 'voided' || Number.isNaN(Date.parse(o.created_at))) continue;
    const day = manilaDayKey(o.created_at);
    orders += 1;
    if (o.pet_type === null || o.pet_type === undefined) untaggedOrders += 1;
    if (dataFrom === null || day < dataFrom) dataFrom = day;
    if (dataTo === null || day > dataTo) dataTo = day;
  }
  return {
    source: data.source,
    dataFrom,
    dataTo,
    orders,
    untaggedOrders,
    untaggedShare: orders > 0 ? Math.round((untaggedOrders / orders) * 1000) / 10 : null,
    priceChangesSeen: data.priceChanges.length > 0,
    eventsCount: data.events.length,
  };
}

export const UNAVAILABLE: readonly {what: string; why: string}[] = Object.freeze([
  {what: 'Traffic', why: 'The Traffic page shows sample data, not real figures.'},
  {what: 'Meta ads', why: 'Not connected.'},
  {what: 'Shopee, Lazada and Website sales', why: 'Only in the weekly digest; not queryable yet.'},
  {what: 'Customer-level data', why: 'Not exposed; only totals are available.'},
  {what: 'Anything before the first order date', why: 'There is no data before the first order.'},
]);

export interface DescribeDataResult {
  today: string;
  source: 'live' | 'mock';
  coverage: {from: string | null; to: string | null; orders: number; untaggedShare: number | null; note: string};
  metrics: {
    id: string;
    label: string;
    description: string;
    dimensions: {key: string; label: string}[];
    measures: {key: string; label: string; kind: string; method: string}[];
    defaultDimension: string;
    defaultMeasure: string;
    supports: {pet: boolean; event: boolean; compare: boolean};
  }[];
  unavailable: {what: string; why: string}[];
}

/** The Philippine calendar date of an instant, as YYYY-MM-DD. */
export const phtDate = (now: Date): string => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

function noteFor(c: CoverageSummary): string {
  if (c.orders === 0) return 'There is no order data yet.';
  const base = `Orders run from ${c.dataFrom} to ${c.dataTo} (Philippine time); asking outside this range returns partial or no data.`;
  return c.source === 'mock' ? `This is sample data, not real sales. ${base}` : base;
}

export function describeData(input: {metric: string}, data: MetricData, now: Date): DescribeDataResult | {error: string} {
  const raw = (input as {metric?: unknown} | null)?.metric;
  const ids = METRIC_IDS as readonly string[];
  if (typeof raw !== 'string' || (raw !== 'all' && !ids.includes(raw))) {
    return {error: `Unknown metric. Allowed values: all, ${ids.join(', ')}.`};
  }
  const c = buildCoverage(data);
  const picked = raw === 'all' ? ids : [raw];
  return {
    today: phtDate(now),
    source: c.source,
    coverage: {from: c.dataFrom, to: c.dataTo, orders: c.orders, untaggedShare: c.untaggedShare, note: noteFor(c)},
    metrics: picked.map((id) => {
      const m = METRICS[id as keyof typeof METRICS];
      return {
        id: m.id,
        label: m.label,
        description: m.description,
        dimensions: m.dimensions.map((d) => ({key: d.key, label: d.label})),
        measures: m.measures.map((x) => ({key: x.key, label: x.label, kind: x.kind, method: x.method})),
        defaultDimension: m.defaultDimension,
        defaultMeasure: m.defaultMeasure,
        supports: {pet: m.supportsPet, event: m.supportsEvent, compare: m.supportsCompare},
      };
    }),
    unavailable: UNAVAILABLE.map((u) => ({...u})),
  };
}
