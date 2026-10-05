import 'server-only';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {fetchAllRows} from './pos-fetch-paginate';
import type {PosSaleRow} from './goldline-csv';
import type {ExtractedPage} from './goldline-extract-run';

// Server-only writes/reads for the Goldline gl_* tables. Same seam as src/data.ts:
// the archive Supabase project, service-role key, never exposed to the browser.
// Every row is stamped with company_id; callers pass the ACTIVE company from the
// scoping layer (src/active-context.ts) so one tenant can never write another's data.

const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
export const GOLDLINE_BUCKET = 'goldline-uploads';

/** True when the archive env is absent — callers should refuse writes, not no-op silently. */
export function goldlineConfigured(): boolean {
  return Boolean(url && key);
}

function db(): SupabaseClient {
  if (!goldlineConfigured()) throw new Error('Goldline storage is not configured (SUPABASE_URL_ARCHIVE).');
  return createClient(url as string, key as string, {auth: {persistSession: false}});
}

/**
 * Reduce an uploaded file name to a single safe Storage path segment: basename
 * only (drop any directory parts), `..` collapsed, and anything outside
 * [A-Za-z0-9._-] (including control chars and separators) replaced with `_`.
 * Defense-in-depth so a crafted `file.name` can never climb out of the
 * `${companyId}/` prefix or break the `company_id/rest` split of storage_path.
 */
export function safeObjectName(filename: string): string {
  const base = (filename || '').split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/\.{2,}/g, '.') // collapse .. so no path traversal survives
    .replace(/[^A-Za-z0-9._-]/g, '_') // control chars, spaces, separators → _
    .replace(/^\.+/, ''); // no leading dots (hidden / relative)
  return cleaned.slice(0, 180) || 'upload';
}

export type UploadKind = 'pos_csv' | 'inventory_pdf';
export type UploadStatus = 'processing' | 'needs_review' | 'committed' | 'failed' | 'rejected';
export type Period = {start: string; end: string}; // ISO dates

export type UploadRow = {
  id: string;
  company_id: string;
  kind: UploadKind;
  filename: string;
  status: UploadStatus;
  page_count: number | null;
  reject_reason: string | null;
  uploaded_by: string | null;
  created_at: string;
};

/** Store the raw file, then open a gl_uploads row. Returns the new upload id. */
export async function createUpload(input: {
  companyId: string;
  kind: UploadKind;
  filename: string;
  bytes: ArrayBuffer;
  contentType: string;
  uploadedBy: string | null;
}): Promise<string> {
  const supa = db();
  // Original name kept for display in the row; the storage KEY uses the sanitized
  // basename so a crafted filename can't escape the company prefix.
  const path = `${input.companyId}/${Date.now()}-${safeObjectName(input.filename)}`;
  const up = await supa.storage
    .from(GOLDLINE_BUCKET)
    .upload(path, input.bytes, {contentType: input.contentType, upsert: false});
  if (up.error) throw new Error(`storage upload failed: ${up.error.message}`);

  const ins = await supa
    .from('gl_uploads')
    .insert({
      company_id: input.companyId,
      kind: input.kind,
      filename: input.filename,
      storage_path: path,
      status: 'processing' satisfies UploadStatus,
      uploaded_by: input.uploadedBy,
    })
    .select('id')
    .single();
  if (ins.error) throw new Error(`gl_uploads insert failed: ${ins.error.message}`);
  return (ins.data as {id: string}).id;
}

export async function setUploadStatus(
  id: string,
  status: UploadStatus,
  extra?: {rejectReason?: string; pageCount?: number},
): Promise<void> {
  const supa = db();
  const patch: Record<string, unknown> = {status};
  if (extra?.rejectReason !== undefined) patch.reject_reason = extra.rejectReason;
  if (extra?.pageCount !== undefined) patch.page_count = extra.pageCount;
  const res = await supa.from('gl_uploads').update(patch).eq('id', id);
  if (res.error) throw new Error(`gl_uploads update failed: ${res.error.message}`);
}

/** Idempotent upsert of POS sale rows for one company + period (keyed on the natural key). */
export async function upsertSales(
  companyId: string,
  rows: PosSaleRow[],
  period: Period,
  uploadId: string,
): Promise<number> {
  if (!rows.length) return 0;
  const supa = db();
  const payload = rows.map((r) => ({
    company_id: companyId,
    store_code: r.storeCode,
    sku_code: r.skuCode,
    period_start: period.start,
    period_end: period.end,
    gross_retail: r.grossRetail,
    units: r.units,
    net_of_vat: r.netOfVat,
    source_upload_id: uploadId,
  }));
  const res = await supa
    .from('gl_sales')
    .upsert(payload, {onConflict: 'company_id,store_code,sku_code,period_start,period_end'});
  if (res.error) throw new Error(`gl_sales upsert failed: ${res.error.message}`);
  return payload.length;
}

/** Stage one extracted page for review (gl_extractions). Idempotent on (upload, page). */
export async function saveExtraction(input: {
  companyId: string;
  uploadId: string;
  page: number;
  extracted: ExtractedPage;
  docConfidence: number;
}): Promise<void> {
  const supa = db();
  const res = await supa.from('gl_extractions').upsert(
    {
      company_id: input.companyId,
      upload_id: input.uploadId,
      page: input.page,
      rows: input.extracted.rows,
      doc_confidence: input.docConfidence,
      status: 'pending_review',
    },
    {onConflict: 'upload_id,page'},
  );
  if (res.error) throw new Error(`gl_extractions upsert failed: ${res.error.message}`);
}

/** List a company's uploads, newest first (paginated — never silently capped). */
export async function listUploads(companyId: string): Promise<UploadRow[]> {
  if (!goldlineConfigured()) return [];
  const supa = db();
  const rows = await fetchAllRows('gl_uploads', (from, to) =>
    supa
      .from('gl_uploads')
      .select('id,company_id,kind,filename,status,page_count,reject_reason,uploaded_by,created_at')
      .eq('company_id', companyId)
      .order('created_at', {ascending: false})
      .order('id', {ascending: true})
      .range(from, to),
  );
  return rows as unknown as UploadRow[];
}
