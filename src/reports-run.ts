// F9: run a saved report. PURE: no I/O, no model, no server-only, no Supabase. The spec is a stored recipe (untrusted:
// someone may have edited the row, or the registry may have changed since it was saved); the data and `now` are injected.
// Every block is re-run through the SAME pure machinery the chat uses (runMetric, then the report session's rebind), so a
// saved block renders exactly as it did in chat, with ZERO model calls. Design: § 5b Security.
//
// Decisions:
//  - The spec is validated again here, header first (title, filters, size, 12-block cap: a failure refuses the whole report
//    and nothing runs), then block by block. validateSpec is all-or-nothing, so each block is validated as a one-block
//    spec: a block whose metric (or dimension, or measure) no longer exists becomes an error card and the others still render.
//  - Relative ranges (last_week, this_week, last_month, all_available) re-resolve against `now` on every run: that is "Live".
//  - "Pin dates" is resolved ONCE, at save time (pinSpecDates): the range becomes `custom` with its resolved from/to and
//    `filters.pinned = true`. From then on it is simply a custom range, so the dates stay fixed on every later run. A stored
//    spec that says pinned but is not a custom range is treated as live (its dates were never fixed).
//  - `validateSpec` (shared with the chat) forces `pinned: false`, so the flag is read from the raw header here, and only
//    the save actions ever write it as true.
import type {BlockCoverage} from './chat/report-session';
import {createReportSession} from './chat/report-session';
import type {ChatBlock} from './chat/block-types';
import {runMetric} from './chat/query-metric';
import {rangeLabel} from './chat/range';
import {requestOf, validateSpec} from './chat/report-spec';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES, type ReportBlockSpec, type ReportFilters, type ReportSpec} from './chat/report-types';
import type {MetricData} from './chat/result-types';
import type {StoredFilters, StoredSpec} from './reports-types';

/** What a block that cannot render shows instead. */
export interface BlockErrorCard {
  id: string;
  error: string;
}
export type RunBlock = ChatBlock | BlockErrorCard;
export const isBlockError = (b: RunBlock): b is BlockErrorCard => 'error' in b;

export const METRIC_GONE = 'Metric no longer available';

export interface ReportRunOk {
  ok: true;
  title: string;
  filters: StoredFilters;
  pinned: boolean;
  /** 'pinned' = fixed dates ("Pinned Sep 11 to Sep 27"), 'live' = re-resolved now ("Live, data through ..."). */
  mode: 'live' | 'pinned';
  /** The resolved range, e.g. "Sep 11 to Sep 27, 2026"; null when no block could run. */
  rangeLabel: string | null;
  /** Plain-words scope: range, pet, event, channel. */
  filtersLabel: string;
  /** The latest day any block's data covers (YYYY-MM-DD), for "data through Sep 27". */
  dataThrough: string | null;
  /** In spec order, one per block: a rendered block or an error card. */
  blocks: RunBlock[];
  coverage: BlockCoverage[];
}
export type ReportRun = ReportRunOk | {ok: false; error: string};

const BLOCK_ID = /^b[1-9][0-9]{0,2}$/; // same shape validateSpec enforces (it does not export it)
const PET_LABEL: Record<ReportFilters['pet'], string> = {all: 'All pets', dog: 'Dogs', cat: 'Cats', both: 'Dog and cat', untagged: 'No pet tag'};
const CHANNEL_LABEL: Record<ReportFilters['channel'], string> = {offline: 'Offline', all: 'All channels'};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

export const toStoredSpec = (spec: ReportSpec, pinned: boolean): StoredSpec => ({...spec, filters: {...spec.filters, pinned}});

function scopeLabel(f: ReportFilters, range: string | null): string {
  const when = range ?? (f.range === 'custom' ? rangeLabel(f.from, f.to) : f.range.replace(/_/g, ' '));
  return [when, PET_LABEL[f.pet], f.event === 'all' ? 'All events' : `Event: ${f.event}`, CHANNEL_LABEL[f.channel]].join(' · ');
}

/** The raw block's own id when it is well formed and unique, else null (the whole report is then refused). */
function idsOf(blocks: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const b of blocks) {
    const id = isRecord(b) ? own(b, 'id') : undefined;
    if (typeof id !== 'string' || !BLOCK_ID.test(id) || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Run a stored spec against `data` as of `now`. Returns `{ok: false}` (nothing executed) for a spec that cannot be trusted
 * as a whole: not an object, over 32 KB, a wrong spec_version, bad filters, more than 12 blocks, bad or duplicate block ids.
 * Otherwise every block yields either its rendered ChatBlock or an `{id, error}` card.
 */
export function runReport(raw: unknown, data: MetricData, now: Date): ReportRun {
  if (!isRecord(raw)) return {ok: false, error: 'The report is not a valid recipe.'};
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    return {ok: false, error: 'The report could not be read.'};
  }
  if (size > REPORT_MAX_BYTES) return {ok: false, error: `The report is larger than ${REPORT_MAX_BYTES} bytes.`};
  const rawBlocks = own(raw, 'blocks');
  if (!Array.isArray(rawBlocks)) return {ok: false, error: 'blocks must be a list.'};
  if (rawBlocks.length > REPORT_MAX_BLOCKS) return {ok: false, error: `A report holds at most ${REPORT_MAX_BLOCKS} blocks.`};
  const ids = idsOf(rawBlocks);
  if (!ids) return {ok: false, error: 'Block ids must look like b1 and be unique.'};

  const header = validateSpec({...raw, blocks: []});
  if (!header.ok) return {ok: false, error: header.error};
  const filters = header.spec.filters;
  const rawFilters = own(raw, 'filters');
  const pinned = isRecord(rawFilters) && own(rawFilters, 'pinned') === true && filters.range === 'custom';

  const blocks: RunBlock[] = [];
  const coverage: BlockCoverage[] = [];
  let resolved: string | null = null;
  let dataThrough: string | null = null;

  rawBlocks.forEach((rawBlock, i) => {
    const id = ids[i];
    const checked = validateSpec({...header.spec, blocks: [rawBlock]});
    if (!checked.ok) {
      blocks.push({id, error: /unknown metric|is not declared by/.test(checked.error) ? METRIC_GONE : `This block is no longer valid: ${checked.error}`});
      return;
    }
    try {
      const block: ReportBlockSpec = checked.spec.blocks[0];
      const session = createReportSession(checked.spec);
      // An empty filter patch re-runs the block with the report's own filters and rebinds it exactly as the chat does.
      const out = session.setFilters({}, data, now);
      if (!out.ok) {
        const result = runMetric(requestOf(block.query, filters), data, now);
        blocks.push({id, error: 'error' in result ? result.error : 'This block could not be run.'});
        return;
      }
      const drawn = out.blocks.find((b) => b.id === id);
      if (!drawn) {
        blocks.push({id, error: 'This block could not be drawn.'});
        return;
      }
      blocks.push(drawn);
      coverage.push(...out.coverage);
      const meta = session.store.get(id)?.meta;
      resolved ??= meta?.range.label ?? null;
      const through = out.coverage[0]?.covered_to ?? null;
      if (through && (dataThrough === null || through > dataThrough)) dataThrough = through;
    } catch (e) {
      // One block's maths throwing (bad data under one metric) must not turn the whole page into a 500: it becomes an error card.
      console.error(JSON.stringify({event: 'report_block_failed', block: id, name: e instanceof Error ? e.name : 'unknown'}));
      blocks.push({id, error: 'This block could not be calculated.'});
    }
  });

  return {
    ok: true,
    title: header.spec.title,
    filters: {...filters, pinned},
    pinned,
    mode: pinned ? 'pinned' : 'live',
    rangeLabel: resolved,
    filtersLabel: scopeLabel(filters, resolved),
    dataThrough,
    blocks,
    coverage,
  };
}

/**
 * "Pin dates": resolve the report's range ONCE (as of `now`) into fixed from/to dates and mark the spec pinned. The first
 * block decides the dates (every block shares the filters, so they all resolve alike). Refused when there is no block to
 * resolve against or the resolved dates would not run as a custom range (for example more than 400 days).
 */
export function pinSpecDates(spec: ReportSpec, data: MetricData, now: Date): {ok: true; spec: StoredSpec} | {ok: false; error: string} {
  const first = spec.blocks[0];
  if (!first) return {ok: false, error: 'Add a block before pinning dates.'};
  const live = runMetric(requestOf(first.query, spec.filters), data, now);
  if ('error' in live) return {ok: false, error: `These dates cannot be pinned: ${live.error}`};
  const {from, to} = live.meta.range;
  const fixed: ReportFilters = {...spec.filters, range: 'custom', from, to, pinned: false};
  const check = runMetric(requestOf(first.query, fixed), data, now);
  if ('error' in check) return {ok: false, error: `These dates cannot be pinned: ${check.error}`};
  return {ok: true, spec: toStoredSpec({...spec, filters: fixed}, true)};
}
