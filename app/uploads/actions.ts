'use server';

import {revalidatePath} from 'next/cache';
import {getDataContext} from '@/src/active-context';
import {canEditData, outOfScopeStores} from '@/src/company';
import {commitInventory, type ReviewedInventoryRow} from '@/src/goldline-data';

// Server action behind the review screen's "Commit" button. Re-derives the tenant
// context server-side (never trusts a company id from the client beyond the switcher
// hint), re-checks write capability + store scope, coerces the submitted rows, then
// writes gl_inventory and closes the upload. All the authorization that the upload
// route enforces is enforced again here — the two are independent entry points.

export type CommitResult = {ok: true; committed: number} | {ok: false; error: string};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000; // a Nichido cycle is ~500 SKUs/page; well under this.

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

  const store = (input.storeCode ?? '').trim();
  if (!store) return {ok: false, error: 'A store code is required before committing.'};
  if (!ISO.test(input.periodStart) || !ISO.test(input.periodEnd)) {
    return {ok: false, error: 'Period start and end must be dates (YYYY-MM-DD).'};
  }
  if (outOfScopeStores(ctx.storeScope, [store]).length) {
    return {ok: false, error: `Store ${store} is outside your access.`};
  }

  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .map(coerceRow)
    .filter((r): r is ReviewedInventoryRow => r !== null)
    .slice(0, MAX_ROWS);
  if (!rows.length) return {ok: false, error: 'No valid rows to commit.'};

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
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}
