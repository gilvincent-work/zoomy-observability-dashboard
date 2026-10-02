// F8: the open report ("dashboard") for ONE chat request. Built from the validated spec the drawer sent back (or empty),
// it holds the working spec, the result store (results are reachable by result id AND by the id of the block they
// feed), and every edit the chat can make: record a render call, remove a block, retitle, change the shared filters.
// A filter change re-runs EVERY block through the same pure runMetric/bindBlock path query_metric and render_* use, so
// a block's data is exactly what query_metric would return for the same request. Pure: data and `now` are injected.
import {bindBlock, plainText, type RenderTool, type ResultStore} from './bind';
import type {ChatBlock} from './block-types';
import {runMetric} from './query-metric';
import {emptySpec, requestOf, validateSpec} from './report-spec';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES, REPORT_SPEC_VERSION, type ReportBlockSpec, type ReportFilters, type ReportSpec} from './report-types';
import type {MetricData, MetricRequest, MetricResult} from './result-types';

export type FilterPatch = Partial<Pick<ReportFilters, 'range' | 'from' | 'to' | 'pet' | 'event' | 'channel'>>;

/** What one block looks like after a filter change, in plain facts for the model (no figures). */
export interface BlockCoverage {
  block: string;
  coverage: MetricResult['meta']['coverage'];
  covered_from: string | null;
  covered_to: string | null;
  form: string | null;
}

export type FilterOutcome = {ok: true; blocks: ChatBlock[]; coverage: BlockCoverage[]} | {ok: false; error: string};

export interface ReportSession {
  /** Result id (r1...) and block id (b1...) both resolve here. */
  readonly store: ResultStore;
  /** The request behind a stored result (or block alias), so render_* can record `query` and compare filters. */
  requestOf(id: string): MetricRequest | undefined;
  remember(id: string, request: MetricRequest, result: MetricResult): void;
  /** Make a block id resolve to the same result as `sourceId`. */
  alias(blockId: string, sourceId: string): void;
  /** Re-run every block of the incoming spec into the store under its block id. Returns the ids that could not run. */
  hydrate(data: MetricData, now: Date): string[];
  has(id: string): boolean;
  ids(): string[];
  size(): number;
  /** The highest block number ever used in this request: the next new block is this + 1. */
  counter(): number;
  filters(): ReportFilters;
  /** Replace the filters of an EMPTY report (the first render adopts its source's). */
  adoptFilters(f: ReportFilters): void;
  record(block: ReportBlockSpec): void;
  remove(id: string): boolean;
  setTitle(title: string): void;
  setFilters(patch: FilterPatch, data: MetricData, now: Date): FilterOutcome;
  /** Figure-free text for the preamble: ids, kinds, params, titles, filters. '' when nothing is open. */
  outline(): string;
  /** The current spec, or null when there are no blocks and no title. */
  snapshot(): ReportSpec | null;
}

const idNumber = (id: string): number => Number(id.slice(1));

/**
 * Rebuild a block from its stored recipe and the result stored under its id. Falls back to a table when it cannot be
 * drawn. With nothing in the new period (`noData`) a tile shows an em dash (null) and anything else shows a table with no
 * rows (its caveats say why): never a row of zeros.
 */
function rebind(block: ReportBlockSpec, store: ResultStore, noData: boolean): ChatBlock | null {
  const source = block.id;
  const attempt = (tool: RenderTool, input: unknown): ChatBlock[] | null => {
    let n = 0;
    const out = bindBlock(tool, input, store, () => `${block.id}~${(n += 1)}`);
    return 'error' in out ? null : out.blocks;
  };
  const asTable = (): ChatBlock[] | null => attempt('render_table', {source, columns: ['auto'], title: block.kind === 'kpi' ? block.view.label : block.view.title});
  let blocks: ChatBlock[] | null;
  if (noData && block.kind !== 'kpi') blocks = asTable();
  else if (block.kind === 'kpi') blocks = attempt('render_kpi', {source, value: block.view.value, label: block.view.label, format: block.view.format});
  else if (block.kind === 'chart') {
    const v = block.view;
    blocks = attempt('render_chart', {source, kind: v.mode === 'user' ? v.kind : 'auto', orientation: v.orientation, x: v.x, y: v.y, title: v.title});
  } else blocks = attempt('render_table', {source, columns: block.view.columns, title: block.view.title});
  blocks ??= asTable(); // a tile of an empty result, a chart of nothing: the honest table
  const pick = blocks?.find((b) => b.kind === block.kind) ?? blocks?.[0];
  if (!pick) return null;
  const shown = {...pick, id: block.id};
  if (!noData) return shown;
  if (shown.kind === 'kpi') return {...shown, value: null};
  return shown.kind === 'table' ? {...shown, rows: [], total: null} : shown;
}

export function createReportSession(initial?: ReportSpec): ReportSession {
  const start = initial ?? emptySpec();
  let title = start.title;
  let filters: ReportFilters = {...start.filters, pinned: false};
  let blocks: ReportBlockSpec[] = structuredClone(start.blocks);
  let counter = blocks.reduce((m, b) => Math.max(m, idNumber(b.id)), 0);
  let broken: string[] = [];
  const store: ResultStore = new Map();
  const requests = new Map<string, MetricRequest>();

  const remember = (id: string, request: MetricRequest, result: MetricResult): void => {
    store.set(id, result);
    requests.set(id, request);
  };

  const outline = (): string => {
    if (blocks.length === 0 && title === '') return '';
    const f = filters;
    const when = f.range === 'custom' ? `custom ${f.from} to ${f.to}` : f.range;
    const lines = [
      `[dashboard open] "${title || 'untitled'}" | filters: range ${when}; pet ${f.pet}; event ${f.event}; channel ${f.channel}`,
      'Edit this dashboard by block id: render_* with the same block id to change a block, set_report_filters to change the scope of every block, remove_block, set_report_title. Never draw a copy of a block that is listed here.',
    ];
    for (const b of blocks) {
      const q = b.query;
      const params = `${q.metric} by ${q.dimension}, measure ${q.measure}, limit ${q.limit}${q.compare_to !== 'none' ? `, compare ${q.compare_to}` : ''}${q.sort !== 'default' ? `, sort ${q.sort}` : ''}`;
      const v = b.kind === 'kpi' ? `field ${b.view.value}, ${b.view.format}, label "${b.view.label}"` : b.kind === 'chart' ? `view ${b.view.kind} (${b.view.mode}), orientation ${b.view.orientation}, title "${b.view.title}"` : `title "${b.view.title}"`;
      lines.push(`${b.id} ${b.kind}: ${params}; ${v}${broken.includes(b.id) ? '; could not be re-run' : ''}`);
    }
    return lines.join('\n');
  };

  return {
    store,
    requestOf: (id) => requests.get(id),
    remember,
    alias(blockId, sourceId) {
      const result = store.get(sourceId);
      const request = requests.get(sourceId);
      if (result && request) remember(blockId, request, result);
    },
    hydrate(data, now) {
      broken = [];
      for (const b of blocks) {
        const request = requestOf(b.query, filters);
        const result = runMetric(request, data, now);
        if ('error' in result) broken = [...broken, b.id];
        else remember(b.id, request, {...result, id: b.id});
      }
      return [...broken];
    },
    has: (id) => blocks.some((b) => b.id === id),
    ids: () => blocks.map((b) => b.id),
    size: () => blocks.length,
    counter: () => counter,
    filters: () => ({...filters}),
    adoptFilters(f) {
      if (blocks.length === 0) filters = {...f, pinned: false};
    },
    record(block) {
      counter = Math.max(counter, idNumber(block.id));
      blocks = blocks.some((b) => b.id === block.id) ? blocks.map((b) => (b.id === block.id ? block : b)) : [...blocks, block];
      broken = broken.filter((id) => id !== block.id);
    },
    remove(id) {
      const had = blocks.some((b) => b.id === id);
      blocks = blocks.filter((b) => b.id !== id);
      broken = broken.filter((x) => x !== id);
      return had;
    },
    setTitle(t) {
      title = plainText(t);
    },
    setFilters(patch, data, now) {
      let next: ReportFilters = {...filters, ...patch, pinned: false};
      if (next.range !== 'custom') next = {...next, from: '', to: ''};
      const runs: {block: ReportBlockSpec; request: MetricRequest; result: MetricResult}[] = [];
      for (const block of blocks) {
        const request = requestOf(block.query, next);
        const result = runMetric(request, data, now);
        if ('error' in result) return {ok: false, error: `Block ${block.id} cannot use these filters: ${result.error} Nothing was changed.`};
        runs.push({block, request, result: {...result, id: block.id}});
      }
      filters = next;
      broken = [];
      for (const r of runs) remember(r.block.id, r.request, r.result);
      const out: ChatBlock[] = [];
      const coverage: BlockCoverage[] = [];
      for (const r of runs) {
        const block = rebind(r.block, store, r.result.meta.coverage === 'none');
        if (block) out.push(block);
        const {meta} = r.result;
        coverage.push({
          block: r.block.id,
          coverage: meta.coverage,
          covered_from: meta.coveredFrom,
          covered_to: meta.coveredTo,
          form: block ? (block.kind === 'chart' ? block.chosen.form : block.kind) : null,
        });
      }
      return {ok: true, blocks: out, coverage};
    },
    outline,
    snapshot() {
      if (blocks.length === 0 && title === '') return null;
      return structuredClone({spec_version: REPORT_SPEC_VERSION, title, filters, blocks});
    },
  };
}

export const REPORT_FULL = `The dashboard already has ${REPORT_MAX_BLOCKS} blocks, the most it can hold. Remove a block with remove_block before adding another.`;

/**
 * The report for one request, from the untrusted `report` field of the body. Absent means an empty report. An
 * oversized or invalid spec is ignored (the chat proceeds with no report) and `onReject` is told why, with no content.
 * Hydrated only when the spec has blocks.
 */
export function openReportSession(raw: unknown, data: MetricData, now: Date, onReject?: (reason: string) => void): ReportSession {
  if (raw === undefined || raw === null) return createReportSession();
  // A cheap size guard before any deep parsing; validateSpec checks the exact serialized size again.
  let approx = 0;
  try {
    approx = JSON.stringify(raw)?.length ?? 0;
  } catch {
    approx = Infinity;
  }
  if (approx > REPORT_MAX_BYTES) {
    onReject?.('too large');
    return createReportSession();
  }
  const checked = validateSpec(raw);
  if (!checked.ok) {
    onReject?.(checked.error);
    return createReportSession();
  }
  const session = createReportSession(checked.spec);
  if (checked.spec.blocks.length > 0) session.hydrate(data, now);
  return session;
}
