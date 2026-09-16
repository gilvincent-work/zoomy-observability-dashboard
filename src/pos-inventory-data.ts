import 'server-only';
import {getPosProducts, usingPosMock} from './pos-data';
import {getPosOrders, getPosEvents} from './pos-sales';
import {getStockForecast} from './pos-forecast-data';
import {salesByProductMonth, compareByCategory, emptyMonthlySales, type MonthlySales} from './pos-inventory-compute';
import type {ForecastStatus, ForecastConfig, NextEventPlan, SurgeSummary, SurgeRow, ForecastRow} from './pos-forecast-compute';
import type {PosProductRow} from './pos-types';

// SERVER-ONLY. Assembles the merged Inventory page: catalog (pos_products) +
// event-aware forecast (status, cover, reorder) + monthly sell-through, narrowed
// by an optional venue. Fail-soft throughout: a forecast/orders/events read hiccup
// degrades to a catalog-only view (zero sales, all-venues), never a 500.

export interface InventoryRow {
  product_id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  emoji: string | null;
  active: boolean;
  price: number | null;
  stock: number; // "Stock Qty" — the single global on-hand (D3)
  status: ForecastStatus;
  coverEventDays: number | null;
  runsOutLabel: string;
  reorderQty: number | null;
  monthly: MonthlySales;
}

export interface VenueOption {
  key: string; // 'all' | 'unattributed' | the venue name
  label: string;
  eventCount: number;
}

export interface InventoryPageData {
  rows: InventoryRow[];
  venues: VenueOption[];
  activeVenue: string; // 'all' by default
  config: ForecastConfig | null;
  plan: NextEventPlan | null;
  forecastRows: ForecastRow[]; // for the Summary tab's interactive surge planner
  surge: Map<string, SurgeRow>;
  surgeSummary: SurgeSummary | null;
  summary: {healthy: number; low: number; out: number; unlisted: number; total: number};
  usingMock: boolean;
}

/** Distinct venues from past events, each with its event_ids, plus All + Unattributed. */
async function loadVenues(): Promise<{options: VenueOption[]; eventsByVenue: Map<string, Set<string>>}> {
  const eventsByVenue = new Map<string, Set<string>>();
  try {
    const events = await getPosEvents();
    for (const e of events) {
      const v = (e.venue ?? '').trim();
      if (!v) continue;
      const set = eventsByVenue.get(v) ?? new Set<string>();
      set.add(e.event_id);
      eventsByVenue.set(v, set);
    }
  } catch {
    // no venues; the filter simply offers "All" only
  }
  const options: VenueOption[] = [{key: 'all', label: 'All venues', eventCount: 0}];
  for (const [venue, ids] of [...eventsByVenue.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    options.push({key: venue, label: venue, eventCount: ids.size});
  }
  options.push({key: 'unattributed', label: 'No venue (walk-in)', eventCount: 0});
  return {options, eventsByVenue};
}

export async function getInventoryPageData(
  venueKey: string = 'all',
  now: Date = new Date(),
): Promise<InventoryPageData> {
  const products: PosProductRow[] = await getPosProducts(); // throws only on a hard failure; page catches
  const [forecast, orders, venueData] = await Promise.all([
    getStockForecast(now).catch(() => null),
    getPosOrders().catch(() => [] as Awaited<ReturnType<typeof getPosOrders>>),
    loadVenues(),
  ]);

  // Resolve the venue filter to the set of events it covers.
  const activeVenue = venueData.options.some((o) => o.key === venueKey) ? venueKey : 'all';
  let venueFilter: Set<string> | 'unattributed' | undefined;
  if (activeVenue === 'unattributed') venueFilter = 'unattributed';
  else if (activeVenue !== 'all') venueFilter = venueData.eventsByVenue.get(activeVenue);

  const monthly = salesByProductMonth(orders, now, venueFilter);
  const forecastById = new Map((forecast?.rows ?? []).map((r) => [r.product_id, r]));

  const rows: InventoryRow[] = products
    .map((p): InventoryRow => {
      const f = forecastById.get(p.product_id);
      return {
        product_id: p.product_id,
        name: p.name,
        category: p.category,
        subcategory: p.subcategory,
        emoji: p.emoji,
        active: p.active,
        price: p.price,
        stock: p.stock,
        status: (f?.status ?? (p.stock <= 0 ? 'out' : 'healthy')) as ForecastStatus,
        coverEventDays: f?.coverEventDays ?? null,
        runsOutLabel: f?.runsOutLabel ?? (p.stock <= 0 ? 'Now' : 'No recent sales'),
        reorderQty: f?.reorderQty ?? null,
        monthly: monthly.get(p.product_id) ?? emptyMonthlySales(),
      };
    })
    .sort(compareByCategory); // default: Category order

  const summary = {
    healthy: rows.filter((r) => r.status === 'healthy').length,
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
    unlisted: rows.filter((r) => !r.active).length,
    total: rows.length,
  };

  return {
    rows,
    venues: venueData.options,
    activeVenue,
    config: forecast?.config ?? null,
    plan: forecast?.plan ?? null,
    forecastRows: forecast?.rows ?? [],
    surge: forecast?.surge ?? new Map(),
    surgeSummary: forecast?.surgeSummary ?? null,
    summary,
    usingMock: usingPosMock(),
  };
}
