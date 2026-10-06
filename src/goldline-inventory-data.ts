import 'server-only';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {fetchAllRows} from './pos-fetch-paginate';
import {MANIFESTS} from './goldline-extract';
import {
  buildInventory,
  pageCoverage,
  pickSnapshot,
  type CatalogEntry,
  type InventoryRowIn,
  type InventorySummary,
  type ManifestEntry,
  type Snapshot,
} from './goldline-inventory';

// Server-only reads for the Goldline Inventory page. Every query is filtered by the
// active company_id — the service-role key bypasses RLS, so that filter is the
// tenant fence. The page shows ONE store × form period at a time (≤ ~260 rows), so
// nothing here scans the whole inventory history; the pickers come from the
// gl_inventory_snapshots view.

const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

function db(): SupabaseClient {
  return createClient(url as string, key as string, {auth: {persistSession: false}});
}

/** item_code → its printed page, position and shade, across the inventory pages. */
function manifestIndex(): Map<string, ManifestEntry> {
  const m = new Map<string, ManifestEntry>();
  for (const [page, items] of Object.entries(MANIFESTS)) {
    items.forEach((it, index) => {
      if (!m.has(it.code)) m.set(it.code, {page: Number(page), index, shade: it.product});
    });
  }
  return m;
}

export type InventorySource = {
  uploadId: string;
  filename: string;
  page: number | null;
  uploadedBy: string | null;
  createdAt: string;
};

export type InventoryPageData = {
  snapshots: Snapshot[];
  selected: Snapshot | null;
  storeNames: Record<string, string>;
  summary: InventorySummary | null;
  sources: InventorySource[];
  coverage: {have: number[]; missing: number[]};
  pendingReview: number;
};

const EMPTY: InventoryPageData = {
  snapshots: [],
  selected: null,
  storeNames: {},
  summary: null,
  sources: [],
  coverage: {have: [], missing: [1, 2, 3, 4, 5]},
  pendingReview: 0,
};

/** `storeScope` (a store-scoped role) limits which stores' snapshots are visible;
 *  null/undefined = every store in the company. */
export async function getInventoryPage(
  companyId: string,
  store?: string | null,
  period?: string | null,
  storeScope?: string[] | null,
): Promise<InventoryPageData> {
  if (!url || !key) return EMPTY;
  const supa = db();

  const [allSnapshots, stores, pending] = await Promise.all([
    fetchAllRows('gl_inventory_snapshots', (from, to) =>
      supa
        .from('gl_inventory_snapshots')
        .select('store_code,period_start,period_end,items,uploads,consultant,last_committed_at')
        .eq('company_id', companyId)
        .order('period_end', {ascending: false})
        .order('store_code', {ascending: true})
        .range(from, to),
    ) as unknown as Promise<Snapshot[]>,
    fetchAllRows('gl_stores', (from, to) =>
      supa.from('gl_stores').select('store_code,name').eq('company_id', companyId).order('store_code').range(from, to),
    ) as unknown as Promise<Array<{store_code: string; name: string}>>,
    // pagination-ok: count-only head request, returns no rows.
    supa.from('gl_uploads').select('id', {count: 'exact', head: true}).eq('company_id', companyId).eq('status', 'needs_review'),
  ]);

  const scope = storeScope ? new Set(storeScope) : null;
  const snapshots = scope ? allSnapshots.filter((s) => scope.has(s.store_code)) : allSnapshots;
  const storeNames = Object.fromEntries(stores.map((s) => [s.store_code, s.name]));
  const pendingReview = pending.count ?? 0;
  const selected = pickSnapshot(snapshots, store, period);
  if (!selected) return {...EMPTY, snapshots, storeNames, pendingReview};

  const [rows, products] = await Promise.all([
    fetchAllRows('gl_inventory', (from, to) =>
      supa
        .from('gl_inventory')
        .select('item_code,stockroom,drawer,selling_area,delivery,ending_on_hand,source_upload_id')
        .eq('company_id', companyId)
        .eq('store_code', selected.store_code)
        .eq('period_start', selected.period_start)
        .eq('period_end', selected.period_end)
        .order('id', {ascending: true})
        .range(from, to),
    ) as unknown as Promise<Array<InventoryRowIn & {source_upload_id: string | null}>>,
    fetchAllRows('gl_products', (from, to) =>
      supa
        .from('gl_products')
        .select('item_code,product_line,variant,unit_price,is_bestseller')
        .eq('company_id', companyId)
        .order('item_code')
        .range(from, to),
    ) as unknown as Promise<
      Array<{item_code: string; product_line: string | null; variant: string | null; unit_price: string | number | null; is_bestseller: boolean | null}>
    >,
  ]);

  const catalog = new Map<string, CatalogEntry>(
    products.map((p) => [
      p.item_code,
      {
        productLine: p.product_line,
        variant: p.variant,
        unitPrice: p.unit_price == null ? null : Number(p.unit_price),
        bestseller: Boolean(p.is_bestseller),
      },
    ]),
  );
  const summary = buildInventory(rows, catalog, manifestIndex());

  // The scans this snapshot was committed from, each with the form page it read.
  const ids = [...new Set(rows.map((r) => r.source_upload_id).filter((x): x is string => Boolean(x)))];
  let sources: InventorySource[] = [];
  if (ids.length) {
    const [ups, exts] = await Promise.all([
      // pagination-ok: bounded by the distinct source scans of one store/period.
      supa.from('gl_uploads').select('id,filename,uploaded_by,created_at').eq('company_id', companyId).in('id', ids),
      // pagination-ok: one extraction per scan, same bound.
      supa.from('gl_extractions').select('upload_id,page').eq('company_id', companyId).in('upload_id', ids),
    ]);
    const pageOf = new Map(((exts.data ?? []) as Array<{upload_id: string; page: number}>).map((e) => [e.upload_id, e.page]));
    sources = ((ups.data ?? []) as Array<{id: string; filename: string; uploaded_by: string | null; created_at: string}>)
      .map((u) => ({uploadId: u.id, filename: u.filename, page: pageOf.get(u.id) ?? null, uploadedBy: u.uploaded_by, createdAt: u.created_at}))
      .sort((a, b) => (a.page ?? 99) - (b.page ?? 99) || a.createdAt.localeCompare(b.createdAt));
  }

  return {
    snapshots,
    selected,
    storeNames,
    summary,
    sources,
    coverage: pageCoverage(sources.map((s) => s.page)),
    pendingReview,
  };
}

/** Where a committed scan landed (store + period), for the review page's
 *  "View in Inventory" link. Null when the upload hasn't been committed. */
export async function committedSnapshotFor(
  companyId: string,
  uploadId: string,
): Promise<{store_code: string; period_start: string; period_end: string} | null> {
  if (!url || !key) return null;
  // pagination-ok: single row.
  const res = await db()
    .from('gl_inventory')
    .select('store_code,period_start,period_end')
    .eq('company_id', companyId)
    .eq('source_upload_id', uploadId)
    .limit(1)
    .maybeSingle();
  return (res.data as {store_code: string; period_start: string; period_end: string} | null) ?? null;
}
