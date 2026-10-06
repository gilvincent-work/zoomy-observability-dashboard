import {auth} from '@/auth';
import {getDataContext} from '@/src/active-context';
import {canEditData, outOfScopeStores} from '@/src/company';
import {classifyUpload} from '@/src/goldline-upload';
import {parseGoldlinePos} from '@/src/goldline-csv';
import {
  createUpload,
  goldlineConfigured,
  saveExtraction,
  setUploadStatus,
  upsertSales,
} from '@/src/goldline-data';
import {extractInventoryPage, extractionConfigured, type ExtractedPage} from '@/src/goldline-extract-run';
import {humanizeExtractError} from '@/src/goldline-extract';

// Goldline upload endpoint. Accepts ONE file (multipart/form-data, field `file`)
// scoped to the active company (?company=<slug>):
//   • .csv  → parse → idempotent upsert into gl_sales (needs period_start/_end)
//   • .pdf  → store → Claude Vision reads page 1 → staged in gl_extractions for review
// Tenant isolation is enforced here (getDataContext + canEditData); the data-blind
// Coop Admin and read-only analysts are refused. File-type gating is the first check.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Page-level confidence = mean of the per-row confidences (0 when empty). */
function avgConfidence(page: ExtractedPage): number {
  const cs = page.rows.map((r) => r.confidence).filter((c) => typeof c === 'number');
  if (!cs.length) return 0;
  return cs.reduce((a, b) => a + b, 0) / cs.length;
}

/** Accept only a full ISO date (YYYY-MM-DD) for the sales period. */
function isoDate(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function POST(req: Request): Promise<Response> {
  const requested = new URL(req.url).searchParams.get('company');

  // Scope first: null means not signed in, no membership, or a data-blind Coop Admin.
  const ctx = await getDataContext(requested);
  if (!ctx || !ctx.companyId) return json({error: 'Not authorized to upload for this company.'}, 403);
  if (!canEditData(ctx.role)) return json({error: 'Your role cannot upload data.'}, 403);
  if (!goldlineConfigured()) return json({error: 'Uploads are not configured (archive env missing).'}, 503);

  const session = await auth();
  const uploadedBy = session?.user?.email ?? null;
  const companyId = ctx.companyId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({error: 'Expected multipart/form-data.'}, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return json({error: 'No file provided (field "file").'}, 400);

  // Gate: only .csv / .pdf, within the size cap. Rejected files never get stored.
  const cls = classifyUpload(file.name, file.type, file.size);
  if (!cls.ok) return json({error: cls.reason, status: 'rejected'}, 415);

  const bytes = await file.arrayBuffer();

  let uploadId: string;
  try {
    uploadId = await createUpload({
      companyId,
      kind: cls.kind,
      filename: file.name,
      bytes,
      contentType: cls.contentType,
      uploadedBy,
    });
  } catch (e) {
    console.error('goldline upload: store failed', e);
    return json({error: 'Could not store the file — please try again.'}, 500);
  }

  // --- POS sales CSV -------------------------------------------------------
  if (cls.kind === 'pos_csv') {
    const start = isoDate(form.get('period_start'));
    const end = isoDate(form.get('period_end'));
    if (!start || !end) {
      await setUploadStatus(uploadId, 'failed', {rejectReason: 'Missing period_start / period_end (YYYY-MM-DD).'});
      return json({uploadId, status: 'failed', error: 'A POS upload needs period_start and period_end (YYYY-MM-DD).'}, 422);
    }
    const {rows, errors} = parseGoldlinePos(new TextDecoder().decode(bytes));
    if (!rows.length) {
      await setUploadStatus(uploadId, 'failed', {rejectReason: errors[0] ?? 'No rows parsed.'});
      return json({uploadId, status: 'failed', errors}, 422);
    }
    // Intra-tenant fence: a store_manager may only upload rows for their stores.
    // company_id already matches; the DB can't see store scope, so enforce it here.
    const outCsv = outOfScopeStores(ctx.storeScope, rows.map((r) => r.storeCode));
    if (outCsv.length) {
      const reason = `Upload includes stores outside your access: ${outCsv.slice(0, 10).join(', ')}.`;
      await setUploadStatus(uploadId, 'rejected', {rejectReason: reason});
      return json({uploadId, status: 'rejected', error: reason}, 403);
    }
    try {
      const committed = await upsertSales(companyId, rows, {start, end}, uploadId);
      await setUploadStatus(uploadId, 'committed');
      return json({uploadId, status: 'committed', rowsCommitted: committed, warnings: errors});
    } catch (e) {
      console.error('goldline upload: gl_sales commit failed', e);
      await setUploadStatus(uploadId, 'failed', {rejectReason: 'Could not save sales rows.'});
      return json({uploadId, status: 'failed', error: 'Could not save sales rows — please try again.'}, 500);
    }
  }

  // --- Inventory PDF -------------------------------------------------------
  // Without a key the file is kept for manual review rather than silently dropped.
  if (!extractionConfigured()) {
    await setUploadStatus(uploadId, 'needs_review', {pageCount: 1});
    return json({
      uploadId,
      status: 'needs_review',
      note: 'Stored. Extraction is not configured (ANTHROPIC_API_KEY missing) — review manually.',
    });
  }

  const pdfBase64 = Buffer.from(bytes).toString('base64');
  const page = 1; // v1 extracts page 1 (only page 1 has an enumerated manifest yet).
  try {
    const extracted = await extractInventoryPage(pdfBase64, page);
    // Page 1's manifest forces one row per printed item code, so a real page 1 always
    // comes back with rows. Zero rows means this isn't page 1 (v1 only reads page 1 —
    // e.g. a later page of the form). Fail loud instead of a misleading empty review.
    if (extracted.rows.length === 0) {
      const reason =
        'This doesn’t look like page 1 of the Nichido inventory form. Automatic reading currently supports page 1 only — upload page 1, or review this file manually. (Pages 2–6 are coming soon.)';
      await setUploadStatus(uploadId, 'failed', {rejectReason: reason});
      return json({uploadId, status: 'failed', error: reason}, 422);
    }
    // Same store-scope fence for the scanned form's store.
    const outPdf = outOfScopeStores(ctx.storeScope, [extracted.store_code]);
    if (outPdf.length) {
      const reason = `Scanned form is for store ${extracted.store_code}, outside your access.`;
      await setUploadStatus(uploadId, 'rejected', {rejectReason: reason});
      return json({uploadId, status: 'rejected', error: reason}, 403);
    }
    await saveExtraction({companyId, uploadId, page, extracted, docConfidence: avgConfidence(extracted)});
    await setUploadStatus(uploadId, 'needs_review', {pageCount: 1});
    return json({uploadId, status: 'needs_review', page, rows: extracted.rows.length, docConfidence: avgConfidence(extracted)});
  } catch (e) {
    // Log the raw error server-side; show the reviewer a human-readable reason.
    console.error('goldline upload: extraction failed', msg(e));
    const friendly = humanizeExtractError(e);
    await setUploadStatus(uploadId, 'failed', {rejectReason: friendly});
    return json({uploadId, status: 'failed', error: friendly}, 422);
  }
}
