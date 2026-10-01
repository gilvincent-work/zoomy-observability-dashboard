// F5 + F7 + F8 + F10: executors for describe_data, query_metric, get_digest, lookup_product, the three render tools and the three report-edit tools, and the progress line for the stream.
// Pure; data loads lazily. query_metric keeps the FULL result in a per-request store that the render tools bind from.
import {describeData} from './coverage';
import {lookupProduct, shapeDigest} from './digest-lookup';
import {METRICS} from './metrics-registry';
import {createRenderExecutors} from './render-executors';
import {createReportSession} from './report-session';
import {createReportExecutors} from './report-tools';
import {runMetric} from './query-metric';
import type {MetricId, MetricRequest, MetricResult} from './result-types';
import type {ToolExecutors} from './tools';
import type {ChatToolContext} from './stream-types';

export const MAX_PAYLOAD_ROWS = 100;

export function createExecutors(ctx: ChatToolContext): ToolExecutors {
  let loaded: ReturnType<ChatToolContext['data']> | null = null;
  const data = () => (loaded ??= ctx.data());
  let counter = 0;
  // The open report (F8) owns the result store: results are reachable by result id and by block id. Empty when none is open.
  const session = ctx.report ?? createReportSession();

  return {
    ...createRenderExecutors(ctx, session),
    ...createReportExecutors(ctx, session, data),
    describe_data: async (input) => describeData(input as {metric: string}, await data(), ctx.now),
    query_metric: async (input) => {
      const result = runMetric(input, await data(), ctx.now);
      if ('error' in result) return {error: result.error};
      counter += 1;
      const id = `r${counter}`;
      session.remember(id, input as MetricRequest, {...result, id}); // runMetric accepted the input, so it IS a MetricRequest
      return compact(result, id);
    },
    // F10. These results are stored for the render tools but have no MetricRequest recipe, so a block drawn from one is shown in
    // the chat and is not recorded into a saved report (nothing could re-run it).
    get_digest: async (input) => {
      let source: Awaited<ReturnType<NonNullable<ChatToolContext['digest']>>> | null = null;
      try {
        source = ctx.digest ? await ctx.digest() : null;
      } catch {
        source = null; // an unreadable digest is "not available", never a crash
      }
      const out = shapeDigest(input, source, ctx.now);
      if ('error' in out) return {error: out.error};
      counter += 1;
      const id = `r${counter}`;
      session.store.set(id, {...out.result, id});
      return {...compact(out.result, id), window: out.window, headline: out.headline};
    },
    lookup_product: async (input) => {
      const result = lookupProduct(input, await data());
      if ('error' in result) return {error: result.error};
      counter += 1;
      const id = `r${counter}`;
      session.store.set(id, {...result, id});
      return compact(result, id);
    },
  };
}

function compact(r: MetricResult, id: string) {
  const {measures, ...meta} = r.meta;
  const used = measures.find((m) => m.key === meta.measure);
  const total = r.rows.length;
  return {
    id,
    metric: r.metric,
    dimension: r.dimension,
    columns: r.columns,
    rows: total > MAX_PAYLOAD_ROWS ? r.rows.slice(0, MAX_PAYLOAD_ROWS) : r.rows,
    ...(total > MAX_PAYLOAD_ROWS ? {truncated: {shown: MAX_PAYLOAD_ROWS, total}} : {}),
    meta: {...meta, method: used?.method ?? '', declared_measures: measures.map((m) => m.key)},
  };
}

/** Plain-language progress line. Labels come from the registry only; raw input text is never echoed. */
export function statusFor(name: string, input: unknown): string {
  if (name === 'describe_data') return 'Checking what data is available';
  if (name === 'query_metric' && input !== null && typeof input === 'object') {
    const {metric, dimension} = input as {metric?: unknown; dimension?: unknown};
    if (typeof metric === 'string' && Object.prototype.hasOwnProperty.call(METRICS, metric)) {
      const def = METRICS[metric as MetricId];
      const dim = typeof dimension === 'string' && dimension !== 'none' ? def.dimensions.find((d) => d.key === dimension) : undefined;
      return `Looking at ${def.label.toLowerCase()}${dim ? ` by ${dim.label.toLowerCase().replace(/^by /, '').replace(/\s*\(.*\)/, '')}` : ''}`;
    }
  }
  if (name === 'get_digest') return 'Reading the weekly digest';
  if (name === 'lookup_product') return 'Looking up a product';
  if (name === 'render_kpi') return 'Adding a tile';
  if (name === 'render_chart') return 'Drawing a chart';
  if (name === 'render_table') return 'Building a table';
  if (name === 'set_report_filters') return 'Updating the dashboard filters';
  if (name === 'remove_block') return 'Removing a block';
  if (name === 'set_report_title') return 'Renaming the dashboard';
  return 'Working on it';
}
