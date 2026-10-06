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
import {detectPage, extractInventoryPage, extractionConfigured, type ExtractedPage} from '@/src/goldline-extract-run';
import {humanizeExtractError, INVENTORY_PAGES, MANIFESTS} from '@/src/goldline-extract';

// Goldline upload endpoint. Accepts ONE file (multipart/form-data, field `file`)
// scoped to the active company (?company=<slug>):
//   • .csv  → parse → idempotent upsert into gl_sales (needs period_start/_end)
//   • .pdf  → store → Claude Vision detects the page → extracts that page's items →
//             staged in gl_extractions for review (page 6 / non-form → out of scope)
// Tenant isolation is enforced here (getDataContext + canEditData); the data-blind
// Coop Admin and read-only analysts are refused. File-type gating is the first check.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// PDF path runs two sequential Vision calls (detect 20s + extract 85s = 105s); 160s
// gives headroom so a slow call throws in-code (catch → failed) rather than a hard kill.
export const maxDuration = 160;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

// Progress events for the Uploads screen. Only REAL milestones are sent (stored,
// page found, reading, saving) — the client draws its bar from these, never from a
// fake timer alone. Opt-in: a request with `Accept: application/x-ndjson` gets one
// JSON object per line and a final {type:'result'}; any other caller gets the
// unchanged single JSON response.
export type UploadStage =
  | {type: 'stage'; stage: 'stored'}
  | {type: 'stage'; stage: 'parsing'}
  | {type: 'stage'; stage: 'detecting'}
  | {type: 'stage'; stage: 'reading'; page: number; items: number}
  | {type: 'stage'; stage: 'saving'};
type Emit = (e: UploadStage) => void;
type Outcome = {body: Record<string, unknown>; status: number};

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
  const wantsStream = (req.headers.get('accept') ?? '').includes('application/x-ndjson');
  if (!wantsStream) {
    const out = await handle(req, () => {});
    return json(out.body, out.status);
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
      try {
        const out = await handle(req, send);
        send({type: 'result', httpStatus: out.status, ...out.body});
      } catch (e) {
        console.error('goldline upload: stream failed', msg(e));
        send({type: 'result', httpStatus: 500, error: 'Upload failed — please try again.'});
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no'},
  });
}

async function handle(req: Request, emit: Emit): Promise<Outcome> {
  const json = (body: Record<string, unknown>, status = 200): Outcome => ({body, status});
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
  emit({type: 'stage', stage: 'stored'});

  // --- POS sales CSV -------------------------------------------------------
  if (cls.kind === 'pos_csv') {
    const start = isoDate(form.get('period_start'));
    const end = isoDate(form.get('period_end'));
    if (!start || !end) {
      await setUploadStatus(uploadId, 'failed', {rejectReason: 'Missing period_start / period_end (YYYY-MM-DD).'});
      return json({uploadId, status: 'failed', error: 'A POS upload needs period_start and period_end (YYYY-MM-DD).'}, 422);
    }
    emit({type: 'stage', stage: 'parsing'});
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
      emit({type: 'stage', stage: 'saving'});
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
  try {
    // Auto-detect which page this scan is (from the footer), then extract with that
    // page's manifest. Page 6 is the daily Sales Report (not inventory); 0 = not a
    // recognizable form page. Both are a clean, out-of-scope stop, not a failure.
    emit({type: 'stage', stage: 'detecting'});
    const page = await detectPage(pdfBase64);
    if (page === 0) {
      const reason = 'This doesn’t look like a Nichido inventory form page. Please upload a clear scan of an inventory page (1–5).';
      await setUploadStatus(uploadId, 'failed', {rejectReason: reason});
      return json({uploadId, status: 'failed', error: reason}, 422);
    }
    if (!INVENTORY_PAGES.includes(page)) {
      const reason = 'This is page 6, the daily Sales Report — not an inventory page. Only inventory pages (1–5) are read here.';
      await setUploadStatus(uploadId, 'rejected', {rejectReason: reason, pageCount: page});
      return json({uploadId, status: 'rejected', error: reason}, 422);
    }

    emit({type: 'stage', stage: 'reading', page, items: MANIFESTS[page]?.length ?? 0});
    const extracted = await extractInventoryPage(pdfBase64, page);
    // Same store-scope fence for the scanned form's store.
    const outPdf = outOfScopeStores(ctx.storeScope, [extracted.store_code]);
    if (outPdf.length) {
      const reason = `Scanned form is for store ${extracted.store_code}, outside your access.`;
      await setUploadStatus(uploadId, 'rejected', {rejectReason: reason});
      return json({uploadId, status: 'rejected', error: reason}, 403);
    }
    emit({type: 'stage', stage: 'saving'});
    await saveExtraction({companyId, uploadId, page, extracted, docConfidence: avgConfidence(extracted)});
    await setUploadStatus(uploadId, 'needs_review', {pageCount: page});
    return json({uploadId, status: 'needs_review', page, rows: extracted.rows.length, docConfidence: avgConfidence(extracted)});
  } catch (e) {
    // Log the raw error server-side; show the reviewer a human-readable reason; keep a
    // scrubbed copy in error_detail for diagnosis (never shown prominently in the UI).
    console.error('goldline upload: extraction failed', msg(e));
    const friendly = humanizeExtractError(e);
    await setUploadStatus(uploadId, 'failed', {rejectReason: friendly, errorDetail: msg(e)});
    return json({uploadId, status: 'failed', error: friendly}, 422);
  }
}
