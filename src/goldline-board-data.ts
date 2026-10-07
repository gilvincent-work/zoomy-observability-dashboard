import 'server-only';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {fetchAllRows} from './pos-fetch-paginate';
import type {InventoryRowIn} from './goldline-inventory';
import {addDays, storeMovement, type Count} from './goldline-movement';
import {countedSoldByMonth, type ItemCount} from './goldline-product';
import type {CatalogItem, Shipment, StoreBlock, SupplyConfig} from './goldline-supply';

// Server-only reads behind the combined Goldline Inventory board: every store's recent
// counts (enough for this month, last month, the month before, and the movement
// estimate), the catalog, linked sales, and the supply side (warehouse, lead times,
// shipments). Company-scoped on every query (the service-role key bypasses RLS) and
// narrowed to a store-scoped role's stores.
//
// Reads ~4 months of counts for the caller's stores. At the 300-store ramp that's the
// point to move this rollup into a SQL function / materialized view.

const url = process.env.SUPABASE_URL_ARCHIVE;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY_ARCHIVE;
const HISTORY_DAYS = 130;

function db(): SupabaseClient {
  return createClient(url as string, key as string, {auth: {persistSession: false}});
}

export type BoardData = {
  stores: StoreBlock[];
  storeList: Array<{code: string; name: string | null}>;
  catalog: Record<string, CatalogItem>;
  productLines: string[];
  warehouse: Record<string, number>;
  config: SupplyConfig;
  shipments: Shipment[];
  currentMonth: string;
  today: string;
};

type Row = ItemCount & {store_code: string};

export async function getBoardData(companyId: string, storeScope?: string[] | null, now = new Date()): Promise<BoardData> {
  const today = now.toISOString().slice(0, 10);
  const empty: BoardData = {
    stores: [],
    storeList: [],
    catalog: {},
    productLines: [],
    warehouse: {},
    config: {defaultProductionDays: 30, defaultTransitDays: 3, lineProductionDays: {}, storeTransitDays: {}, isSample: true},
    shipments: [],
    currentMonth: today.slice(0, 7),
    today,
  };
  if (!url || !key) return empty;
  const supa = db();
  const since = addDays(today, -HISTORY_DAYS);
  const scope = storeScope ? new Set(storeScope) : null;

  const [storesRows, products, counts, wh, settings, lines, transit, shipments] = await Promise.all([
    fetchAllRows('gl_stores', (from, to) =>
      supa.from('gl_stores').select('store_code,name,status').eq('company_id', companyId).order('store_code').range(from, to),
    ) as unknown as Promise<Array<{store_code: string; name: string; status: string}>>,
    fetchAllRows('gl_products', (from, to) =>
      supa
        .from('gl_products')
        .select('item_code,sku_code,product_line,variant,unit_price,is_bestseller,hidden')
        .eq('company_id', companyId)
        .order('item_code')
        .range(from, to),
    ) as unknown as Promise<
      Array<{item_code: string; sku_code: string | null; product_line: string | null; variant: string | null; unit_price: string | number | null; is_bestseller: boolean | null; hidden: boolean | null}>
    >,
    fetchAllRows('gl_inventory', (from, to) => {
      let q = supa
        .from('gl_inventory') // pagination-ok: paged by fetchAllRows (.range below)
        .select('store_code,item_code,period_start,period_end,stockroom,drawer,selling_area,delivery,ending_on_hand')
        .eq('company_id', companyId)
        .gte('period_end', since);
      if (storeScope) q = q.in('store_code', storeScope);
      return q.order('id').range(from, to);
    }) as unknown as Promise<Row[]>,
    fetchAllRows('gl_warehouse_stock', (from, to) =>
      supa.from('gl_warehouse_stock').select('item_code,on_hand,is_sample').eq('company_id', companyId).order('item_code').range(from, to),
    ) as unknown as Promise<Array<{item_code: string; on_hand: number; is_sample: boolean}>>,
    // pagination-ok: one row by primary key (company_id).
    supa.from('gl_supply_settings').select('default_production_days,default_transit_days,is_sample').eq('company_id', companyId).maybeSingle(),
    fetchAllRows('gl_line_lead_times', (from, to) =>
      supa.from('gl_line_lead_times').select('product_line,production_days,is_sample').eq('company_id', companyId).order('product_line').range(from, to),
    ) as unknown as Promise<Array<{product_line: string; production_days: number; is_sample: boolean}>>,
    fetchAllRows('gl_store_transit', (from, to) =>
      supa.from('gl_store_transit').select('store_code,transit_days,is_sample').eq('company_id', companyId).order('store_code').range(from, to),
    ) as unknown as Promise<Array<{store_code: string; transit_days: number; is_sample: boolean}>>,
    fetchAllRows('gl_shipments', (from, to) => {
      let q = supa
        .from('gl_shipments') // pagination-ok: paged by fetchAllRows (.range below)
        .select('id,store_code,item_code,qty,shipped_on,arrives_on')
        .eq('company_id', companyId)
        .eq('status', 'in_transit')
        .gte('arrives_on', since);
      if (storeScope) q = q.in('store_code', storeScope);
      return q.order('arrives_on').order('id').range(from, to);
    }) as unknown as Promise<Array<{id: string; store_code: string; item_code: string; qty: number; shipped_on: string; arrives_on: string}>>,
  ]);
  if (settings.error) throw new Error(`gl_supply_settings read failed: ${settings.error.message}`);

  // Linked sales (POS SKU → item) for the same window — fills those months like the product page.
  const itemBySku = new Map(products.filter((p) => p.sku_code?.trim()).map((p) => [p.sku_code!.trim(), p.item_code]));
  const sales = itemBySku.size
    ? ((await fetchAllRows('gl_sales', (from, to) => {
        let q = supa
          .from('gl_sales') // pagination-ok: paged by fetchAllRows (.range below)
          .select('store_code,sku_code,period_end,units')
          .eq('company_id', companyId)
          .in('sku_code', [...itemBySku.keys()])
          .gte('period_end', since);
        if (storeScope) q = q.in('store_code', storeScope);
        return q.order('id').range(from, to);
      })) as unknown as Array<{store_code: string; sku_code: string; period_end: string; units: number}>)
    : [];

  const catalog: Record<string, CatalogItem> = {};
  for (const p of products) {
    catalog[p.item_code] = {
      name: p.variant?.trim() || p.item_code,
      productLine: p.product_line,
      price: p.unit_price == null ? null : Number(p.unit_price),
      bestseller: Boolean(p.is_bestseller),
      hidden: Boolean(p.hidden),
    };
  }

  // store → rows
  const byStore = new Map<string, Row[]>();
  for (const r of counts) {
    if (scope && !scope.has(r.store_code)) continue;
    byStore.set(r.store_code, [...(byStore.get(r.store_code) ?? []), r]);
  }
  const salesBy = new Map<string, Map<string, number>>(); // store|item → month → units
  for (const s of sales) {
    if (scope && !scope.has(s.store_code)) continue;
    const item = itemBySku.get(s.sku_code);
    if (!item) continue;
    const k = `${s.store_code}|${item}`;
    const m = salesBy.get(k) ?? new Map<string, number>();
    const month = s.period_end.slice(0, 7);
    m.set(month, (m.get(month) ?? 0) + (Number(s.units) || 0));
    salesBy.set(k, m);
  }

  const nameOf = new Map(storesRows.map((s) => [s.store_code, s.name]));
  const stores: StoreBlock[] = [...byStore.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
    .map(([storeCode, rows]) => {
      const periods = new Map<string, Count>();
      const byItem = new Map<string, ItemCount[]>();
      for (const r of rows) {
        const k = `${r.period_start}|${r.period_end}`;
        const c = periods.get(k) ?? {period_start: r.period_start, period_end: r.period_end, rows: []};
        c.rows.push(r as InventoryRowIn);
        periods.set(k, c);
        byItem.set(r.item_code, [...(byItem.get(r.item_code) ?? []), r]);
      }
      const mv = storeMovement([...periods.values()]);
      const latestRows = new Map((mv.latest?.rows ?? []).map((r) => [r.item_code, r]));
      return {
        storeCode,
        storeName: nameOf.get(storeCode) ?? null,
        latestEnd: mv.latest?.period_end ?? null,
        cycleDays: mv.cycleDays,
        items: mv.items.map((m) => {
          const monthly = countedSoldByMonth(byItem.get(m.item_code) ?? []);
          for (const [month, units] of salesBy.get(`${storeCode}|${m.item_code}`) ?? []) monthly.set(month, units);
          return {itemCode: m.item_code, movement: m, row: latestRows.get(m.item_code) ?? null, monthly};
        }),
      };
    });

  const latest = stores.map((s) => s.latestEnd).filter((d): d is string => !!d).sort().pop();
  const sample =
    Boolean(settings.data?.is_sample) || lines.some((l) => l.is_sample) || transit.some((t) => t.is_sample) || wh.some((w) => w.is_sample);
  const activeCodes = storesRows.filter((s) => s.status !== 'closed' && (!scope || scope.has(s.store_code))).map((s) => s.store_code);
  const listCodes = [...new Set([...activeCodes, ...byStore.keys()])].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

  return {
    stores,
    storeList: listCodes.map((code) => ({code, name: nameOf.get(code) ?? null})),
    catalog,
    productLines: [...new Set(products.map((p) => p.product_line).filter((l): l is string => !!l))].sort(),
    warehouse: Object.fromEntries(wh.map((w) => [w.item_code, w.on_hand])),
    config: {
      defaultProductionDays: settings.data?.default_production_days ?? 30,
      defaultTransitDays: settings.data?.default_transit_days ?? 3,
      lineProductionDays: Object.fromEntries(lines.map((l) => [l.product_line, l.production_days])),
      storeTransitDays: Object.fromEntries(transit.map((t) => [t.store_code, t.transit_days])),
      isSample: sample,
    },
    shipments: shipments.map((s) => ({id: s.id, storeCode: s.store_code, itemCode: s.item_code, qty: s.qty, shippedOn: s.shipped_on, arrivesOn: s.arrives_on})),
    currentMonth: (latest ?? today).slice(0, 7),
    today,
  };
}
