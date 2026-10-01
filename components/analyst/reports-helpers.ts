// Pure helpers for the F9 Coop Reports UI (gallery, report page, drawer save bar). No React, no I/O, no server-only, so the
// pages, the client views and the tests all share them. Contracts: src/reports-types.ts, src/reports-suggest.ts.
import type {ChatBlock, KpiBlock} from '../../src/chat/block-types';
import type {ReportSpec} from '../../src/chat/report-types';
import {suggestSave, type SavedReportRef} from '../../src/reports-suggest';
import type {ReportsReadStatus} from '../../src/reports-types';
import {sanitizeReport} from './report-state';

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------------------------------------------------

/** Versions are capped at 200 per report by the reader; anything beyond this is not a real version number. */
const MAX_VERSION_PARAM = 100000;

/** `?v=N`: a positive integer, else undefined (the latest version). Non-numeric, 0, negative, decimals and huge all mean latest. */
export function parseVersionParam(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^[0-9]{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 && n <= MAX_VERSION_PARAM ? n : undefined;
}

export const reportHref = (id: string, version?: number): string => (version === undefined ? `/reports/${id}` : `/reports/${id}?v=${version}`);

// ---------------------------------------------------------------------------------------------------------------------
// Time and labels (always Philippine time, explicitly, so the server and the browser print the same string)
// ---------------------------------------------------------------------------------------------------------------------

const TZ = 'Asia/Manila';

/** '2026-09-27T06:02:00Z' -> 'Sep 27, 2:02 PM'. An unreadable date is ''. */
export function formatReportTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ});
}

/** '2026-09-27' -> 'Sep 27'. Anything else is ''. */
export function formatReportDay(day: string | null): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return '';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
}

/** 'Version 3 (latest)' or 'Version 2'. */
export function versionTitle(version: number, latest: number): string {
  return version === latest ? `Version ${version} (latest)` : `Version ${version}`;
}

/** The dropdown's second line: 'Sep 27, 2:02 PM by alice@zoomy.ph'. */
export function versionSummary(meta: {created_at: string; created_by: string}): string {
  const when = formatReportTime(meta.created_at);
  return [when, meta.created_by ? `by ${meta.created_by}` : ''].filter(Boolean).join(' ');
}

/** The header's badge text: 'Live, data through Sep 27, refreshed 2:02 PM' or 'Pinned Sep 11 to Sep 27, 2026'. */
export function statusLine(run: {mode: 'live' | 'pinned'; rangeLabel: string | null; dataThrough: string | null}, now: Date): string {
  if (run.mode === 'pinned') return run.rangeLabel ? `Pinned ${run.rangeLabel}` : 'Pinned dates';
  const through = formatReportDay(run.dataThrough);
  const refreshed = now.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', timeZone: TZ});
  return `Live${through ? `, data through ${through}` : ''}, refreshed ${refreshed}`;
}

/** Calm copy for a read that returned nothing to show. `not_found` never reaches this (the page calls notFound()). */
export function noticeFor(status: Exclude<ReportsReadStatus, 'not_found' | 'deleted'>, message?: string): {title: string; body: string} {
  switch (status) {
    case 'not_setup':
      return {title: 'Reports not set up', body: 'Reports are not switched on for this project yet. A person needs to apply the reports SQL file in Supabase first.'};
    case 'unconfigured':
      return {title: 'Reports need the Supabase connection', body: 'This is demo mode, so saved reports are not available. Connect the Supabase archive to use them.'};
    default:
      return {title: 'Reports could not be loaded', body: message && message.length <= 160 ? message : 'Something went wrong while loading. Try again in a moment.'};
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Block layout on the report page
// ---------------------------------------------------------------------------------------------------------------------

export type LayoutItem =
  /** Adjacent stat tiles: one wrapping row, full width. */
  | {kind: 'kpis'; key: string; blocks: KpiBlock[]}
  /** A chart: one column of two on wide screens. */
  | {kind: 'chart'; key: string; block: ChatBlock}
  /** A table: full width, scrolls sideways. */
  | {kind: 'table'; key: string; block: ChatBlock}
  /** A block that could not run: one column, never stops the others. */
  | {kind: 'error'; key: string; id: string; error: string};

export type RunBlockLike = ChatBlock | {id: string; error: string};

/** Group the run's blocks (in spec order) for the page grid. */
export function layoutBlocks(blocks: RunBlockLike[]): LayoutItem[] {
  const out: LayoutItem[] = [];
  let run: KpiBlock[] = [];
  const flush = () => {
    if (run.length) out.push({kind: 'kpis', key: `kpis-${run[0].id}`, blocks: run});
    run = [];
  };
  for (const b of blocks) {
    if ('error' in b) {
      flush();
      out.push({kind: 'error', key: b.id, id: b.id, error: b.error});
    } else if (b.kind === 'kpi') {
      run.push(b);
    } else {
      flush();
      out.push({kind: b.kind === 'chart' ? 'chart' : 'table', key: b.id, block: b});
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawer: the save bar
// ---------------------------------------------------------------------------------------------------------------------

export const SAVED_KEY = 'coop-report-saved-v1';
const MAX_PROMPT = 2000;

/** The persisted `{id, version, spec}` of this conversation's last Save/Update. Tolerant: anything else is null. Never throws. */
export function loadSavedRef(raw: string | null | undefined): SavedReportRef | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || typeof v.id !== 'string' || v.id === '' || v.id.length > 64) return null;
    if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) return null;
    if (!isRecord(v.spec)) return null;
    return {id: v.id, version: v.version, spec: v.spec};
  } catch {
    return null;
  }
}

export function serializeSavedRef(ref: SavedReportRef): string {
  return JSON.stringify({id: ref.id, version: ref.version, spec: ref.spec});
}

/** The last thing the user typed, sent along as the report's source prompt. Null when the conversation has no user message. */
export function lastUserPrompt(messages: ReadonlyArray<{role: 'user' | 'assistant'; content: string}>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const text = messages[i].content.trim();
      return text ? text.slice(0, MAX_PROMPT) : null;
    }
  }
  return null;
}

/** A stored spec as the drawer's current report: the Pin dates flag is a saved-report property, never part of the draft. */
export function toDrawerSpec(stored: unknown): ReportSpec | null {
  const spec = sanitizeReport(stored);
  return spec ? {...spec, filters: {...spec.filters, pinned: false}} : null;
}

/** Whether an Update should keep fixed dates: the saved version had them and the draft is still a custom range. */
export function pinDatesFor(saved: SavedReportRef | null, report: ReportSpec): boolean {
  const filters = saved && isRecord(saved.spec) && isRecord(saved.spec.filters) ? saved.spec.filters : null;
  return filters?.pinned === true && report.filters.range === 'custom';
}

export type SaveBarState =
  | {kind: 'none'}
  | {kind: 'save' | 'update' | 'saved'; /** An action is in flight, or the chat is still answering. */ disabled: boolean; pending: boolean; error: string | null};

/**
 * What the drawer's save bar shows. `none`: nothing open, or no blocks yet. `save`: a draft not saved yet. `update`: a saved
 * report whose draft now differs. `saved`: saved and unchanged. `pending` is an action in flight; `busy` is the chat streaming
 * (saving a half-finished answer would store a half-finished recipe), and either one disables the buttons.
 */
export function saveBarState(report: ReportSpec | null, saved: SavedReportRef | null, flags: {pending: boolean; busy: boolean; error: string | null}): SaveBarState {
  if (!report || report.blocks.length === 0) return {kind: 'none'};
  const kind = suggestSave(report, saved) ?? 'saved';
  return {kind, pending: flags.pending, disabled: flags.pending || flags.busy, error: flags.error};
}

/** Action errors for the bar. A stale version gets one plain sentence; everything else is the server's own words. */
export function friendlySaveError(message: string): string {
  if (/changed since you opened|reload the report/i.test(message)) return 'This report changed elsewhere. Open it to see the latest.';
  return message;
}
