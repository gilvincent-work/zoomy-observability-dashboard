import 'server-only';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {fetchAllRows} from './pos-fetch-paginate';
import type {InventoryRowIn} from './goldline-inventory';
import {addDays, formTimeliness, storeHealth, storeMovement, type Count, type StoreHealth} from './goldline-movement';

// Server-only reads behind the stock forecast, Action Feed and store Health. Company
// scoped on every query (service-role key bypasses RLS; company_id is the fence),
// optionally narrowed to a store-scoped role's stores.
//
// Reads the last ~70 days of counts (up to four semi-monthly counts per store) — the
// history the movement estimate needs — never the whole inventory history. At the
// full 300-store ramp this is a few hundred thousand rows per load; that's the point
// to move the rollup into a SQL function / materialized view.

const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
const HISTORY_DAYS = 70;

function db(): SupabaseClient {
  return createClient(url as string, key as string, {auth: {persistSession: false}});
}

export type StoreOps = {
  storeCode: string;
  storeName: string | null;
  movement: ReturnType<typeof storeMovement>;
  health: StoreHealth;
  committedAt: string | null; // latest count's last commit
  countedCurrent: boolean; // has a count for the company's current period
};

export type OpsData = {
  currentPeriod: {start: string; end: string} | null; // the company's latest form period
  stores: StoreOps[];
  catalog: Record<string, {name: string; productLine: string | null; price: number | null; bestseller: boolean}>;
  pendingReview: number;
};

export async function getOpsData(companyId: string, storeScope?: string[] | null): Promise<OpsData> {
  const empty: OpsData = {currentPeriod: null, stores: [], catalog: {}, pendingReview: 0};
  if (!url || !key) return empty;
  const supa = db();
  const scope = storeScope ? new Set(storeScope) : null;

  const [snapsAll, storesRows, products, pending] = await Promise.all([
    fetchAllRows('gl_inventory_snapshots', (from, to) =>
      supa
        .from('gl_inventory_snapshots')
        .select('store_code,period_start,period_end,last_committed_at')
        .eq('company_id', companyId)
        .order('period_end', {ascending: false})
        .order('store_code')
        .range(from, to),
    ) as unknown as Promise<Array<{store_code: string; period_start: string; period_end: string; last_committed_at: string | null}>>,
    fetchAllRows('gl_stores', (from, to) =>
      supa.from('gl_stores').select('store_code,name,status').eq('company_id', companyId).order('store_code').range(from, to),
    ) as unknown as Promise<Array<{store_code: string; name: string; status: string}>>,
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
    // pagination-ok: count-only head request, returns no rows.
    supa.from('gl_uploads').select('id', {count: 'exact', head: true}).eq('company_id', companyId).eq('status', 'needs_review'),
  ]);

  const snaps = scope ? snapsAll.filter((s) => scope.has(s.store_code)) : snapsAll;
  const catalog: OpsData['catalog'] = {};
  for (const p of products) {
    catalog[p.item_code] = {
      name: p.variant?.trim() || p.item_code,
      productLine: p.product_line,
      price: p.unit_price == null ? null : Number(p.unit_price),
      bestseller: Boolean(p.is_bestseller),
    };
  }
  const latest = snaps[0];
  if (!latest) return {...empty, catalog, pendingReview: pending.count ?? 0};
  const currentPeriod = {start: latest.period_start, end: latest.period_end};

  const rows = (await fetchAllRows('gl_inventory', (from, to) =>
    supa
      .from('gl_inventory')
      .select('store_code,item_code,period_start,period_end,stockroom,drawer,selling_area,delivery,ending_on_hand')
      .eq('company_id', companyId)
      .gte('period_end', addDays(currentPeriod.end, -HISTORY_DAYS))
      .order('id')
      .range(from, to),
  )) as unknown as Array<InventoryRowIn & {store_code: string; period_start: string; period_end: string}>;

  // store → period → rows
  const byStore = new Map<string, Map<string, Count>>();
  for (const r of rows) {
    if (scope && !scope.has(r.store_code)) continue;
    const k = `${r.period_start}|${r.period_end}`;
    const periods = byStore.get(r.store_code) ?? new Map<string, Count>();
    const c = periods.get(k) ?? {period_start: r.period_start, period_end: r.period_end, rows: []};
    c.rows.push(r);
    periods.set(k, c);
    byStore.set(r.store_code, periods);
  }

  const committedAt = new Map<string, string | null>();
  for (const s of snaps) if (s.period_end === currentPeriod.end && s.period_start === currentPeriod.start) committedAt.set(s.store_code, s.last_committed_at);
  const nameOf = new Map(storesRows.map((s) => [s.store_code, s.name]));
  const activeStores = storesRows.filter((s) => s.status === 'active' && (!scope || scope.has(s.store_code))).map((s) => s.store_code);
  const codes = [...new Set([...activeStores, ...byStore.keys()])].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

  const priceOf = (code: string) => catalog[code]?.price ?? null;
  const stores: StoreOps[] = codes.map((storeCode) => {
    const counts = [...(byStore.get(storeCode)?.values() ?? [])];
    const movement = storeMovement(counts);
    const countedCurrent =
      movement.latest?.period_end === currentPeriod.end && movement.latest?.period_start === currentPeriod.start;
    const form = countedCurrent ? formTimeliness(currentPeriod.end, committedAt.get(storeCode) ?? null) : 'missing';
    return {
      storeCode,
      storeName: nameOf.get(storeCode) ?? null,
      movement,
      health: storeHealth(movement, priceOf, form),
      committedAt: committedAt.get(storeCode) ?? null,
      countedCurrent,
    };
  });

  return {currentPeriod, stores, catalog, pendingReview: pending.count ?? 0};
}
