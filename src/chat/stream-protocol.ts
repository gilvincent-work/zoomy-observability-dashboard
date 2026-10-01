// NDJSON framing for the POST /api/chat stream (contract: stream-types.ts). Pure, string based, never throws.
import type {ChatStreamEvent} from './stream-types';

export function encodeEvent(e: ChatStreamEvent): string {
  return JSON.stringify(e) + '\n';
}

const BAD_LINE: ChatStreamEvent = {t: 'error', message: 'Could not read part of the answer.'};

function parseLine(line: string): ChatStreamEvent | null {
  if (line.trim() === '') return null;
  try {
    const v: unknown = JSON.parse(line);
    if (v !== null && typeof v === 'object' && typeof (v as {t?: unknown}).t === 'string') return v as ChatStreamEvent;
  } catch {
    // fall through to the single error event
  }
  return BAD_LINE;
}

/**
 * A stateful decoder: feed it string chunks, get the complete events. A partial trailing line is buffered until the
 * next chunk. Pass `final = true` on the last call to also parse whatever is still buffered.
 */
export function createLineDecoder(): (chunk: string, final?: boolean) => ChatStreamEvent[] {
  let buffer = '';
  let errored = false;
  return (chunk, final = false) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = final ? '' : (lines.pop() ?? '');
    const out: ChatStreamEvent[] = [];
    for (const line of lines) {
      const ev = parseLine(line);
      if (ev === null) continue;
      if (ev === BAD_LINE) {
        if (errored) continue;
        errored = true;
      }
      out.push(ev);
    }
    return out;
  };
}

/** Wraps an emitter and remembers whether any non-blank text has streamed, for the render-order gate (DASH-01). */
export function withTextGate(emit: (e: ChatStreamEvent) => void): {emit: (e: ChatStreamEvent) => void; textSeen: () => boolean} {
  let seen = false;
  return {
    emit: (e) => {
      if (e.t === 'text' && e.d.trim() !== '') seen = true;
      emit(e);
    },
    textSeen: () => seen,
  };
}
