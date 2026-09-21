import type {PosOrder} from '@/src/pos-sales-types';
import type {DailyProgress} from '@/src/pos-target-types';
import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {getStockForecast} from '@/src/pos-forecast-data';
import {urgentForecastRows} from '@/src/pos-forecast-compute';
import {getDailyTarget} from '@/src/pos-target';
import {progress as computeProgress, todaysRevenue} from '@/src/pos-target-compute';
import {
  bundleSalesSummary,
  computeKpis,
  featuredEvent,
  filterOrdersByRange,
  isSalesRange,
  manilaDayKey,
  stockAlerts,
  topBundles,
  topProducts,
} from '@/src/pos-sales-compute';
import {OfflineSalesView} from '@/components/analyst/offline-sales';

export const dynamic = 'force-dynamic';

// Today's revenue (Manila day) vs the owner-set goal. Fail-soft: any target
// hiccup returns null so the health bar is simply omitted, never taking down a
// page whose other reads succeeded (mirrors app/page.tsx's offline isolation).
async function dailyProgress(orders: PosOrder[]): Promise<DailyProgress | null> {
  try {
    const target = await getDailyTarget();
    return computeProgress(todaysRevenue(orders), target.amount);
  } catch {
    return null;
  }
}

export default async function Page(props: {searchParams: Promise<{range?: string}>}) {
  const searchParams = await props.searchParams;
  const range = isSalesRange(searchParams.range) ? searchParams.range : '30d';
  const [allOrders, products, events] = await Promise.all([
    getPosOrders(),
    getPosProducts(),
    getPosEvents(),
  ]);
  const orders = filterOrdersByRange(allOrders, range);
  const progress = await dailyProgress(allOrders);
  // Stock snapshot for the panel that replaces "Recently synced" — fail-soft.
  const forecast = await getStockForecast();
  const stock = forecast ? {urgent: urgentForecastRows(forecast.rows), summary: forecast.summary} : null;
  // Spotlight the event running today, else the next upcoming one (Manila day).
  const featured = featuredEvent(events, manilaDayKey(new Date().toISOString()));

  return (
    <OfflineSalesView
      range={range}
      progress={progress}
      featured={featured}
      kpis={computeKpis(orders)}
      top={topProducts(orders)}
      topByUnits={topProducts(orders, 5, 'units')}
      topBundles={topBundles(orders)}
      bundles={bundleSalesSummary(orders)}
      orders={orders}
      stock={stock}
      alerts={stockAlerts(products)}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
