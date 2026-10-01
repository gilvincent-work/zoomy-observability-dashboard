// F8 contract: the current report ("dashboard") the chat edits. Types only, no logic. Shared by the server (validate,
// run, edit tools) and the drawer (holds the latest spec, sends it back with each request). Only the RECIPE lives here:
// never data, never model-written prose. Design: knowledge/architecture/2026-10-01-talk-to-data-design.md § 5b.
import type {MetricRequest} from './result-types';

export const REPORT_SPEC_VERSION = 1;
export const REPORT_MAX_BLOCKS = 12;
export const REPORT_MAX_BYTES = 32 * 1024;

/** Shared by every block. `pinned` is reserved for F9 (Pin dates); F8 always writes false. */
export interface ReportFilters {
  range: MetricRequest['range'];
  from: string; // YYYY-MM-DD or ''
  to: string; // YYYY-MM-DD or ''
  pet: MetricRequest['pet'];
  event: string; // 'all' or an event name/id
  channel: MetricRequest['channel'];
  pinned: false;
}

/** What a block asks of the registry. Filters are NOT here: they come from the report. */
export type ReportQuery = Pick<MetricRequest, 'metric' | 'dimension' | 'measure' | 'compare_to' | 'sort' | 'limit'>;

export type ReportBlockSpec =
  | {id: string; kind: 'kpi'; query: ReportQuery; view: {value: string; label: string; format: 'peso' | 'count' | 'percent'}}
  | {
      id: string;
      kind: 'chart';
      query: ReportQuery;
      view: {kind: string; orientation: 'auto' | 'vertical' | 'horizontal'; mode: 'auto' | 'user'; x: string; y: string[]; title: string};
    }
  | {id: string; kind: 'table'; query: ReportQuery; view: {columns: string[]; title: string}};

export interface ReportSpec {
  spec_version: typeof REPORT_SPEC_VERSION;
  title: string;
  filters: ReportFilters;
  blocks: ReportBlockSpec[];
}
