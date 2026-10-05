'use server';

import {revalidatePath} from 'next/cache';
import {getDataContext} from '@/src/active-context';
import {canEditData, outOfScopeStores} from '@/src/company';
import {commitInventory, getUpload, type ReviewedInventoryRow} from '@/src/goldline-data';

// Server action behind the review screen's "Commit" button. Re-derives the tenant
// context server-side (never trusts a company id from the client beyond the switcher
// hint), re-checks write capability + store scope, coerces the submitted rows, then
// writes gl_inventory and closes the upload. All the authorization that the upload
// route enforces is enforced again here — the two are independent entry points.

export type CommitResult = {ok: true; committed: number} | {ok: false; error: string};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000; // a Nichido cycle is ~500 SKUs/page; well under this.
const COUNT_MAX = 1_000_000; // a stock count beyond this is a transcription error, not data.
const COUNT_KEYS = ['stockroom', 'drawer', 'selling_area', 'delivery', 'ending_on_hand'] as const;

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30 etc.), not just the shape. */
function validIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function coerceRow(r: unknown): ReviewedInventoryRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const code = typeof o.item_code === 'string' ? o.item_code.trim() : '';
  if (!code) return null;
  return {
    item_code: code,
    stockroom: toIntOrNull(o.stockroom),
    drawer: toIntOrNull(o.drawer),
    selling_area: toIntOrNull(o.selling_area),
    delivery: toIntOrNull(o.delivery),
    ending_on_hand: toIntOrNull(o.ending_on_hand),
  };
}

export async function commitReview(input: {
  company: string | null;
  uploadId: string;
  storeCode: string;
  periodStart: string;
  periodEnd: string;
  consultant?: string | null;
  rows: unknown[];
}): Promise<CommitResult> {
  const ctx = await getDataContext(input.company);
  if (!ctx || !ctx.companyId) return {ok: false, error: 'Not authorized to commit for this company.'};
  if (!canEditData(ctx.role)) return {ok: false, error: 'Your role cannot commit reviews.'};

  // Ownership: the uploadId is client-supplied — confirm it belongs to THIS tenant
  // before any write, so a crafted id can't cross-link one company's inventory to
  // another's upload (the gl_inventory insert stamps our company_id but would
  // otherwise store a foreign source_upload_id, and the status updates would no-op).
  const upload = await getUpload(ctx.companyId, input.uploadId);
  if (!upload) return {ok: false, error: 'Upload not found.'};

  const store = (input.storeCode ?? '').trim();
  if (!store) return {ok: false, error: 'A store code is required before committing.'};
  if (!validIsoDate(input.periodStart) || !validIsoDate(input.periodEnd)) {
    return {ok: false, error: 'Period start and end must be valid dates (YYYY-MM-DD).'};
  }
  if (input.periodStart > input.periodEnd) {
    return {ok: false, error: 'Period start must not be after period end.'};
  }
  if (outOfScopeStores(ctx.storeScope, [store]).length) {
    return {ok: false, error: `Store ${store} is outside your access.`};
  }

  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .map(coerceRow)
    .filter((r): r is ReviewedInventoryRow => r !== null)
    .slice(0, MAX_ROWS);
  if (!rows.length) return {ok: false, error: 'No valid rows to commit.'};

  // Counts are non-negative and bounded — reject loudly rather than store garbage.
  for (const r of rows) {
    for (const k of COUNT_KEYS) {
      const v = r[k];
      if (v !== null && (v < 0 || v > COUNT_MAX)) {
        return {ok: false, error: `Row ${r.item_code}: ${k} (${v}) is out of range.`};
      }
    }
  }

  try {
    const committed = await commitInventory({
      companyId: ctx.companyId,
      uploadId: input.uploadId,
      storeCode: store,
      period: {start: input.periodStart, end: input.periodEnd},
      consultant: input.consultant ?? null,
      rows,
    });
    revalidatePath('/uploads');
    revalidatePath(`/uploads/${input.uploadId}`);
    return {ok: true, committed};
  } catch (e) {
    // Don't leak Postgres/schema detail to the browser; log it server-side.
    console.error('commitReview failed', e);
    return {ok: false, error: 'Could not commit the review — please try again.'};
  }
}
