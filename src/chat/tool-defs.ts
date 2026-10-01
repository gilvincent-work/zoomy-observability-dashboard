// F5: the two strict tool definitions sent to the Messages API, built from the registry. Frozen.
// Strict-mode limits honoured: 2 tools, no optional parameters, no unions, no min/max/pattern/format keywords.
import {METRICS, METRIC_IDS} from './metrics-registry';
import type {ToolDefinition} from './stream-types';

const sortedUnion = (pick: (id: (typeof METRIC_IDS)[number]) => string[]): string[] =>
  [...new Set(METRIC_IDS.flatMap(pick))].sort();

const DIMENSIONS = sortedUnion((id) => METRICS[id].dimensions.map((d) => d.key));
const MEASURES = ['default', ...sortedUnion((id) => METRICS[id].measures.map((m) => m.key))];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const describeData: ToolDefinition = {
  name: 'describe_data',
  description:
    'Check what data Ask Coop has: the date range it covers, how complete it is, which metrics exist with their dimensions and measures, and what is not available. ' +
    'Call it when the question is unclear, when the owner asks what you can answer, and before using a metric you have not seen yet in this chat. Use "all" for the whole list.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {metric: {type: 'string', enum: ['all', ...METRIC_IDS], description: 'A metric id, or "all" for every metric.'}},
    required: ['metric'],
    additionalProperties: false,
  },
};

const queryMetric: ToolDefinition = {
  name: 'query_metric',
  description:
    'Get a number from the offline POS sales data. Call it for ANY figure about offline sales, revenue, orders, average order value, products, bundles, payment methods, pets or events. ' +
    'Never state a figure that did not come from this tool. Use "none", "all" or "default" for parameters that do not apply, and "" for from and to unless range is custom.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      metric: {type: 'string', enum: [...METRIC_IDS], description: 'Which metric to compute.'},
      dimension: {type: 'string', enum: DIMENSIONS, description: 'How to break the metric down; "none" for the total or the default ranked list.'},
      measure: {type: 'string', enum: MEASURES, description: 'Which measure of the metric; "default" for its main one.'},
      range: {type: 'string', enum: ['last_week', 'this_week', 'last_month', 'all_available', 'custom'], description: 'The period, in Philippine time.'},
      from: {type: 'string', description: 'YYYY-MM-DD or "" unless range is custom'},
      to: {type: 'string', description: 'YYYY-MM-DD or "" unless range is custom'},
      channel: {type: 'string', enum: ['offline', 'all'], description: 'Only offline POS is connected.'},
      event: {type: 'string', description: 'An event name or "all"'},
      pet: {type: 'string', enum: ['all', 'dog', 'cat', 'both', 'untagged'], description: 'Filter by the pet the sale was tagged for.'},
      compare_to: {type: 'string', enum: ['none', 'previous_period'], description: 'Add the previous period of equal length.'},
      sort: {type: 'string', enum: ['default', 'value_desc', 'value_asc'], description: 'Row order for ranked lists.'},
      limit: {type: 'integer', enum: [3, 5, 10, 25], description: 'Maximum rows for ranked lists.'},
    },
    required: ['metric', 'dimension', 'measure', 'range', 'from', 'to', 'channel', 'event', 'pet', 'compare_to', 'sort', 'limit'],
    additionalProperties: false,
  },
  cache_control: {type: 'ephemeral'},
};

export const CHAT_TOOLS: readonly ToolDefinition[] = deepFreeze([describeData, queryMetric]);
