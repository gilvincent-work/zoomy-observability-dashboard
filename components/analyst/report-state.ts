// Pure helpers for the F8 "open dashboard" the chat edits: tolerant loading of the persisted spec, the request body value,
// plain-language filter chips, and block placement across messages. No React. Contract: src/chat/report-types.ts.
// The server re-validates every spec it receives, so the checks here only protect the drawer from corrupt storage.
import type {ChatBlock} from '@/src/chat/block-types';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES, REPORT_SPEC_VERSION, type ReportFilters, type ReportSpec} from '../../src/chat/report-types';
import {upsertBlock, type PlacedBlock} from './chat-blocks-format';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tolerant loader for the persisted report: null for anything that is not a version 1 spec with filters and up to 12 id'd blocks. Never throws. */
export function sanitizeReport(raw: unknown): ReportSpec | null {
  try {
    if (!isObj(raw) || raw.spec_version !== REPORT_SPEC_VERSION || !isObj(raw.filters)) return null;
    if (!Array.isArray(raw.blocks) || raw.blocks.length > REPORT_MAX_BLOCKS) return null;
    if (!raw.blocks.every((b) => isObj(b) && typeof b.id === 'string' && b.id)) return null;
    return raw as unknown as ReportSpec;
  } catch {
    return null;
  }
}

/** The value for the request body's `report` field, or undefined (no report, or serialized over 32 KB: the server would refuse it). */
export function reportBody(spec: ReportSpec | null): ReportSpec | undefined {
  if (!spec) return undefined;
  try {
    return new TextEncoder().encode(JSON.stringify(spec)).length > REPORT_MAX_BYTES ? undefined : spec;
  } catch {
    return undefined;
  }
}

const RANGE_LABEL: Record<ReportFilters['range'], string> = {
  last_week: 'Last week',
  this_week: 'This week',
  last_month: 'Last month',
  all_available: 'All time',
  custom: 'Custom dates',
};
const PET_LABEL: Record<Exclude<ReportFilters['pet'], 'all'>, string> = {dog: 'Dogs', cat: 'Cats', both: 'Dog and cat', untagged: 'Untagged pets'};

/** '2026-09-11' -> '11 Sep'. Anything else is null. */
function shortDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${d.toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'})}`;
}

/** Plain-language chips for the open dashboard's filters. Neutral values (all pets, all events, all channels) get no chip. */
export function describeFilters(filters: ReportFilters): string[] {
  const chips: string[] = [];
  if (filters.pet !== 'all' && PET_LABEL[filters.pet]) chips.push(PET_LABEL[filters.pet]);
  if (filters.range === 'custom') {
    const a = shortDate(filters.from);
    const b = shortDate(filters.to);
    chips.push(a && b ? `${a} to ${b}` : RANGE_LABEL.custom);
  } else {
    chips.push(RANGE_LABEL[filters.range] ?? 'All time');
  }
  if (filters.event && filters.event !== 'all') chips.push(filters.event);
  if (filters.channel === 'offline') chips.push('Offline');
  return chips;
}

/**
 * Place a block the server just bound. An id already in the current message is replaced there. An id in an EARLIER message is
 * replaced in place (same message, same position, so a follow-up edits the earlier answer) ONLY when `held` says that id belongs
 * to the dashboard that is open right now (`held` = the ids of the open report's blocks). Otherwise it is a new block of the
 * current message even when an older message has the same id: after "Clear dashboard" the server numbers from b1 again, and the new
 * b1 must not overwrite the old b1 on screen. A new id is appended at `at`. `current` is the index of the assistant message being
 * streamed. Returns a new array.
 */
export function placeBlock<M extends {blocks?: PlacedBlock[]}>(messages: M[], current: number, block: ChatBlock, at: number, held: ReadonlySet<string>): M[] {
  const inCurrent = messages[current]?.blocks?.some((p) => p.block.id === block.id);
  if (!inCurrent && held.has(block.id)) {
    // the newest earlier message that draws this id is the one the open dashboard shows
    let earlier = -1;
    messages.forEach((m, i) => {
      if (i < current && m.blocks?.some((p) => p.block.id === block.id)) earlier = i;
    });
    if (earlier >= 0) return messages.map((m, i) => (i === earlier ? {...m, blocks: upsertBlock(m.blocks, at, block)} : m));
  }
  return messages.map((m, i) => (i === current ? {...m, blocks: upsertBlock(m.blocks, at, block)} : m));
}

/**
 * Remove blocks the server dropped from the open report (`remove_block`). Each id leaves the NEWEST message that draws it: that is
 * the one the open dashboard shows (an older message may hold a block of a cleared dashboard under the same id). Returns a new array.
 */
export function dropBlocks<M extends {blocks?: PlacedBlock[]}>(messages: M[], ids: ReadonlySet<string>): M[] {
  if (ids.size === 0) return messages;
  const at = new Map<string, number>();
  messages.forEach((m, i) => {
    for (const p of m.blocks ?? []) if (ids.has(p.block.id)) at.set(p.block.id, i);
  });
  if (at.size === 0) return messages;
  return messages.map((m, i) => {
    const gone = (m.blocks ?? []).filter((p) => at.get(p.block.id) === i);
    return gone.length > 0 ? {...m, blocks: (m.blocks ?? []).filter((p) => at.get(p.block.id) !== i)} : m;
  });
}

/**
 * Apply a `{t: 'report'}` event: blocks that were in the previous report and are absent from the new one were removed by the
 * server, so they leave the screen. Blocks the server drew but never recorded in a report (digest or product lookups have no
 * re-runnable recipe) are NOT in `held` and stay. `held` is only ever the ids of report specs, never of drawn blocks.
 */
export function applyReportEvent<M extends {blocks?: PlacedBlock[]}>(messages: M[], held: ReadonlySet<string>, spec: ReportSpec | null): {messages: M[]; held: Set<string>} {
  const next = new Set((spec?.blocks ?? []).map((b) => b.id));
  return {messages: dropBlocks(messages, new Set([...held].filter((id) => !next.has(id)))), held: next};
}
