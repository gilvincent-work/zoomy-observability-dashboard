import 'server-only';
import {authorize, canEdit, canView, isOwner, isReportId, normalizeEmail} from './reports-access';
import {isMissingTable, reportsReadClient, usingReportsMock, type DbError, type DbRow} from './reports-client';
import type {ReportDetail, ReportGetResult, ReportListItem, ReportListResult, ReportRow, ReportVersionMeta, ReportVersionRow, ReportVisibility} from './reports-types';

// F9 READ seam for Coop Reports. Server-only. Reads the two report tables through `reportsReadClient()` (GET and HEAD
// only). The service role bypasses RLS, so every reader takes the VIEWER's email and applies the access rules here
// (src/reports-access.ts): a page cannot forget to. Nothing here is cached (a saved report must show at once) and nothing
// calls a model. Statuses: `unconfigured` (Supabase env unset: demo mode), `not_setup` (the tables are missing: show
// "Reports not set up"), `not_found` (missing, malformed id, or hidden from this viewer: always a 404, never a 403),
// `deleted` (visible to this viewer but soft-deleted: the page says so and shows no data), `error`.

export const REPORT_LIST_LIMIT = 100;
const REPORT_COLUMNS = 'id,owner_email,title,visibility,pinned,current_version,deleted_at,created_at,updated_at';
const VERSION_META_COLUMNS = 'version,created_by,created_at,source_prompt';
const VERSION_COLUMNS = 'report_id,version,spec_version,spec,source_prompt,created_by,created_at';
const MAX_VERSIONS = 200;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function toReportRow(d: DbRow): ReportRow {
  return {
    id: str(d.id),
    owner_email: str(d.owner_email),
    title: str(d.title),
    visibility: (d.visibility === 'private' ? 'private' : 'team') as ReportVisibility,
    pinned: d.pinned === true,
    current_version: Number(d.current_version),
    deleted_at: strOrNull(d.deleted_at),
    created_at: str(d.created_at),
    updated_at: str(d.updated_at),
  };
}

const toMeta = (d: DbRow): ReportVersionMeta => ({version: Number(d.version), created_by: str(d.created_by), created_at: str(d.created_at), source_prompt: strOrNull(d.source_prompt)});

const toVersion = (d: DbRow): ReportVersionRow => ({
  report_id: str(d.report_id),
  version: Number(d.version),
  spec_version: Number(d.spec_version),
  spec: d.spec,
  source_prompt: strOrNull(d.source_prompt),
  created_by: str(d.created_by),
  created_at: str(d.created_at),
});

type Failure = {status: 'not_setup'} | {status: 'error'; message: string};
const GENERIC_READ_ERROR = 'The reports could not be read right now. Try again in a moment.';
/** The detail is logged here (code and message, never report content); the page only ever gets the generic line. */
const logged = (event: string, code: string | null, message: string): Failure => {
  console.error(JSON.stringify({event, code, message}));
  return {status: 'error', message: GENERIC_READ_ERROR};
};
const failure = (e: DbError): Failure => (isMissingTable(e) ? {status: 'not_setup'} : logged('reports_read_error', e.code ?? null, e.message));
const caught = (e: unknown): Failure => logged('reports_read_threw', null, e instanceof Error ? e.message : 'unknown');

/** Pinned first, then most recently updated, at most 100, only what `viewerEmail` may see. Deleted reports are not listed. */
export async function listReports(viewerEmail: string | null): Promise<ReportListResult> {
  if (usingReportsMock()) return {status: 'unconfigured'};
  const me = normalizeEmail(viewerEmail);
  if (me === '') return {status: 'ok', reports: []};
  try {
    const {client} = reportsReadClient();
    const base = () =>
      client
        .from('coop_reports')
        .select(REPORT_COLUMNS)
        .is('deleted_at', null)
        .order('pinned', {ascending: false})
        .order('updated_at', {ascending: false})
        .limit(REPORT_LIST_LIMIT);
    // Two reads instead of one `or=` filter: an email is never spliced into a filter string.
    const [team, mine] = await Promise.all([base().eq('visibility', 'team'), base().eq('visibility', 'private').eq('owner_email', me)]);
    const error = team.error ?? mine.error;
    if (error) return failure(error);
    const rows = [...(team.data ?? []), ...(mine.data ?? [])].map(toReportRow).filter((r) => canView(r, me) && r.deleted_at === null);
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at));
    const reports: ReportListItem[] = rows.slice(0, REPORT_LIST_LIMIT).map((r) => ({
      id: r.id,
      title: r.title,
      owner_email: r.owner_email,
      visibility: r.visibility,
      pinned: r.pinned,
      current_version: r.current_version,
      updated_at: r.updated_at,
      mine: isOwner(r, me),
    }));
    return {status: 'ok', reports};
  } catch (e) {
    return caught(e);
  }
}

/**
 * One report with its version list and ONE version's spec (the latest, or `version` for `?v=N`). A malformed id, a missing
 * report or version, and a private report of someone else all return the same `not_found`. A deleted one returns `deleted`
 * and nothing else: no title, no spec.
 */
export async function getReport(id: string, viewerEmail: string | null, version?: number): Promise<ReportGetResult> {
  if (usingReportsMock()) return {status: 'unconfigured'};
  if (!isReportId(id)) return {status: 'not_found'};
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) return {status: 'not_found'};
  try {
    const {client} = reportsReadClient();
    const head = await client.from('coop_reports').select(REPORT_COLUMNS).eq('id', id).maybeSingle();
    if (head.error) return failure(head.error);
    if (!head.data) return {status: 'not_found'};
    const report = toReportRow(head.data);
    const verdict = authorize(report, viewerEmail, 'view');
    if (!verdict.ok) return verdict.reason === 'deleted' ? {status: 'deleted'} : {status: 'not_found'};

    const list = await client.from('coop_report_versions').select(VERSION_META_COLUMNS).eq('report_id', id).order('version', {ascending: false}).limit(MAX_VERSIONS);
    if (list.error) return failure(list.error);
    const versions = (list.data ?? []).map(toMeta);
    // The newest version that EXISTS. `coop_reports.current_version` is only a cache that can lag after a crash (see reports-actions.ts), so it is never trusted.
    const latestVersion = versions[0]?.version;
    if (latestVersion === undefined) return {status: 'error', message: 'This report has no saved version.'};

    const target = version ?? latestVersion;
    const row = await client.from('coop_report_versions').select(VERSION_COLUMNS).eq('report_id', id).eq('version', target).maybeSingle();
    if (row.error) return failure(row.error);
    if (!row.data) return {status: 'not_found'};

    const detail: ReportDetail = {
      report,
      versions,
      viewing: toVersion(row.data),
      latestVersion,
      isLatest: target === latestVersion,
      canEdit: canEdit(report, viewerEmail),
      isOwner: isOwner(report, viewerEmail),
    };
    return {status: 'ok', detail};
  } catch (e) {
    return caught(e);
  }
}
