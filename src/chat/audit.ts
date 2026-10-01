// Layer 9: one JSON line per tool call, one per turn, and one error line per guard trip.
// Never log secrets; keep params small.
export type AuditSink = Pick<Console, 'info' | 'error'>;

const SECRET_KEY = /key|token|secret|authorization|password/i;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function scrubParams(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated ${value.length - MAX_STRING}]` : value;
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' ? String(value) : value;
  }
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubParams(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : scrubParams(v, depth + 1);
  }
  return out;
}

export function logToolCall(
  e: {tool: string; params: unknown; rowCount?: number | null; ms: number; user?: string | null},
  sink: AuditSink = console,
): void {
  sink.info(
    JSON.stringify({
      event: 'chat_tool',
      tool: scrubParams(e.tool),
      params: scrubParams(e.params),
      rowCount: e.rowCount ?? null,
      ms: e.ms,
      user: e.user ?? null,
    }),
  );
}

export function logGuardTrip(
  e: {layer: string; detail: unknown; user?: string | null},
  sink: AuditSink = console,
): void {
  sink.error(
    JSON.stringify({
      event: 'chat_guard_trip',
      layer: e.layer,
      detail: scrubParams(e.detail),
      user: e.user ?? null,
    }),
  );
}

export function logTurn(
  e: {
    steps: number;
    usage: {input: number; output: number; cacheRead: number; cacheWrite: number};
    ms: number;
    stopReason: string | null;
    user?: string | null;
  },
  sink: AuditSink = console,
): void {
  sink.info(
    JSON.stringify({
      event: 'chat_turn',
      steps: e.steps,
      usage: e.usage,
      ms: e.ms,
      stopReason: e.stopReason,
      user: e.user ?? null,
    }),
  );
}
