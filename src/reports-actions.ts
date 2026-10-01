'use server';

import {revalidatePath} from 'next/cache';
import {plainText} from './chat/bind';
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
// Versioning without RPC or transactions (see supabase/coop_reports.sql): an update PATCHes `current_version` with the
// filters `id = $id and current_version = $expected and deleted_at is null`; zero rows back means a stale expected_version
// and NO version row is written. The version row is inserted AFTER a successful bump; if that insert fails the bump is
// rolled back (best effort). Rename, pin, visibility and delete touch `coop_reports` only and create no version.

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

const dbFail = (e: DbError): {ok: false; error: string} =>
  fail(isMissingTable(e) ? 'Reports are not set up yet: apply supabase/coop_reports.sql.' : `The report could not be saved (${e.message}).`);

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

/**
 * Bump `current_version` from `expected` to `expected + 1` (optimistic: zero rows back = stale, nothing written), then insert
 * the version row; roll the bump back if the insert fails. `patch` rides along with the bump (a rename in the same step).
 */
async function appendVersion(
  ctx: Ctx,
  row: ReportRow,
  expected: number,
  version: {spec: unknown; specVersion: number; prompt: string | null},
  patch: DbRow,
): Promise<ReportsActionResult<{id: string; version: number}>> {
  const next = expected + 1;
  const now = new Date().toISOString();
  const bump = await ctx.client
    .from('coop_reports')
    .update({...patch, current_version: next, updated_at: now})
    .eq('id', row.id)
    .eq('current_version', expected)
    .is('deleted_at', null)
    .select('id');
  if (bump.error) return dbFail(bump.error);
  if (!bump.data || bump.data.length === 0) {
    const again = await ctx.client.from('coop_reports').select(ROW_COLUMNS).eq('id', row.id).maybeSingle();
    if (again.data && toRow(again.data).deleted_at) return fail(DELETED);
    const now2 = again.data ? toRow(again.data).current_version : null;
    return fail(`This report changed since you opened it${now2 ? ` (it is now version ${now2})` : ''}. Reload it and try again. Nothing was saved.`);
  }
  const inserted = await ctx.client
    .from('coop_report_versions')
    .insert({report_id: row.id, version: next, spec_version: version.specVersion, spec: version.spec as DbRow, source_prompt: version.prompt, created_by: ctx.email})
    .select('version');
  if (inserted.error || !inserted.data || inserted.data.length === 0) {
    // Best effort: put the counter (and a title changed in the same step) back so the report is not left pointing at a missing version.
    await ctx.client.from('coop_reports').update({current_version: expected, title: row.title}).eq('id', row.id).eq('current_version', next).select('id');
    return inserted.error ? dbFail(inserted.error) : fail('The new version could not be saved. Nothing was changed.');
  }
  refresh(row.id);
  return {ok: true, id: row.id, version: next};
}

/** Patch `coop_reports` only (no version). Zero rows back means the report is gone or was deleted in between. */
async function patchReport(ctx: Ctx, id: string, patch: DbRow): Promise<ReportsActionResult<{id: string}>> {
  const res = await ctx.client.from('coop_reports').update({...patch, updated_at: new Date().toISOString()}).eq('id', id).is('deleted_at', null).select('id');
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
    const title = plainText(input.title ?? draft?.title);
    if (title === '') return fail('Give the report a title.');
    const prepared = await prepareSpec(input.spec, input.pinDates === true, title);
    if (!prepared.ok) return prepared;

    const created = await ctx.client.from('coop_reports').insert({owner_email: ctx.email, title, visibility}).select('id');
    if (created.error) return dbFail(created.error);
    const id = created.data?.[0]?.id;
    if (!isReportId(id)) return fail('The report could not be created.');
    const version = await ctx.client
      .from('coop_report_versions')
      .insert({report_id: id, version: 1, spec_version: prepared.spec.spec_version, spec: prepared.spec as unknown as DbRow, source_prompt: cleanPrompt(input.prompt), created_by: ctx.email})
      .select('version');
    if (version.error || !version.data || version.data.length === 0) {
      // No DELETE exists on this client: retire the half-made row softly so it never shows in a gallery.
      await ctx.client.from('coop_reports').update({deleted_at: new Date().toISOString()}).eq('id', id).select('id');
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
    if (row.current_version !== input.expectedVersion) {
      return fail(`This report changed since you opened it (it is now version ${row.current_version}). Reload it and try again. Nothing was saved.`);
    }
    const title = input.title === undefined ? row.title : plainText(input.title);
    if (title === '') return fail('Give the report a title.');
    const prepared = await prepareSpec(input.spec, input.pinDates === true, title);
    if (!prepared.ok) return prepared;
    return appendVersion(ctx, row, input.expectedVersion, {spec: prepared.spec, specVersion: prepared.spec.spec_version, prompt: cleanPrompt(input.prompt)}, title === row.title ? {} : {title});
  });
}

/** Copy version N into a NEW latest version. Versions 1..N-1 are never touched. */
export async function restoreVersion(input: RestoreVersionInput): Promise<ReportsActionResult<{id: string; version: number}>> {
  return run(async (ctx) => {
    if (!isRecord(input) || !isVersion(input.version) || !isVersion(input.expectedVersion)) return fail('Reload the report and try again.');
    const loaded = await loadAllowed(ctx, input.id, 'edit');
    if (!loaded.ok) return loaded;
    const {row} = loaded;
    if (row.current_version !== input.expectedVersion) {
      return fail(`This report changed since you opened it (it is now version ${row.current_version}). Reload it and try again. Nothing was restored.`);
    }
    if (input.version === row.current_version) return fail('That is already the latest version.');
    const source = await ctx.client.from('coop_report_versions').select('spec,spec_version').eq('report_id', row.id).eq('version', input.version).maybeSingle();
    if (source.error) return dbFail(source.error);
    if (!source.data) return fail(`Version ${input.version} was not found.`);
    // Copied as stored, not re-validated: an old version whose metric was since removed must stay restorable (it renders an error card).
    return appendVersion(ctx, row, input.expectedVersion, {spec: source.data.spec, specVersion: Number(source.data.spec_version), prompt: `Restored from version ${input.version}`}, {});
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
