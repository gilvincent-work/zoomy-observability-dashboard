// F5 + F7 + F8 + F10: the strict tool definitions (eleven, plus run_query for Explore users) sent to the Messages API, built from the registry. Frozen.
// Strict-mode limits honoured: 10 tools, no optional parameters, no unions, no min/max/pattern/format keywords.
import {DIGEST_SECTIONS, DIGEST_WINDOWS, PRODUCT_SHOWS} from './digest-lookup';
import {METRICS, METRIC_IDS} from './metrics-registry';
import type {ToolDefinition} from './stream-types';
import {EXPLORE_OPEN_DOMAINS} from './explore/access';

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
};

// Explore (spec 3.1). Strict, no optional parameters, no maxLength/pattern (lengths are enforced in code by the validator).
const runQuery: ToolDefinition = {
  name: 'run_query',
  description:
    'EXPLORATORY. Run ONE read-only SQL SELECT on the database tables (see the data index; call describe_table first), only when query_metric, lookup_product and get_digest cannot answer ' +
    '(the registry has no measure or filter for the ask). Name every column (no select *). Aggregate in SQL; never return raw rows to count or add them yourself. ' +
    'step "probe" = a quick look (row count, null share, distinct values), not stored; step "final" = the query whose result you will explain or draw, stored with an id x1, x2... for render_chart / render_table / render_kpi. ' +
    'On an error code, fix the SQL and call again. At most 5 calls per question.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      purpose: {type: 'string', description: 'One plain sentence: what this query answers. No customer names or contact details.'},
      sql: {type: 'string', description: 'One SELECT (a WITH ... SELECT is fine). At most 2000 characters. Name columns; end numeric columns with _php, _pct, _count, _units or _ratio.'},
      step: {type: 'string', enum: ['probe', 'final'], description: '"probe" for a look, "final" for the query you will present.'},
    },
    required: ['purpose', 'sql', 'step'],
    additionalProperties: false,
  },
};

const getDigest: ToolDefinition = {
  name: 'get_digest',
  description:
    'Read ONE stored DIGEST as published: Shopee, Lazada and Website figures (revenue, orders, ad spend, ROAS, top products, customers) for that digest\'s window. Digest windows vary in length (weekly or about a month); the stored windows are listed in the per-turn context. ' +
    'Call it for a question about Shopee, Lazada or the website, or a channel comparison, in one window. Use window "covering" with the owner\'s date (from, and to for a range) to read the digest that covers it or overlaps it most; "latest" and "previous" read the newest two. ' +
    'It returns a result id you can pass to render_table or render_chart; the figures are as published, every row says its time basis (never present an all-time figure as this week), and you must name the window it used. ' +
    'For offline POS sales use query_metric instead. Use "comparison" for Lazada vs Shopee vs Website. ' +
    'For a total over any dates (a month, a custom range) or a trend by week or month, use get_channel_report instead.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      window: {type: 'string', enum: [...DIGEST_WINDOWS], description: '"covering" reads the stored digest that covers the owner\'s date or range (pass from and to); "latest" the newest stored digest; "previous" the one before it;'},
      from: {type: 'string', description: 'First date as YYYY-MM-DD, ONLY for window "covering" (the owner\'s own date; ask them if they gave none). Otherwise "".'},
      to: {type: 'string', description: 'Last date as YYYY-MM-DD for a range ("" for one day with "covering"), ONLY for window "covering". Otherwise "".'},
      section: {type: 'string', enum: [...DIGEST_SECTIONS], description: '"comparison" is one row per channel; "figures", "sales" and "customers" are the digest\'s own figure lists; "shopee" and "lazada" their marketplace figures; "products" the top products per channel.'},
    },
    required: ['window', 'section', 'from', 'to'],
    additionalProperties: false,
  },
};

const getChannelReport: ToolDefinition = {
  name: 'get_channel_report',
  description:
    'Totals per sales channel for ANY dates the owner names (a month, a quarter, a custom range), or a channel trend by week or month: revenue, orders, units and average order value. ' +
    'Shopee and Lazada are summed from the stored digests\' per-day sales (newest digest wins per day), Website from live CRM orders, Offline from completed POS orders; AOV is recomputed from the totals. ' +
    'Call it for "the September report per channel", "Shopee vs Lazada this quarter" or "week by week online vs offline". It returns a result id for render_chart / render_table and coverage notes: say every note that names missing days or "not combinable" windows BEFORE any figure, and never fill a gap yourself. ' +
    'Ad spend, ROAS and top products are not in it (use get_digest for one published window). Pass the owner\'s dates; ask if they gave none.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      from: {type: 'string', description: 'First day, YYYY-MM-DD in Philippine time: the owner\'s own date. "" only if they gave none (the tool then asks for them).'},
      to: {type: 'string', description: 'Last day, YYYY-MM-DD, inclusive.'},
      channels: {type: 'array', items: {type: 'string', enum: ['all', 'shopee', 'lazada', 'website', 'offline']}, description: '["all"] for every channel, or the ones the owner named.'},
      granularity: {type: 'string', enum: ['total', 'week', 'month'], description: '"total" for one row per channel; "week" (Monday to Sunday) or "month" for a trend, one row per period.'},
    },
    required: ['from', 'to', 'channels', 'granularity'],
    additionalProperties: false,
  },
};

const lookupProduct: ToolDefinition = {
  name: 'lookup_product',
  description:
    'Look up ONE product by SKU or name in the offline POS data: its current price, units and revenue sold, first and last sale, or its price changes. ' +
    'Call it when the owner names a specific product or SKU. To rank or list products use query_metric (top_products) instead. ' +
    'If the name is ambiguous or unknown it returns the matches or close matches: call it again with the exact SKU. It does not return stock levels.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      query: {type: 'string', description: 'The SKU (for example "P1") or the product name as the owner said it.'},
      show: {type: 'string', enum: [...PRODUCT_SHOWS], description: '"details" for price and sales, "price_history" for its recorded price changes.'},
    },
    required: ['query', 'show'],
    additionalProperties: false,
  },
};

const BLOCK_FIELD = {type: 'string', description: '"new" to add a block, or the id of a block already on the dashboard (b1, b2...) to change that block in place.'};
const SOURCE_FIELD = {type: 'string', description: 'The id of a query_metric result (r1, r2...) or of a block on the dashboard (b1, b2...). You give an id and field names, never values: the app reads the numbers from that result.'};

const renderKpi: ToolDefinition = {
  name: 'render_kpi',
  description:
    'Show ONE headline number as a stat tile, from a one-row result. Call it once per tile (up to four) for a dashboard-style ask, after query_metric. ' +
    'Pass a result id and the field name that holds the number, never the number itself. The source result must have exactly one row.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      block: BLOCK_FIELD,
      source: SOURCE_FIELD,
      value: {type: 'string', description: 'The field (column key) of the source result that holds the number.'},
      label: {type: 'string', description: 'A short plain label for the tile, e.g. "Bundle revenue".'},
      format: {type: 'string', enum: ['peso', 'count', 'percent'], description: 'How to show the number; it must match the field: peso for pesos, percent for percentages, count for counts and units.'},
    },
    required: ['block', 'source', 'value', 'label', 'format'],
    additionalProperties: false,
  },
};

const renderChart: ToolDefinition = {
  name: 'render_chart',
  description:
    'Draw ONE chart from a stored result. The app picks the chart form, orientation, colors, sorting and any "Other" fold from the data, and tells you what it chose; the full table is always kept next to it. ' +
    'Pass a result id and field names, never values. Use kind "auto" and orientation "auto" unless the owner named a form or a direction (explicit style wins, truth never does: the app may substitute a form and says why). ' +
    'Use x "auto" and y ["auto"] unless the owner named fields. There is no axis, color or free-text option. ' +
    'To change a block already on the dashboard ("make it a pie"), call this with that block\'s id and the same source, never a second copy.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      block: BLOCK_FIELD,
      source: SOURCE_FIELD,
      kind: {type: 'string', enum: ['auto', 'line', 'area', 'bar', 'grouped_bar', 'stacked_bar', 'stacked_bar_100', 'pie', 'diverging_bar', 'small_multiples'], description: '"auto" unless the owner named a chart form.'},
      orientation: {type: 'string', enum: ['auto', 'vertical', 'horizontal'], description: '"auto" unless the owner asked for vertical or horizontal bars.'},
      x: {type: 'string', description: 'The category or time field, or "auto".'},
      y: {type: 'array', items: {type: 'string'}, description: 'The measure fields to plot, or ["auto"].'},
      title: {type: 'string', description: 'A short plain title, e.g. "Bundle revenue by pet".'},
    },
    required: ['block', 'source', 'kind', 'orientation', 'x', 'y', 'title'],
    additionalProperties: false,
  },
};

const renderTable: ToolDefinition = {
  name: 'render_table',
  description:
    'Show a result as a table: the breakdown behind a chart, or a detail listing. Pass a result id and the column keys to show (["auto"] for all columns), never values. ' +
    'A total row is added by the app when the columns add up.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      block: BLOCK_FIELD,
      source: SOURCE_FIELD,
      columns: {type: 'array', items: {type: 'string'}, description: 'Column keys of the source result in the order to show, or ["auto"] for all.'},
      title: {type: 'string', description: 'A short plain title for the table.'},
    },
    required: ['block', 'source', 'columns', 'title'],
    additionalProperties: false,
  },
};

const setReportFilters: ToolDefinition = {
  name: 'set_report_filters',
  description:
    'Change the scope of the OPEN dashboard: its period, pet, event or channel. Call it once for a request like "only cats", "last month instead" or "for the Mall Pop-up event"; every block on the dashboard re-runs with the new filters and updates in place. ' +
    'Never run separate queries with different filters for this. Use "keep" for a field that does not change, and "" for from and to unless range is custom.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      range: {type: 'string', enum: ['keep', 'last_week', 'this_week', 'last_month', 'all_available', 'custom'], description: 'The new period, or "keep".'},
      from: {type: 'string', description: 'YYYY-MM-DD or "" unless range is custom'},
      to: {type: 'string', description: 'YYYY-MM-DD or "" unless range is custom'},
      pet: {type: 'string', enum: ['keep', 'all', 'dog', 'cat', 'both', 'untagged'], description: 'The pet the sales were tagged for, or "keep".'},
      event: {type: 'string', description: '"keep", "all" or an event name.'},
      channel: {type: 'string', enum: ['keep', 'offline', 'all'], description: 'Only offline POS is connected. "keep" leaves it as it is.'},
    },
    required: ['range', 'from', 'to', 'pet', 'event', 'channel'],
    additionalProperties: false,
  },
};

const removeBlock: ToolDefinition = {
  name: 'remove_block',
  description:
    'Remove ONE block from the open dashboard. Call it for "drop the KPIs" or "remove the table": once per block, using the block ids listed in the dashboard outline. Never invent an id.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {block: {type: 'string', description: 'The id of a block on the dashboard, from the outline (b1, b2...).'}},
    required: ['block'],
    additionalProperties: false,
  },
};

const setReportTitle: ToolDefinition = {
  name: 'set_report_title',
  description: 'Give the open dashboard a short plain title. Call it when the owner asks to name or rename the dashboard, or once after you build one for a clear topic.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {title: {type: 'string', description: 'A short plain title, e.g. "Bundle sales by pet".'}},
    required: ['title'],
    additionalProperties: false,
  },
  cache_control: {type: 'ephemeral'},
};

export const CHAT_TOOLS: readonly ToolDefinition[] = deepFreeze([describeData, queryMetric, getDigest, getChannelReport, lookupProduct, renderKpi, renderChart, renderTable, setReportFilters, removeBlock, setReportTitle]);

// Schema tools (spec 2.3): live from the database as the read-only login, merged with the catalog notes. Only domains with an open table.
const listTables: ToolDefinition = {
  name: 'list_tables',
  description: 'List every table and view run_query can read, with its domain, a one-line meaning and the preferred default view. Use it when you do not know which table holds something. "all" for every domain.',
  strict: true,
  input_schema: {type: 'object', properties: {domain: {type: 'string', enum: ['all', ...EXPLORE_OPEN_DOMAINS], description: 'A domain id, or "all".'}}, required: ['domain'], additionalProperties: false},
};
const describeTable: ToolDefinition = {
  name: 'describe_table',
  description: 'Get the readable columns (name, type, nullable) of one table or view, live from the database, with its catalog meaning. Call it before writing run_query SQL on a table you have not described in this conversation. Secret columns are never listed.',
  strict: true,
  input_schema: {type: 'object', properties: {table: {type: 'string', description: 'The exact table or view name, no schema.'}}, required: ['table'], additionalProperties: false},
};

const EXPLORE_TOOLS: readonly ToolDefinition[] = (() => {
  const at = CHAT_TOOLS.findIndex((t) => t.name === 'query_metric') + 1;
  return deepFreeze([...CHAT_TOOLS.slice(0, at), runQuery, listTables, describeTable, ...CHAT_TOOLS.slice(at)]);
})();

/** The tool list for a user who may use Explore: CHAT_TOOLS with run_query spliced in after query_metric, so set_report_title stays last and keeps the cache breakpoint. */
export function exploreTools(): readonly ToolDefinition[] {
  return EXPLORE_TOOLS;
}
