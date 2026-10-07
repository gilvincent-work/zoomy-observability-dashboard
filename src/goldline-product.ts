// Goldline product page: one item's sales and stock, month by month (pure, unit-tested).
//
// Input is the item's committed counts per store (the semi-monthly form) and — once the
// item's POS SKU is linked in gl_products — its sales-report units. Output feeds the
// shared StockSalesChart (3 real + 3 forecast months) plus the page's numbers.
//
// Rules (also stated on the page):
// • Sold per month: from the sales report when the item is linked AND that store has
//   sales rows for it; otherwise estimated from consecutive counts:
//       last on hand + this count's delivery − this on hand
//   attributed to the month the later count ends in. A negative figure (count rose with
//   no delivery) is skipped, never counted as zero sales.
// • Stock at month end = on hand at the last count ending in that month, carried
//   forward from an earlier count when a month had none.
// • Status, cover, stock-out date and suggested order come from storeMovement — the
//   same engine as the Stock forecast and Action Feed, so all pages agree.
// • Forecast months: the item's recent pace (storeMovement velocity → per day → per
//   month), shaped by the same months last year once a year of history exists.
// • All stores: each month adds up every store's figures; stock is the sum of each
//   store's carried-forward on hand; the suggested order is each store's own order
//   added up (an overstocked store can't hide one that's out).

import {onHandOf, type InventoryRowIn} from './goldline-inventory';
import {storeMovement, type ItemMovement} from './goldline-movement';
import type {ChartMonth} from './pos-product-detail';

export type ItemCount = InventoryRowIn & {period_start: string; period_end: string};
export type SalesRow = {period_start: string; period_end: string; units: number};
export type SoldSource = 'sales' | 'counts';

export type StoreInput = {
  storeCode: string;
  storeName: string | null;
  counts: ItemCount[]; // this item, this store (any order)
  sales: SalesRow[] | null; // null = item not linked to a POS SKU
};

export type CountLine = {
  label: string; // 'Oct A'
  periodEnd: string;
  stockroom: number | null;
  drawer: number | null;
  sellingArea: number | null;
  delivery: number | null;
  onHand: number | null;
};

export type StoreProduct = {
  storeCode: string;
  storeName: string | null;
  source: SoldSource;
  movement: ItemMovement | null; // null when the store's counts don't include the item
  cycleDays: number | null;
  latestEnd: string | null; // latest count's period end
  soldByMonth: Map<string, number>; // YYYY-MM → units (from `source`)
  cyclesInMonth: Map<string, number>; // counts-based: cycles that ended in the month
  stockByMonth: Map<string, number>; // on hand at the month's last count (not carried)
  deliveryByMonth: Map<string, {qty: number; latest: string}>;
  countLines: CountLine[]; // newest first
  registerCheck: boolean | null; // last 3 months: counts matched the register? null = can't tell
};

export type ProductPage = {
  chart: ChartMonth[];
  currentMonth: string | null; // the latest real month (YYYY-MM)
  hasLastYear: boolean;
  runsOutMonthLabel: string | null; // first forecast month the projection hits 0
  lastCountedWeeksAgo: number | null;
  soldTable: Array<{month: string; label: string; sold: number | null; partial: boolean}>; // newest first
};

const DAY = 86_400_000;
const monthOf = (iso: string) => iso.slice(0, 7);
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const daysInMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthShort = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});
const monthLong = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', {month: 'short', year: 'numeric', timeZone: 'UTC'});
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});

/** 'Oct A' (first half of the month) / 'Oct B' (second half), from the period end. */
export function countLabel(periodEnd: string): string {
  const day = Number(periodEnd.slice(8, 10));
  return `${monthShort(monthOf(periodEnd))} ${day <= 16 ? 'A' : 'B'}`;
}

/** Counted sold vs register sold agree: within ±2 units or 10%. */
export const registerMatches = (counted: number, register: number) => Math.abs(counted - register) <= Math.max(2, Math.round(register * 0.1));

export function buildStoreProduct(input: StoreInput, itemCode: string): StoreProduct {
  const counts = [...input.counts].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const mv = counts.length
    ? storeMovement(counts.map((c) => ({period_start: c.period_start, period_end: c.period_end, rows: [{...c, item_code: itemCode}]})))
    : null;
  const movement = mv?.items.find((i) => i.item_code === itemCode) ?? null;

  // Counts-based sold per month.
  const countedSold = new Map<string, number>();
  const cyclesInMonth = new Map<string, number>();
  let prev: number | null = null;
  for (const c of counts) {
    const oh = onHandOf(c).onHand;
    if (oh == null) continue;
    if (prev != null) {
      const sold = prev + (c.delivery ?? 0) - oh;
      if (sold >= 0) {
        const m = monthOf(c.period_end);
        countedSold.set(m, (countedSold.get(m) ?? 0) + sold);
        cyclesInMonth.set(m, (cyclesInMonth.get(m) ?? 0) + 1);
      }
    }
    prev = oh;
  }

  const salesSold = new Map<string, number>();
  for (const s of input.sales ?? []) {
    const m = monthOf(s.period_end);
    salesSold.set(m, (salesSold.get(m) ?? 0) + (Number(s.units) || 0));
  }
  const source: SoldSource = input.sales && input.sales.length ? 'sales' : 'counts';

  const stockByMonth = new Map<string, number>();
  const deliveryByMonth = new Map<string, {qty: number; latest: string}>();
  for (const c of counts) {
    const m = monthOf(c.period_end);
    const oh = onHandOf(c).onHand;
    if (oh != null) stockByMonth.set(m, oh); // sorted → the month's last count wins
    if ((c.delivery ?? 0) > 0) {
      const d = deliveryByMonth.get(m) ?? {qty: 0, latest: c.period_end};
      d.qty += c.delivery as number;
      if (c.period_end > d.latest) d.latest = c.period_end;
      deliveryByMonth.set(m, d);
    }
  }

  // Register check: compare the last 3 months both sources cover.
  let registerCheck: boolean | null = null;
  if (source === 'sales' && counts.length) {
    const cur = monthOf(counts[counts.length - 1].period_end);
    const months = [addMonths(cur, -2), addMonths(cur, -1), cur].filter((m) => countedSold.has(m) && salesSold.has(m));
    if (months.length) registerCheck = months.every((m) => registerMatches(countedSold.get(m)!, salesSold.get(m)!));
  }

  return {
    storeCode: input.storeCode,
    storeName: input.storeName,
    source,
    movement,
    cycleDays: mv?.cycleDays ?? null,
    latestEnd: counts.length ? counts[counts.length - 1].period_end : null,
    soldByMonth: source === 'sales' ? salesSold : countedSold,
    cyclesInMonth,
    stockByMonth,
    deliveryByMonth,
    countLines: [...counts].reverse().map((c) => ({
      label: countLabel(c.period_end),
      periodEnd: c.period_end,
      stockroom: c.stockroom,
      drawer: c.drawer,
      sellingArea: c.selling_area,
      delivery: c.delivery,
      onHand: onHandOf(c).onHand,
    })),
    registerCheck,
  };
}

/** On hand at the end of `month`: the last count up to then (carried forward). */
function stockAt(s: StoreProduct, month: string): number | null {
  let best: string | null = null;
  for (const m of s.stockByMonth.keys()) if (m <= month && (best == null || m > best)) best = m;
  return best == null ? null : (s.stockByMonth.get(best) as number);
}

/** This store's forecast for each future month (null = no pace yet). */
function storeForecast(s: StoreProduct, future: string[]): Array<number | null> {
  const v = s.movement?.velocity;
  if (v == null || !s.cycleDays) return future.map(() => null);
  const perDay = v / s.cycleDays;
  const ly = future.map((m) => s.soldByMonth.get(addMonths(m, -12)) ?? 0);
  const pos = ly.filter((x) => x > 0);
  const lyAvg = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
  return future.map((m, i) => {
    const pace = perDay * daysInMonth(m);
    return Math.max(0, Math.round(lyAvg > 0 ? pace * (ly[i] / lyAvg) : pace));
  });
}

const sumOrNull = (xs: Array<number | null>) => (xs.some((x) => x != null) ? xs.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

/** The 6-month chart and page numbers for one store, or several added up. */
export function buildProductPage(stores: StoreProduct[], now: Date = new Date()): ProductPage {
  const latestEnd = stores.map((s) => s.latestEnd).filter((x): x is string => !!x).sort().pop() ?? null;
  if (!latestEnd) return {chart: [], currentMonth: null, hasLastYear: false, runsOutMonthLabel: null, lastCountedWeeksAgo: null, soldTable: []};
  const cur = monthOf(latestEnd);
  const real = [addMonths(cur, -2), addMonths(cur, -1), cur];
  const future = [1, 2, 3].map((k) => addMonths(cur, k));

  const soldIn = (m: string) => sumOrNull(stores.map((s) => (s.soldByMonth.has(m) ? (s.soldByMonth.get(m) as number) : null)));
  const lyIn = (m: string) => {
    const v = soldIn(addMonths(m, -12));
    return v != null && v > 0 ? v : null;
  };
  const deliveryIn = (m: string) => {
    const ds = stores.map((s) => s.deliveryByMonth.get(m)).filter((d): d is {qty: number; latest: string} => !!d);
    if (!ds.length) return null;
    return {qty: ds.reduce((a, d) => a + d.qty, 0), dateLabel: dayLabel(ds.map((d) => d.latest).sort().pop() as string)};
  };

  const chart: ChartMonth[] = real.map((m, i) => ({
    key: m,
    label: monthShort(m).toUpperCase(),
    isForecast: false,
    isCurrent: i === real.length - 1,
    sold: soldIn(m),
    soldForecast: null,
    soldLastYear: lyIn(m),
    stockEnd: sumOrNull(stores.map((s) => stockAt(s, m))),
    stockForecast: null,
    delivery: deliveryIn(m),
    runsOut: false,
  }));
  const lastReal = chart[chart.length - 1];
  lastReal.stockForecast = lastReal.stockEnd; // seeds the dotted line

  // Per-store projections from each store's current on hand, then added up.
  const perStore = stores.map((s) => {
    const fc = storeForecast(s, future);
    let stock = s.movement?.onHand ?? stockAt(s, cur);
    const proj = fc.map((f) => {
      if (stock == null || f == null) return stock;
      stock = Math.max(0, stock - f);
      return stock;
    });
    return {fc, proj};
  });
  let runsOutMonthLabel: string | null = null;
  let before = lastReal.stockEnd;
  future.forEach((m, k) => {
    const soldForecast = sumOrNull(perStore.map((p) => p.fc[k]));
    const stockForecast = soldForecast == null ? null : sumOrNull(perStore.map((p) => p.proj[k]));
    const runsOut = !runsOutMonthLabel && before != null && before > 0 && stockForecast === 0;
    if (runsOut) runsOutMonthLabel = monthShort(m);
    if (stockForecast != null) before = stockForecast;
    chart.push({
      key: m,
      label: monthShort(m).toUpperCase(),
      isForecast: true,
      isCurrent: false,
      sold: null,
      soldForecast,
      soldLastYear: lyIn(m),
      stockEnd: null,
      stockForecast,
      delivery: null,
      runsOut,
    });
  });

  // The latest month is still open when its last count is the first-half (A) count.
  const partial = (m: string) => m === cur && Number(latestEnd.slice(8, 10)) <= 16;

  return {
    chart,
    currentMonth: cur,
    hasLastYear: chart.some((c) => (c.soldLastYear ?? 0) > 0),
    runsOutMonthLabel,
    lastCountedWeeksAgo: Math.max(0, Math.floor((now.getTime() - Date.parse(`${latestEnd}T00:00:00Z`)) / (7 * DAY))),
    soldTable: [...real].reverse().map((m) => ({month: m, label: monthLong(m), sold: soldIn(m), partial: partial(m)})),
  };
}

export type ProductTotals = {
  onHand: number | null;
  storesCounted: number; // stores with an on-hand figure
  needing: number; // stores out or to reorder
  out: number;
  reorder: number;
  suggestedOrder: number;
  sources: {sales: number; counts: number};
};

export function productTotals(stores: StoreProduct[]): ProductTotals {
  const counted = stores.filter((s) => s.movement?.onHand != null);
  const out = stores.filter((s) => s.movement?.status === 'out').length;
  const reorder = stores.filter((s) => s.movement?.status === 'reorder').length;
  return {
    onHand: counted.length ? counted.reduce((a, s) => a + (s.movement?.onHand as number), 0) : null,
    storesCounted: counted.length,
    needing: out + reorder,
    out,
    reorder,
    suggestedOrder: stores.reduce((a, s) => a + (s.movement?.suggestedOrder ?? 0), 0),
    sources: {sales: stores.filter((s) => s.source === 'sales').length, counts: stores.filter((s) => s.source === 'counts').length},
  };
}

export type ProductInfo = {
  itemCode: string;
  name: string; // variant / shade
  productLine: string | null;
  price: number | null;
  bestseller: boolean;
  skuLinked: boolean;
};

type Status = ItemMovement['status'];

/** Everything the product page renders — plain data (no Maps), safe to pass to the client. */
export type ProductViewData = {
  item: ProductInfo;
  stores: Array<{code: string; name: string | null}>;
  store: string | null; // null = all stores
  chart: ChartMonth[];
  hasLastYear: boolean;
  lastCountedWeeksAgo: number | null;
  runsOutMonthLabel: string | null;
  soldTable: ProductPage['soldTable'];
  soldLastMonth: {label: string; sold: number | null} | null;
  totals: ProductTotals;
  single: {
    storeName: string | null;
    status: Status;
    onHand: number | null;
    coverDays: number | null;
    stockOutDate: string | null;
    suggestedOrder: number;
    deadStock: boolean;
    latestEnd: string | null;
    source: SoldSource;
    registerCheck: boolean | null;
    countLines: CountLine[];
  } | null;
  storeRows: Array<{
    code: string;
    name: string | null;
    onHand: number | null;
    soldLastMonth: number | null;
    coverDays: number | null;
    suggestedOrder: number;
    status: Status;
    deadStock: boolean; // on hand, nothing sold in the last 2 cycles
    latestEnd: string | null;
  }>;
};

/**
 * The page for `requested` store (when it's one of the caller's), else the only store,
 * else all stores added up.
 */
export function productView(item: ProductInfo, inputs: StoreInput[], requested: string | null | undefined, now: Date = new Date()): ProductViewData {
  const all = inputs.map((s) => buildStoreProduct(s, item.itemCode));
  const single = all.find((s) => s.storeCode === requested) ?? (all.length === 1 ? all[0] : null);
  const scoped = single ? [single] : all;
  const page = buildProductPage(scoped, now);
  const totals = productTotals(scoped);
  const lastMonth = page.soldTable[1] ?? null;
  return {
    item,
    stores: all.map((s) => ({code: s.storeCode, name: s.storeName})),
    store: single?.storeCode ?? null,
    chart: page.chart,
    hasLastYear: page.hasLastYear,
    lastCountedWeeksAgo: page.lastCountedWeeksAgo,
    runsOutMonthLabel: page.runsOutMonthLabel,
    soldTable: page.soldTable,
    soldLastMonth: lastMonth ? {label: lastMonth.label, sold: lastMonth.sold} : null,
    totals,
    single: single
      ? {
          storeName: single.storeName,
          status: single.movement?.status ?? 'not_counted',
          onHand: single.movement?.onHand ?? null,
          coverDays: single.movement?.coverDays ?? null,
          stockOutDate: single.movement?.stockOutDate ?? null,
          suggestedOrder: single.movement?.suggestedOrder ?? 0,
          deadStock: single.movement?.deadStock ?? false,
          latestEnd: single.latestEnd,
          source: single.source,
          registerCheck: single.registerCheck,
          countLines: single.countLines,
        }
      : null,
    storeRows: single
      ? []
      : all.map((s) => ({
          code: s.storeCode,
          name: s.storeName,
          onHand: s.movement?.onHand ?? null,
          soldLastMonth: lastMonth ? (s.soldByMonth.get(lastMonth.month) ?? null) : null,
          coverDays: s.movement?.coverDays ?? null,
          suggestedOrder: s.movement?.suggestedOrder ?? 0,
          status: s.movement?.status ?? 'not_counted',
          deadStock: s.movement?.deadStock ?? false,
          latestEnd: s.latestEnd,
        })),
  };
}
