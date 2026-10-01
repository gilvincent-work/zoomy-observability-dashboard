// Layer 1: the tool allowlist. Names only for now; schemas arrive with the features that add them.
// There is no write tool, and an unknown name is refused before anything runs.
import {logGuardTrip, logToolCall, type AuditSink} from './audit';

export const TOOL_ALLOWLIST = Object.freeze([
  'describe_data',
  'query_metric',
  'render_chart',
  'render_table',
  'render_kpi',
  'set_report_filters',
  'remove_block',
  'set_report_title',
  'get_digest',
  'lookup_product',
] as const);

export type AllowedTool = (typeof TOOL_ALLOWLIST)[number];

export function isAllowedTool(name: unknown): name is AllowedTool {
  return typeof name === 'string' && (TOOL_ALLOWLIST as readonly string[]).includes(name);
}

export type ToolExecutors = Partial<Record<AllowedTool, (input: unknown) => Promise<unknown>>>;
export type ToolResult = {is_error: boolean; content: unknown};

export async function dispatchToolCall(
  call: {name: unknown; input: unknown; user?: string | null},
  executors: ToolExecutors,
  sink?: AuditSink,
): Promise<ToolResult> {
  const {name, input, user} = call;
  if (!isAllowedTool(name)) {
    logGuardTrip({layer: 'tool_allowlist', detail: {name: typeof name === 'string' ? name : `[${typeof name}]`}, user}, sink);
    return {is_error: true, content: 'Unknown tool. Ask Coop can only use its read-only tools.'};
  }
  const exec = Object.prototype.hasOwnProperty.call(executors, name) ? executors[name] : undefined;
  if (!exec) return {is_error: true, content: 'not implemented'};
  const t0 = Date.now();
  try {
    const result = await exec(input);
    const rows = (result as {rows?: unknown} | null)?.rows;
    logToolCall({tool: name, params: input, rowCount: Array.isArray(rows) ? rows.length : null, ms: Date.now() - t0, user}, sink);
    return {is_error: false, content: result};
  } catch (e) {
    logToolCall({tool: name, params: {error: e instanceof Error ? e.name : 'error'}, ms: Date.now() - t0, user}, sink);
    return {is_error: true, content: 'The tool failed. Try again or ask differently.'};
  }
}
