// F7: bind a render request to a stored result and build the blocks. The model names a RESULT ID and FIELD NAMES; every
// number in a block is read from the stored result here, never from the request. Any key in the request that is not in
// the tool schema (notably `data`, `values`, `rows`) is never read. Pure, no server-only.
import type {BlockBase, BlockFormat, ChatBlock, ChartForm, ChosenView, KpiBlock, TableBlock, ViewRequest} from './block-types';
import {formatOf, isNumericColumn, recommendView, sumOf, type BlockDecision} from './recommend-view';
import type {MetricResult, MetricRow, ResultColumn} from './result-types';

export type RenderTool = 'render_kpi' | 'render_chart' | 'render_table';
export type ResultStore = Map<string, MetricResult>;
export type BindOutcome = {error: string} | {blocks: ChatBlock[]; chosen: ChosenView[]};

export const MAX_TITLE = 120;
export const KINDS: readonly string[] = ['auto', 'line', 'area', 'bar', 'grouped_bar', 'stacked_bar', 'stacked_bar_100', 'pie', 'diverging_bar'];
export const ORIENTATIONS: readonly string[] = ['auto', 'vertical', 'horizontal'];
export const FORMATS: readonly string[] = ['peso', 'count', 'percent'];

/** Plain text, never HTML: control characters out, whitespace collapsed, at most MAX_TITLE characters. */
export function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (items: string[]): string => items.join(', ');

function resolve(source: unknown, store: ResultStore): {result: MetricResult} | {error: string} {
  const id = typeof source === 'string' ? source : '';
  const result = store.get(id);
  if (result) return {result};
  const valid = [...store.keys()];
  return {error: `Unknown result '${id}'. ${valid.length ? `Valid results: ${list(valid)}` : 'There are no results yet: call query_metric first.'}`};
}

function checkFields(result: MetricResult, keys: string[], what: string, allowed: ResultColumn[]): string | null {
  const bad = keys.filter((k) => !allowed.some((c) => c.key === k));
  if (bad.length === 0) return null;
  const exists = result.columns.some((c) => c.key === bad[0]);
  return `${exists ? `Field '${bad[0]}' cannot be used as ${what}` : `Unknown field '${bad[0]}'`} in result '${result.id}'. Valid ${what} fields: ${list(allowed.map((c) => c.key))}`;
}

function baseOf(result: MetricResult, id: string, title: string, usesShare: boolean): BlockBase {
  const {meta} = result;
  const basis = [usesShare ? meta.share_basis : null, meta.range.label].filter((p): p is string => Boolean(p)).join(', ');
  const base: BlockBase = {id, source: result.id, title, reliable: meta.reliable, caveats: [...meta.caveats], basis: basis || null};
  return meta.exploratory ? {...base, exploratory: true, sql: meta.exploratory.sql} : base;
}

const isShareLike = (cols: ResultColumn[]): boolean => cols.some((c) => c.role === 'share' || c.unit === 'percent');

/** A total row, computed here: only for additive measures (pesos summed in whole centavos), and never for a cut list. */
export function totalRow(result: MetricResult, columns: ResultColumn[], rows: MetricRow[]): MetricRow | null {
  const cut = result.meta.rowCount > result.rows.length || result.meta.caveats.some((c) => /showing the first/i.test(c));
  if (cut || rows.length < 2) return null;
  const additive = (c: ResultColumn): boolean =>
    c.role === 'measure' && (c.unit === 'PHP' || c.unit === 'count' || c.unit === 'units') && !result.meta.measures.some((m) => m.key === c.key && m.kind === 'derived');
  const sums = columns.filter(additive);
  if (sums.length === 0) return null;
  const out: MetricRow = {};
  for (const c of columns) out[c.key] = null;
  const label = columns.find((c) => !additive(c) && c.role !== 'share' && c.role !== 'delta');
  if (label) out[label.key] = 'Total';
  for (const c of sums) {
    const values = rows.map((r) => r[c.key]).filter((v): v is number => typeof v === 'number');
    out[c.key] = sumOf(values, c.unit);
  }
  return out;
}

function tableBlock(result: MetricResult, id: string, title: string, columns: ResultColumn[]): TableBlock {
  const rows = result.rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? null])));
  return {...baseOf(result, id, title, isShareLike(columns)), kind: 'table', columns, rows, total: totalRow(result, columns, rows)};
}

function kpiBlock(result: MetricResult, id: string, col: ResultColumn, label: string, format: BlockFormat): KpiBlock {
  const v = result.rows[0]?.[col.key];
  return {...baseOf(result, id, label, isShareLike([col])), kind: 'kpi', label, value: typeof v === 'number' && Number.isFinite(v) ? v : null, format, sub: null};
}

function fromDecision(result: MetricResult, d: BlockDecision, title: string, nextId: () => string): ChatBlock[] {
  if (d.block === 'kpi') return d.tiles.map((t) => kpiBlock(result, nextId(), result.columns.find((c) => c.key === t.key) as ResultColumn, t.label, t.format));
  if (d.block === 'table') return [tableBlock(result, nextId(), title, d.columns)];
  const cols = [d.chart.x, ...d.chart.series];
  const parts = d.chart.form === 'stacked_bar' || d.chart.form === 'stacked_bar_100' || d.chart.form === 'pie'; // a split of a whole names its basis
  return [{...baseOf(result, nextId(), title, parts || isShareLike(result.columns.filter((c) => cols.some((k) => k.key === c.key)))), kind: 'chart', chart: d.chart, chosen: d.chosen, twin: d.twin}];
}

/**
 * Validate one render request against the result store and build the blocks (a chart can become two: a table plus a
 * top-7 chart, or one chart per unit). `nextId` hands out block ids in order. Returns {error} in plain words.
 */
export function bindBlock(tool: RenderTool, input: unknown, store: ResultStore, nextId: () => string): BindOutcome {
  if (!isRecord(input)) return {error: 'The request must be an object with the fields in the tool schema.'};
  const found = resolve(input.source, store);
  if ('error' in found) return found;
  const {result} = found;
  const title = plainText(input.title);

  if (tool === 'render_kpi') {
    if (result.rows.length !== 1) return {error: `A stat tile needs a one-row result. Result '${result.id}' has ${result.rows.length} rows: use render_chart or render_table for it.`};
    const key = typeof input.value === 'string' ? input.value : '';
    const usable = result.columns.filter((c) => isNumericColumn(c) && formatOf(c.unit) !== null);
    const err = checkFields(result, [key], 'value', usable);
    if (err) return {error: err};
    const col = usable.find((c) => c.key === key) as ResultColumn;
    const format = typeof input.format === 'string' ? input.format : '';
    if (!FORMATS.includes(format)) return {error: `Unknown format '${format}'. Valid formats: ${list([...FORMATS])}`};
    const want = formatOf(col.unit);
    if (want !== format) return {error: `Field '${key}' is in ${col.unit}: use format '${want}'.`};
    const label = plainText(input.label) || col.label;
    return {blocks: [kpiBlock(result, nextId(), col, label, format as BlockFormat)], chosen: []};
  }

  if (tool === 'render_table') {
    const wanted = Array.isArray(input.columns) ? input.columns.filter((c): c is string => typeof c === 'string') : [];
    const auto = wanted.length === 0 || (wanted.length === 1 && wanted[0] === 'auto');
    const err = auto ? null : checkFields(result, wanted, 'column', result.columns);
    if (err) return {error: err};
    const columns = auto ? result.columns : wanted.map((k) => result.columns.find((c) => c.key === k) as ResultColumn);
    return {blocks: [tableBlock(result, nextId(), title || result.metric.replace(/_/g, ' '), columns)], chosen: []};
  }

  // render_chart
  const kind = typeof input.kind === 'string' ? input.kind : 'auto';
  const orientation = typeof input.orientation === 'string' ? input.orientation : 'auto';
  if (!KINDS.includes(kind)) return {error: `Unknown kind '${kind}'. Valid kinds: ${list([...KINDS])}`};
  if (!ORIENTATIONS.includes(orientation)) return {error: `Unknown orientation '${orientation}'. Valid orientations: ${list([...ORIENTATIONS])}`};
  const x = typeof input.x === 'string' && input.x !== 'auto' && input.x !== '' ? input.x : undefined;
  const yList = Array.isArray(input.y) ? input.y.filter((v): v is string => typeof v === 'string' && v !== 'auto' && v !== '') : [];
  if (x !== undefined) {
    const err = checkFields(result, [x], 'x', result.columns.filter((c) => c.role === 'category' || c.role === 'time'));
    if (err) return {error: err};
  }
  if (yList.length) {
    const err = checkFields(result, yList, 'y', result.columns.filter(isNumericColumn));
    if (err) return {error: err};
  }
  const request: ViewRequest = {kind: kind as 'auto' | ChartForm, orientation: orientation as ViewRequest['orientation']};
  const view = recommendView(result, request, {x, y: yList.length ? yList : undefined, title});
  const label = (d: BlockDecision): string => {
    if (title) return title;
    if (d.block === 'chart') return `${d.chart.series.map((s) => s.label).join(' and ')} by ${d.chart.x.label}`.slice(0, MAX_TITLE);
    return result.metric.replace(/_/g, ' ');
  };
  const blocks = view.decisions.flatMap((d) => fromDecision(result, d, label(d), nextId));
  return {blocks, chosen: view.decisions.map((d) => d.chosen)};
}
