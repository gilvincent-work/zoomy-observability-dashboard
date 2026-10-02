// F9: who may do what to a saved report. Pure, no I/O. The service-role key bypasses RLS, so these rules ARE the access
// control: every page, reader and action asks here. Design § 5b "Access rules":
//   view   team reports: any signed-in user; private: the owner only. Anything not viewable is HIDDEN (404, never 403).
//   edit   rename, pin, update, restore: anyone who can view a team report; the owner of a private one.
//   owner  delete and visibility: the owner only.
//   a deleted report refuses every action and shows no data (its page says it was deleted).
import type {ReportRow} from './reports-types';

export type AccessRow = Pick<ReportRow, 'owner_email' | 'visibility' | 'deleted_at'>;
export type ReportAction = 'view' | 'edit' | 'delete' | 'visibility';
/** `hidden` = respond as if the report does not exist; `deleted` = say it was deleted; `forbidden` = visible, not allowed. */
export type Denial = 'hidden' | 'deleted' | 'forbidden';
export type Verdict = {ok: true} | {ok: false; reason: Denial};

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A report id is a uuid. Anything else is not found (and never reaches a query: PostgREST would answer 22P02). */
export const isReportId = (id: unknown): id is string => typeof id === 'string' && REPORT_ID.test(id);

export const normalizeEmail = (email: string | null | undefined): string => (email ?? '').trim().toLowerCase();

export const isOwner = (row: Pick<AccessRow, 'owner_email'>, email: string | null | undefined): boolean => {
  const me = normalizeEmail(email);
  return me !== '' && normalizeEmail(row.owner_email) === me;
};

/** May this person see the report exist at all (ignoring deletion)? */
export const canView = (row: AccessRow, email: string | null | undefined): boolean => {
  if (normalizeEmail(email) === '') return false;
  return row.visibility === 'team' || isOwner(row, email);
};

/** The one decision function. Hidden wins over deleted, so a stranger never learns that a private report existed. */
export function authorize(row: AccessRow | null | undefined, email: string | null | undefined, action: ReportAction): Verdict {
  if (!row || !canView(row, email)) return {ok: false, reason: 'hidden'};
  if (row.deleted_at) return {ok: false, reason: 'deleted'};
  if ((action === 'delete' || action === 'visibility') && !isOwner(row, email)) return {ok: false, reason: 'forbidden'};
  return {ok: true};
}

const allowed = (row: AccessRow, email: string | null | undefined, action: ReportAction): boolean => authorize(row, email, action).ok;

export const canEdit = (row: AccessRow, email: string | null | undefined): boolean => allowed(row, email, 'edit');
export const canDelete = (row: AccessRow, email: string | null | undefined): boolean => allowed(row, email, 'delete');
export const canChangeVisibility = (row: AccessRow, email: string | null | undefined): boolean => allowed(row, email, 'visibility');
