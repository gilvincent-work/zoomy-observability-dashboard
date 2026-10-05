import 'server-only';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {fetchAllRows} from './pos-fetch-paginate';

// Read-only analytics for a Goldline-style tenant: store + SKU rollups derived
// from gl_sales, joined to gl_stores for names. Company-scoped on every read (the
// service-role key bypasses RLS, so the company_id filter is the tenant fence) and
// paginated via fetchAllRows so a large gl_sales is never silently capped. v1 does
// the aggregation in JS — fine at the ~150k-rows/cycle scale; an RPC/view is the
// later optimization (same path the pos_* reads will take).

const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;

function configured(): boolean {
  return Boolean(url && key);
}
function db(): SupabaseClient {
  return createClient(url as string, key as string, {auth: {persistSession: false}});
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type GlStore = {
  store_code: string;
  name: string;
  region: string | null;
  area: string | null;
  status: string;
};

export type StoreRollup = {
  store_code: string;
  name: string;
  region: string | null;
  units: number;
  gross: number;
  net: number;
  skuCount: number;
};

export type SkuRollup = {sku_code: string; units: number; gross: number; net: number};

export type SalesSummary = {
  gross: number;
  units: number;
  net: number;
  storeCount: number; // stores with at least one sale
  skuCount: number;
  periodStart: string | null;
  periodEnd: string | null;
};

export type GoldlineAnalytics = {
  stores: GlStore[];
  byStore: StoreRollup[]; // every store (incl. zero-sale), gross desc
  bySku: SkuRollup[]; // gross desc
  summary: SalesSummary;
};

const EMPTY: GoldlineAnalytics = {
  stores: [],
  byStore: [],
  bySku: [],
  summary: {gross: 0, units: 0, net: 0, storeCount: 0, skuCount: 0, periodStart: null, periodEnd: null},
};

type Agg = {units: number; gross: number; net: number; skus: Set<string>};
const mkAgg = (): Agg => ({units: 0, gross: 0, net: 0, skus: new Set()});

/** One company's store + SKU sales rollups and headline summary. */
export async function getGoldlineAnalytics(companyId: string): Promise<GoldlineAnalytics> {
  if (!configured()) return EMPTY;
  const supa = db();

  const storeRows = (await fetchAllRows('gl_stores', (from, to) =>
    supa
      .from('gl_stores')
      .select('store_code,name,region,area,status')
      .eq('company_id', companyId)
      .order('store_code', {ascending: true})
      .range(from, to),
  )) as unknown as GlStore[];

  const salesRows = (await fetchAllRows('gl_sales', (from, to) =>
    supa
      .from('gl_sales')
      .select('store_code,sku_code,gross_retail,units,net_of_vat,period_start,period_end')
      .eq('company_id', companyId)
      .order('id', {ascending: true})
      .range(from, to),
  )) as unknown as Array<Record<string, unknown>>;

  const perStore = new Map<string, Agg>();
  const perSku = new Map<string, Agg>();
  let gross = 0;
  let units = 0;
  let net = 0;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (const r of salesRows) {
    const store = String(r.store_code ?? '');
    const sku = String(r.sku_code ?? '');
    const g = num(r.gross_retail);
    const u = num(r.units);
    const n = num(r.net_of_vat);
    gross += g;
    units += u;
    net += n;
    const ps = r.period_start as string | null;
    const pe = r.period_end as string | null;
    if (ps && (!periodStart || ps < periodStart)) periodStart = ps;
    if (pe && (!periodEnd || pe > periodEnd)) periodEnd = pe;

    const sa = perStore.get(store) ?? mkAgg();
    sa.units += u;
    sa.gross += g;
    sa.net += n;
    if (sku) sa.skus.add(sku);
    perStore.set(store, sa);

    const ka = perSku.get(sku) ?? mkAgg();
    ka.units += u;
    ka.gross += g;
    ka.net += n;
    perSku.set(sku, ka);
  }

  const nameByStore = new Map(storeRows.map((s) => [s.store_code, s.name]));
  const regionByStore = new Map(storeRows.map((s) => [s.store_code, s.region]));

  // Every known store, plus any store that only appears in sales (defensive).
  const storeCodes = new Set<string>([...storeRows.map((s) => s.store_code), ...perStore.keys()]);
  const byStore: StoreRollup[] = [...storeCodes]
    .map((code) => {
      const a = perStore.get(code) ?? mkAgg();
      return {
        store_code: code,
        name: nameByStore.get(code) ?? code,
        region: regionByStore.get(code) ?? null,
        units: a.units,
        gross: a.gross,
        net: a.net,
        skuCount: a.skus.size,
      };
    })
    .sort((a, b) => b.gross - a.gross);

  const bySku: SkuRollup[] = [...perSku.entries()]
    .map(([sku_code, a]) => ({sku_code, units: a.units, gross: a.gross, net: a.net}))
    .sort((a, b) => b.gross - a.gross);

  return {
    stores: storeRows,
    byStore,
    bySku,
    summary: {
      gross,
      units,
      net,
      storeCount: [...perStore.values()].filter((a) => a.units > 0 || a.gross > 0).length,
      skuCount: perSku.size,
      periodStart,
      periodEnd,
    },
  };
}
