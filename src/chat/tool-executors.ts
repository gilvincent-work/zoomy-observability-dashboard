// F5 + F7: executors for describe_data, query_metric and the three render tools, and the progress line for the stream.
// Pure; data loads lazily. query_metric keeps the FULL result in a per-request store that the render tools bind from.
import {describeData} from './coverage';
import {METRICS} from './metrics-registry';
import {createRenderExecutors} from './render-executors';
import {runMetric} from './query-metric';
import type {MetricId, MetricResult} from './result-types';
import type {ToolExecutors} from './tools';
import type {ChatToolContext} from './stream-types';

export const MAX_PAYLOAD_ROWS = 100;

export function createExecutors(ctx: ChatToolContext): ToolExecutors {
  let loaded: ReturnType<ChatToolContext['data']> | null = null;
  const data = () => (loaded ??= ctx.data());
  let counter = 0;
  const store = new Map<string, MetricResult>();

  return {
    ...createRenderExecutors(ctx, store),
    describe_data: async (input) => describeData(input as {metric: string}, await data(), ctx.now),
    query_metric: async (input) => {
      const result = runMetric(input, await data(), ctx.now);
      if ('error' in result) return {error: result.error};
      counter += 1;
      const id = `r${counter}`;
      store.set(id, {...result, id});
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
  if (name === 'render_kpi') return 'Adding a tile';
  if (name === 'render_chart') return 'Drawing a chart';
  if (name === 'render_table') return 'Building a table';
  return 'Working on it';
}
