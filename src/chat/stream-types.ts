// Shared contract for the Talk to Data chat stream and tool plumbing (F4 + F5). Types only, no logic.
// Design: knowledge/architecture/2026-10-01-talk-to-data-design.md §§ 3, 4, 7 (slice 1), 7b (F4, F5).

/** One line of the NDJSON response body of POST /api/chat. Chart/table/kpi/report events arrive in later features. */
export type ChatStreamEvent =
  | {t: 'status'; text: string} // short plain-language progress ("Looking at bundle sales")
  | {t: 'text'; d: string} // a text delta of the answer (markdown, may contain <suggest>/<go> tags)
  | {t: 'done'; steps: number; usage: ChatUsage}
  | {t: 'error'; message: string};

export interface ChatUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A strict custom tool as sent to the Messages API. Every parameter is required; enums and sentinels, no optionals. */
export interface ToolDefinition {
  name: string;
  description: string;
  strict: true;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  cache_control?: {type: 'ephemeral'};
}

/** What the tool executors need. `data` may be loaded lazily and is cached by the caller. */
export interface ChatToolContext {
  data: () => Promise<import('./result-types').MetricData>;
  now: Date;
  user: string | null;
}
