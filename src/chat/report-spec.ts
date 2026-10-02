// F8: validate a report spec that came from outside (the drawer's request body, later a stored spec). Pure, no I/O.
// The spec is untrusted: every key at every level is allowlisted and rebuilt, so an unknown key (notably `data`,
// `values`, `rows`, `__proto__`) is never copied. Enums are checked against the CURRENT registry. Any bad block makes
// the whole spec invalid in F8: the caller then ignores it and proceeds with no report. Design: § 5b Security.
import {FORMATS, KINDS, ORIENTATIONS, plainText} from './bind';
import {METRICS, METRIC_IDS} from './metrics-registry';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES, REPORT_SPEC_VERSION, type ReportBlockSpec, type ReportFilters, type ReportQuery, type ReportSpec} from './report-types';
import type {MetricId, MetricRequest} from './result-types';

export type SpecResult = {ok: true; spec: ReportSpec} | {ok: false; error: string};

export const RANGES: readonly MetricRequest['range'][] = ['last_week', 'this_week', 'last_month', 'all_available', 'custom'];
export const PETS: readonly MetricRequest['pet'][] = ['all', 'dog', 'cat', 'both', 'untagged'];
export const CHANNELS: readonly MetricRequest['channel'][] = ['offline', 'all'];
const COMPARES: readonly MetricRequest['compare_to'][] = ['none', 'previous_period'];
const SORTS: readonly MetricRequest['sort'][] = ['default', 'value_desc', 'value_asc'];
const LIMITS: readonly MetricRequest['limit'][] = [3, 5, 10, 25];
const MODES = ['auto', 'user'] as const;
const BLOCK_ID = /^b[1-9][0-9]{0,2}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FIELD = 60; // a column key, a field name
const MAX_Y = 8;
const MAX_COLUMNS = 24;

export const DEFAULT_FILTERS: ReportFilters = {range: 'all_available', from: '', to: '', pet: 'all', event: 'all', channel: 'offline', pinned: false};

export const emptySpec = (filters: ReportFilters = DEFAULT_FILTERS): ReportSpec => ({spec_version: REPORT_SPEC_VERSION, title: '', filters: {...filters, pinned: false}, blocks: []});

class Invalid extends Error {}
const bad = (msg: string): never => {
  throw new Invalid(msg);
};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], what: string): T => ((allowed as readonly unknown[]).includes(v) ? (v as T) : bad(`${what} is not allowed`));

function realDay(v: string): boolean {
  if (!ISO_DAY.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

function fieldName(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_FIELD) return bad(`${what} must be a short text`);
  return v;
}

function fieldList(v: unknown, what: string, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) return bad(`${what} must be a list of at most ${max}`);
  return v.map((x) => fieldName(x, what));
}

function readFilters(raw: unknown): ReportFilters {
  if (!isRecord(raw)) return bad('filters must be an object');
  const range = oneOf(own(raw, 'range'), RANGES, 'range');
  const from = typeof own(raw, 'from') === 'string' ? (own(raw, 'from') as string) : bad('from must be text');
  const to = typeof own(raw, 'to') === 'string' ? (own(raw, 'to') as string) : bad('to must be text');
  if (range === 'custom' ? !realDay(from) || !realDay(to) : false) bad('a custom range needs real from and to dates');
  const event = plainText(own(raw, 'event'));
  if (event === '') bad('event must be "all" or an event name');
  return {
    range,
    from: range === 'custom' ? from : '',
    to: range === 'custom' ? to : '',
    pet: oneOf(own(raw, 'pet'), PETS, 'pet'),
    event,
    channel: oneOf(own(raw, 'channel'), CHANNELS, 'channel'),
    pinned: false, // F9 owns pinning: a client can never switch it on
  };
}

function readQuery(raw: unknown): ReportQuery {
  if (!isRecord(raw)) return bad('query must be an object');
  const metric = own(raw, 'metric');
  if (typeof metric !== 'string' || !(METRIC_IDS as readonly string[]).includes(metric)) return bad('unknown metric');
  const def = METRICS[metric as MetricId];
  const dimension = own(raw, 'dimension');
  if (typeof dimension !== 'string' || !def.dimensions.some((d) => d.key === dimension)) return bad(`dimension is not declared by ${metric}`);
  const measure = own(raw, 'measure');
  if (typeof measure !== 'string' || (measure !== 'default' && !def.measures.some((m) => m.key === measure))) return bad(`measure is not declared by ${metric}`);
  return {
    metric: metric as MetricId,
    dimension,
    measure,
    compare_to: oneOf(own(raw, 'compare_to'), COMPARES, 'compare_to'),
    sort: oneOf(own(raw, 'sort'), SORTS, 'sort'),
    limit: oneOf(own(raw, 'limit'), LIMITS, 'limit'),
  };
}

function readBlock(raw: unknown): ReportBlockSpec {
  if (!isRecord(raw)) return bad('a block must be an object');
  const id = own(raw, 'id');
  if (typeof id !== 'string' || !BLOCK_ID.test(id)) return bad('a block id must look like b1');
  const query = readQuery(own(raw, 'query'));
  const view = own(raw, 'view');
  if (!isRecord(view)) return bad('view must be an object');
  const kind = own(raw, 'kind');
  if (kind === 'kpi') {
    return {
      id, kind, query,
      view: {value: fieldName(own(view, 'value'), 'value'), label: plainText(own(view, 'label')), format: oneOf(own(view, 'format'), FORMATS as readonly ('peso' | 'count' | 'percent')[], 'format')},
    };
  }
  if (kind === 'chart') {
    return {
      id, kind, query,
      view: {
        kind: oneOf(own(view, 'kind'), KINDS, 'chart kind'),
        orientation: oneOf(own(view, 'orientation'), ORIENTATIONS as readonly ('auto' | 'vertical' | 'horizontal')[], 'orientation'),
        mode: oneOf(own(view, 'mode'), MODES, 'mode'),
        x: fieldName(own(view, 'x'), 'x'),
        y: fieldList(own(view, 'y'), 'y', MAX_Y),
        title: plainText(own(view, 'title')),
      },
    };
  }
  if (kind === 'table') return {id, kind, query, view: {columns: fieldList(own(view, 'columns'), 'columns', MAX_COLUMNS), title: plainText(own(view, 'title'))}};
  return bad('a block kind must be kpi, chart or table');
}

/** Validate and rebuild an untrusted spec. Returns a fresh object that shares nothing with the input. */
export function validateSpec(raw: unknown): SpecResult {
  try {
    if (!isRecord(raw)) return {ok: false, error: 'The report must be an object.'};
    let size: number;
    try {
      size = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    } catch {
      return {ok: false, error: 'The report could not be read.'};
    }
    if (size > REPORT_MAX_BYTES) return {ok: false, error: `The report is larger than ${REPORT_MAX_BYTES} bytes.`};
    if (own(raw, 'spec_version') !== REPORT_SPEC_VERSION) return {ok: false, error: 'Unsupported spec_version.'};
    const blocksRaw = own(raw, 'blocks');
    if (!Array.isArray(blocksRaw)) return {ok: false, error: 'blocks must be a list.'};
    if (blocksRaw.length > REPORT_MAX_BLOCKS) return {ok: false, error: `A report holds at most ${REPORT_MAX_BLOCKS} blocks.`};
    const blocks = blocksRaw.map(readBlock);
    const ids = blocks.map((b) => b.id);
    if (new Set(ids).size !== ids.length) return {ok: false, error: 'Block ids must be unique.'};
    return {ok: true, spec: {spec_version: REPORT_SPEC_VERSION, title: plainText(own(raw, 'title')), filters: readFilters(own(raw, 'filters')), blocks}};
  } catch (e) {
    if (e instanceof Invalid) return {ok: false, error: e.message};
    throw e;
  }
}

/** The request a block makes: its own query plus the report's filters. */
export const requestOf = (query: ReportQuery, f: ReportFilters): MetricRequest => ({
  metric: query.metric, dimension: query.dimension, measure: query.measure, compare_to: query.compare_to, sort: query.sort, limit: query.limit,
  range: f.range, from: f.from, to: f.to, channel: f.channel, event: f.event, pet: f.pet,
});

export const queryOf = (r: MetricRequest): ReportQuery => ({metric: r.metric, dimension: r.dimension, measure: r.measure, compare_to: r.compare_to, sort: r.sort, limit: r.limit});

export const filtersOf = (r: MetricRequest): ReportFilters => ({
  range: r.range, from: r.range === 'custom' ? r.from : '', to: r.range === 'custom' ? r.to : '', pet: r.pet, event: r.event, channel: r.channel, pinned: false,
});

/** Same filters? Dates only count for a custom range; event names compare case-insensitively. */
export function sameFilters(a: ReportFilters, b: ReportFilters): boolean {
  const f = (x: ReportFilters) => [x.range, x.range === 'custom' ? x.from : '', x.range === 'custom' ? x.to : '', x.pet, x.event.trim().toLowerCase(), x.channel].join('|');
  return f(a) === f(b);
}
