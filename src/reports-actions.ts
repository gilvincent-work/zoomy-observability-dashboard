'use server';

import {revalidatePath} from 'next/cache';
import {plainText} from './chat/bind';
import {fallbackTitle} from './reports-title';
import {getChatMetricData} from './chat/server';
import {validateSpec} from './chat/report-spec';
import {REPORT_MAX_BYTES} from './chat/report-types';
import {authorize, isReportId, type ReportAction} from './reports-access';
import {isMissingTable, reportsWriteClient, usingReportsMock, type DbError, type DbRow, type ReportsWriteClient} from './reports-client';
import {pinSpecDates, toStoredSpec} from './reports-run';
import {reportsViewerEmail} from './reports-session';
import type {ReportRow, ReportsActionResult, ReportVisibility, RestoreVersionInput, SaveReportInput, StoredSpec, UpdateReportInput} from './reports-types';

// F9 WRITE seam for Coop Reports: the ONLY place a report is created, changed, restored or deleted, always from a user
// click, always through `reportsWriteClient()` (service role behind a guarded fetch: the two report tables, GET/POST/PATCH).
// The chat tree cannot import this file (test/chat-architecture.test.ts), so the model can never save anything.
//
// Every action: (1) `auth()` first (reportsViewerEmail), no session returns an error with the database untouched;
// (2) demo mode (Supabase env unset) returns an error naming "demo mode"; (3) validates the input as untrusted; (4) loads the
// report and asks src/reports-access.ts whether this person may do this; (5) writes; (6) revalidates the pages. Actions
// return `{ok: false, error}` and never throw. The actor (owner_email, created_by) always comes from the session.
//
// Versioning without RPC or transactions (see supabase/coop_reports.sql). The VERSION ROW is the arbiter, the counter is not:
//   update / restore: (1) read the real highest version row and compare it with `expectedVersion` (a mismatch writes nothing);
//   (2) INSERT version N+1: the composite primary key (report_id, version) lets exactly one of any number of racing writers
//   win, and the losers (23505) get the stale-version error, never a retry; (3) advance `coop_reports.current_version` (and a
//   title changed in the same step) with `... and current_version < N+1 and deleted_at is null`. Step 3 is a cache: if it never
//   happens (a crash between the steps) or its response is lost, nothing is wedged, because every reader and every action
//   derives the version from the version rows (reports-data `latestVersion`, `latestVersionOf` below), and the next successful
//   write repairs the counter. A lost response on step 2 (the row exists, the caller saw an error) is the same: the next try
//   sees the real latest version and says "reload". Rename, pin, visibility and delete touch `coop_reports` only and create no
//   version. Database error text never reaches the UI: it is logged here (code and message, never report content).

const DEMO_MODE = 'Reports are not available in demo mode: set the Supabase archive env to save reports.';
const NOT_FOUND = 'Report not found.';
const DELETED = 'This report was deleted.';
const MAX_PROMPT = 2000;

const fail = (error: string): {ok: false; error: string} => ({ok: false, error});
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isVersion = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const isVisibility = (v: unknown): v is ReportVisibility => v === 'team' || v === 'private';

type Ctx = {email: string; client: ReportsWriteClient};

/** Session, then demo mode, then the client. The database is untouched until all three pass. */
async function begin(): Promise<{ok: true; ctx: Ctx} | {ok: false; error: string}> {
  const email = await reportsViewerEmail();
  if (!email) return fail('Sign in to use reports.');
  if (usingReportsMock()) return fail(DEMO_MODE);
  try {
    return {ok: true, ctx: {email, client: reportsWriteClient().client}};
  } catch (e) {
    console.error(JSON.stringify({event: 'reports_client_unavailable', message: e instanceof Error ? e.message : 'unknown'}));
    return fail(`Reports are unavailable: ${e instanceof Error ? e.message : 'the database client could not be created'}`);
  }
}

/** Run an action body behind `begin`, and turn any throw into an ActionResult. */
async function run<T extends object>(body: (ctx: Ctx) => Promise<ReportsActionResult<T>>): Promise<ReportsActionResult<T>> {
  const started = await begin();
  if (!started.ok) return started;
  try {
    return await body(started.ctx);
  } catch (e) {
    console.error(JSON.stringify({event: 'reports_action_failed', message: e instanceof Error ? e.message : 'unknown'}));
    return fail('Something went wrong with the report. Nothing was lost; try again.');
  }
}

const GENERIC_DB_ERROR = 'The report could not be saved. Nothing was changed; try again.';

/** Missing tables get their own hint; every other database error is logged here and returned as one short generic line. */
const dbFail = (e: DbError): {ok: false; error: string} => {
  if (isMissingTable(e)) return fail('Reports are not set up yet: apply supabase/coop_reports.sql.');
  console.error(JSON.stringify({event: 'reports_db_error', code: e.code ?? null, message: e.message}));
  return fail(GENERIC_DB_ERROR);
};

const staleMessage = (latest: number | null, nothing: string): string =>
  `This report changed since you opened it${latest ? ` (it is now version ${latest})` : ''}. Reload it and try again. Nothing was ${nothing}.`;

const ROW_COLUMNS = 'id,owner_email,title,visibility,pinned,current_version,deleted_at,created_at,updated_at';

const toRow = (d: DbRow): ReportRow => ({
  id: String(d.id),
  owner_email: String(d.owner_email),
  title: String(d.title),
  visibility: d.visibility === 'private' ? 'private' : 'team',
  pinned: d.pinned === true,
  current_version: Number(d.current_version),
  deleted_at: typeof d.deleted_at === 'string' ? d.deleted_at : null,
  created_at: String(d.created_at),
  updated_at: String(d.updated_at),
});

const DENIED: Record<ReportAction, string> = {
  view: NOT_FOUND,
  edit: NOT_FOUND,
  delete: 'Only the owner can delete this report.',
  visibility: 'Only the owner can change who sees this report.',
};

/** The report, if it exists and `email` may do `action` to it. Hidden reports look exactly like missing ones. */
async function loadAllowed(ctx: Ctx, id: unknown, action: ReportAction): Promise<{ok: true; row: ReportRow} | {ok: false; error: string}> {
  if (!isReportId(id)) return fail(NOT_FOUND);
  const res = await ctx.client.from('coop_reports').select(ROW_COLUMNS).eq('id', id).maybeSingle();
  if (res.error) return dbFail(res.error);
  const row = res.data ? toRow(res.data) : null;
  const verdict = authorize(row, ctx.email, action);
  if (!verdict.ok) return fail(verdict.reason === 'deleted' ? DELETED : verdict.reason === 'forbidden' ? DENIED[action] : NOT_FOUND);
  return {ok: true, row: row as ReportRow};
}

const refresh = (id: string): void => {
  revalidatePath('/reports');
  revalidatePath(`/reports/${id}`);
};

/** Plain text, never fed back to a model: control characters out, at most 2000 characters, empty becomes null. */
function cleanPrompt(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, MAX_PROMPT);
  return t === '' ? null : t;
}

/** Validate an untrusted draft again, strip anything but the recipe, require a block, and (optionally) pin the dates. */
async function prepareSpec(raw: unknown, pinDates: boolean, title: string): Promise<{ok: true; spec: StoredSpec} | {ok: false; error: string}> {
  const checked = validateSpec(raw);
  if (!checked.ok) return fail(checked.error);
  if (checked.spec.blocks.length === 0) return fail('Add at least one block before saving.');
  let stored: StoredSpec = toStoredSpec({...checked.spec, title}, false);
  if (pinDates) {
    let data;
    try {
      data = await getChatMetricData();
    } catch {
      return fail('The dates could not be pinned right now: the data is unavailable.');
    }
    const pinned = pinSpecDates({...checked.spec, title}, data, new Date());
    if (!pinned.ok) return fail(pinned.error);
    stored = pinned.spec;
  }
  if (Buffer.byteLength(JSON.stringify(stored), 'utf8') > REPORT_MAX_BYTES) return fail(`The report is larger than ${REPORT_MAX_BYTES} bytes.`);
  return {ok: true, spec: stored};
}

/** The highest version row that really exists for a report (the source of truth; `current_version` is only a cache of it). */
async function latestVersionOf(ctx: Ctx, id: string): Promise<{ok: true; latest: number | null} | {ok: false; error: string}> {
  const res = await ctx.client.from('coop_report_versions').select('version').eq('report_id', id).order('version', {ascending: false}).limit(1);
  if (res.error) return dbFail(res.error);
  const v = Number(res.data?.[0]?.version);
  return {ok: true, latest: Number.isInteger(v) ? v : null};
}

/** Best effort, never fails the action: the version row is already the committed fact. Zero rows back = another writer already moved the counter past `next`. */
async function advanceCounter(ctx: Ctx, id: string, next: number, patch: DbRow): Promise<{deleted: boolean}> {
  const now = new Date().toISOString();
  const moved = await ctx.client.from('coop_reports').update({...patch, current_version: next, updated_at: now}).eq('id', id).lt('current_version', next).is('deleted_at', null).select('id'); // pagination-ok: single-row write filtered by primary key, reads back only the row it wrote
  if (moved.error) console.error(JSON.stringify({event: 'reports_counter_not_advanced', code: moved.error.code ?? null, message: moved.error.message}));
  if (!moved.error && moved.data && moved.data.length > 0) return {deleted: false};
  // The counter did not move: the report may have been deleted in between, or a faster writer got there first. A title changed in
  // this step must still land, so it goes in a plain PATCH (the deleted check stays in the filter).
  if (Object.keys(patch).length > 0) {
    const plain = await ctx.client.from('coop_reports').update({...patch, updated_at: now}).eq('id', id).is('deleted_at', null).select('id'); // pagination-ok: single-row write filtered by primary key, reads back only the row it wrote
    if (!plain.error && (!plain.data || plain.data.length === 0)) return {deleted: true};
    if (plain.error) console.error(JSON.stringify({event: 'reports_title_not_saved', code: plain.error.code ?? null, message: plain.error.message}));
    return {deleted: false};
  }
  if (moved.error) return {deleted: false};
  const again = await ctx.client.from('coop_reports').select(ROW_COLUMNS).eq('id', id).maybeSingle();
  return {deleted: !!again.data && toRow(again.data).deleted_at !== null};
}

/**
 * Insert version `next` (the arbiter: the primary key picks one winner among racing writers; a duplicate is the stale error),
 * then advance the counter. `patch` rides with the counter step (a rename in the same save).
 */
async function appendVersion(
  ctx: Ctx,
  row: ReportRow,
  next: number,
  version: {spec: unknown; specVersion: number; prompt: string | null; nothing: string},
  patch: DbRow,
): Promise<ReportsActionResult<{id: string; version: number}>> {
  const inserted = await ctx.client
    .from('coop_report_versions') // pagination-ok: inserts one version row and reads back its own version
    .insert({report_id: row.id, version: next, spec_version: version.specVersion, spec: version.spec as DbRow, source_prompt: version.prompt, created_by: ctx.email})
    .select('version');
  if (inserted.error) return inserted.error.code === '23505' ? fail(staleMessage(null, version.nothing)) : dbFail(inserted.error);
  if (!inserted.data || inserted.data.length === 0) return fail('The new version could not be saved. Nothing was changed.');
  const {deleted} = await advanceCounter(ctx, row.id, next, patch);
  if (deleted) return fail(DELETED);
  refresh(row.id);
  return {ok: true, id: row.id, version: next};
}

/** Patch `coop_reports` only (no version). Zero rows back means the report is gone or was deleted in between. */
async function patchReport(ctx: Ctx, id: string, patch: DbRow): Promise<ReportsActionResult<{id: string}>> {
  const res = await ctx.client.from('coop_reports').update({...patch, updated_at: new Date().toISOString()}).eq('id', id).is('deleted_at', null).select('id'); // pagination-ok: single-row write filtered by primary key, reads back only the row it wrote
  if (res.error) return dbFail(res.error);
  if (!res.data || res.data.length === 0) return fail(`${NOT_FOUND} It may have been deleted.`);
  refresh(id);
  return {ok: true, id};
}

/** Create a report and its version 1 from a draft. Returns the new id (open /reports/<id>). */
export async function saveReport(input: SaveReportInput): Promise<ReportsActionResult<{id: string; version: number}>> {
  return run(async (ctx) => {
    if (!isRecord(input)) return fail('Nothing to save.');
    const visibility = input.visibility ?? 'team';
    if (!isVisibility(visibility)) return fail('Visibility must be team or private.');
    const draft = isRecord(input.spec) ? input.spec : null;
    const title = plainText(input.title ?? draft?.title) || fallbackTitle(draft, input.prompt);
    const prepared = await prepareSpec(input.spec, input.pinDates === true, title);
    if (!prepared.ok) return prepared;

    const created = await ctx.client.from('coop_reports').insert({owner_email: ctx.email, title, visibility}).select('id'); // pagination-ok: inserts one row and reads back its own id
    if (created.error) return dbFail(created.error);
    const id = created.data?.[0]?.id;
    if (!isReportId(id)) return fail('The report could not be created.');
    const version = await ctx.client
      .from('coop_report_versions') // pagination-ok: inserts one version row and reads back its own version
      .insert({report_id: id, version: 1, spec_version: prepared.spec.spec_version, spec: prepared.spec as unknown as DbRow, source_prompt: cleanPrompt(input.prompt), created_by: ctx.email})
      .select('version');
    if (version.error || !version.data || version.data.length === 0) {
      // No DELETE exists on this client: retire the half-made row softly so it never shows in a gallery. Also right when the insert
      // really landed but its response was lost: the report is then deleted with its version, which is consistent.
      const retired = await ctx.client.from('coop_reports').update({deleted_at: new Date().toISOString()}).eq('id', id).select('id'); // pagination-ok: single-row write filtered by primary key, reads back only the row it wrote
      if (retired.error) console.error(JSON.stringify({event: 'reports_orphan_not_retired', code: retired.error.code ?? null, message: retired.error.message}));
      return version.error ? dbFail(version.error) : fail('The report could not be saved.');
    }
    refresh(id);
    return {ok: true, id, version: 1};
  });
}

/** Save the draft as the next version. `expectedVersion` is the version the page showed: a mismatch writes nothing. */
export async function updateReport(input: UpdateReportInput): Promise<ReportsActionResult<{id: string; version: number}>> {
  return run(async (ctx) => {
    if (!isRecord(input) || !isVersion(input.expectedVersion)) return fail('Reload the report and try again.');
    const loaded = await loadAllowed(ctx, input.id, 'edit');
    if (!loaded.ok) return loaded;
    const {row} = loaded;
    const real = await latestVersionOf(ctx, row.id);
    if (!real.ok) return real;
    if (real.latest !== input.expectedVersion) return fail(staleMessage(real.latest, 'saved'));
    const title = input.title === undefined ? row.title : plainText(input.title);
    if (title === '') return fail('Give the report a title.');
    const prepared = await prepareSpec(input.spec, input.pinDates === true, title);
    if (!prepared.ok) return prepared;
    return appendVersion(ctx, row, input.expectedVersion + 1, {spec: prepared.spec, specVersion: prepared.spec.spec_version, prompt: cleanPrompt(input.prompt), nothing: 'saved'}, title === row.title ? {} : {title});
  });
}

/** Copy version N into a NEW latest version. Versions 1..N-1 are never touched. */
export async function restoreVersion(input: RestoreVersionInput): Promise<ReportsActionResult<{id: string; version: number}>> {
  return run(async (ctx) => {
    if (!isRecord(input) || !isVersion(input.version) || !isVersion(input.expectedVersion)) return fail('Reload the report and try again.');
    const loaded = await loadAllowed(ctx, input.id, 'edit');
    if (!loaded.ok) return loaded;
    const {row} = loaded;
    const real = await latestVersionOf(ctx, row.id);
    if (!real.ok) return real;
    if (real.latest !== input.expectedVersion) return fail(staleMessage(real.latest, 'restored'));
    if (input.version === real.latest) return fail('That is already the latest version.');
    const source = await ctx.client.from('coop_report_versions').select('spec,spec_version').eq('report_id', row.id).eq('version', input.version).maybeSingle();
    if (source.error) return dbFail(source.error);
    if (!source.data) return fail(`Version ${input.version} was not found.`);
    // Copied as stored, not re-validated: an old version whose metric was since removed must stay restorable (it renders an error card).
    return appendVersion(ctx, row, input.expectedVersion + 1, {spec: source.data.spec, specVersion: Number(source.data.spec_version), prompt: `Restored from version ${input.version}`, nothing: 'restored'}, {});
  });
}

/** Change the title. No version. */
export async function renameReport(input: {id: string; title: string}): Promise<ReportsActionResult<{id: string}>> {
  return run(async (ctx) => {
    if (!isRecord(input)) return fail(NOT_FOUND);
    const title = plainText(input.title);
    if (title === '') return fail('Give the report a title.');
    const loaded = await loadAllowed(ctx, input.id, 'edit');
    if (!loaded.ok) return loaded;
    return patchReport(ctx, loaded.row.id, {title});
  });
}

/** Pin or unpin a report in the gallery. No version. */
export async function setPinned(input: {id: string; pinned: boolean}): Promise<ReportsActionResult<{id: string}>> {
  return run(async (ctx) => {
    if (!isRecord(input) || typeof input.pinned !== 'boolean') return fail(NOT_FOUND);
    const loaded = await loadAllowed(ctx, input.id, 'edit');
    if (!loaded.ok) return loaded;
    return patchReport(ctx, loaded.row.id, {pinned: input.pinned});
  });
}

/** Team or private. Owner only. No version. */
export async function setVisibility(input: {id: string; visibility: ReportVisibility}): Promise<ReportsActionResult<{id: string}>> {
  return run(async (ctx) => {
    if (!isRecord(input) || !isVisibility(input.visibility)) return fail('Visibility must be team or private.');
    const loaded = await loadAllowed(ctx, input.id, 'visibility');
    if (!loaded.ok) return loaded;
    return patchReport(ctx, loaded.row.id, {visibility: input.visibility});
  });
}

/** Soft delete (sets deleted_at). Owner only. The report's page then says it was deleted and shows no data. */
export async function deleteReport(input: {id: string}): Promise<ReportsActionResult<{id: string}>> {
  return run(async (ctx) => {
    if (!isRecord(input)) return fail(NOT_FOUND);
    const loaded = await loadAllowed(ctx, input.id, 'delete');
    if (!loaded.ok) return loaded;
    return patchReport(ctx, loaded.row.id, {deleted_at: new Date().toISOString()});
  });
}
