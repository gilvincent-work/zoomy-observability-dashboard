// F9 contract: Coop Reports (saved, versioned dashboards). Types only, no logic. Shared by the data readers, the write
// actions, the run module and (Round 2) the pages. Design: knowledge/architecture/2026-10-01-talk-to-data-design.md § 5b.
import type {ReportFilters, ReportSpec} from './chat/report-types';

export type ReportVisibility = 'team' | 'private';

/** A row of `coop_reports`. */
export interface ReportRow {
  id: string;
  owner_email: string;
  title: string;
  visibility: ReportVisibility;
  /** Pinned to the top of the gallery. NOT "Pin dates" (that is `spec.filters.pinned`). */
  pinned: boolean;
  current_version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of `coop_report_versions`. `spec` is raw jsonb: untrusted, `runReport` validates it on every render. */
export interface ReportVersionRow {
  report_id: string;
  version: number;
  spec_version: number;
  spec: unknown;
  /** Plain text typed by a person. Render as text only; it never goes back into a model prompt. */
  source_prompt: string | null;
  created_by: string;
  created_at: string;
}

/** What the version dropdown shows: number, time, who and the prompt. No spec. */
export type ReportVersionMeta = Omit<ReportVersionRow, 'report_id' | 'spec' | 'spec_version'>;

/** One gallery card. No spec, no thumbnail. */
export interface ReportListItem {
  id: string;
  title: string;
  owner_email: string;
  visibility: ReportVisibility;
  pinned: boolean;
  current_version: number;
  updated_at: string;
  /** The viewer owns it (may delete and change visibility). */
  mine: boolean;
}

export interface ReportDetail {
  report: ReportRow;
  /** Newest first. */
  versions: ReportVersionMeta[];
  /** The version being shown: the latest, or the one asked for with `?v=N`. */
  viewing: ReportVersionRow;
  /** The newest version that exists. */
  latestVersion: number;
  isLatest: boolean;
  /** Rename, pin, update, restore: any viewer on a team report, the owner on a private one. */
  canEdit: boolean;
  /** Delete and visibility: the owner only. */
  isOwner: boolean;
}

/** Why a read returned nothing to show. `not_found` also covers "hidden from you" (404 semantics, never a 403). */
export type ReportsReadStatus = 'not_found' | 'deleted' | 'not_setup' | 'unconfigured' | 'error';

export type ReportListResult = {status: 'ok'; reports: ReportListItem[]} | {status: 'not_setup'} | {status: 'unconfigured'} | {status: 'error'; message: string};

export type ReportGetResult =
  | {status: 'ok'; detail: ReportDetail}
  | {status: 'not_found'}
  | {status: 'deleted'}
  | {status: 'not_setup'}
  | {status: 'unconfigured'}
  | {status: 'error'; message: string};

/** Same shape as `ActionResult` in pos-actions, plus the data a successful write returns. Actions never throw. */
export type ReportsActionResult<T extends object = Record<never, never>> = ({ok: true} & T) | {ok: false; error: string};

/** The spec as stored: `filters.pinned` may be true ("Pin dates"). Only the save actions ever write true. */
export type StoredFilters = Omit<ReportFilters, 'pinned'> & {pinned: boolean};
export type StoredSpec = Omit<ReportSpec, 'filters'> & {filters: StoredFilters};

/** What the save action takes from the drawer. The spec is untrusted and re-validated server side. */
export interface SaveReportInput {
  spec: unknown;
  /** Defaults to the spec's title. */
  title?: string;
  /** The last user message sent along with the draft. Plain text, at most 2000 characters. */
  prompt?: string | null;
  visibility?: ReportVisibility;
  /** Resolve the range once into fixed dates ("Pin dates"). */
  pinDates?: boolean;
}

export interface UpdateReportInput {
  id: string;
  expectedVersion: number;
  spec: unknown;
  prompt?: string | null;
  /** Renames in the same step. Omit to keep the title. */
  title?: string;
  /** The UI passes the toggle's current state; the client-sent spec can never switch pinning on by itself. */
  pinDates?: boolean;
}

export interface RestoreVersionInput {
  id: string;
  /** The version to copy into a new latest version. */
  version: number;
  /** The latest version the page showed. */
  expectedVersion: number;
}
