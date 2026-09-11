import type {PosOrder} from '@/src/pos-sales-types';
import type {DailyProgress} from '@/src/pos-target-types';
import {getPosOrders, getPosSyncLog} from '@/src/pos-sales';
import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {getDailyTarget} from '@/src/pos-target';
import {progress as computeProgress, todaysRevenue} from '@/src/pos-target-compute';
import {
  bundleSalesSummary,
  computeKpis,
  filterOrdersByRange,
  isSalesRange,
  salesByDay,
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

export default async function Page({searchParams}: {searchParams: {range?: string}}) {
  const range = isSalesRange(searchParams.range) ? searchParams.range : '30d';
  const [allOrders, sync, products] = await Promise.all([getPosOrders(), getPosSyncLog(), getPosProducts()]);
  const orders = filterOrdersByRange(allOrders, range);
  const progress = await dailyProgress(allOrders);

  return (
    <OfflineSalesView
      range={range}
      progress={progress}
      kpis={computeKpis(orders)}
      daily={salesByDay(orders)}
      top={topProducts(orders)}
      topBundles={topBundles(orders)}
      bundles={bundleSalesSummary(orders)}
      orders={orders}
      sync={sync}
      alerts={stockAlerts(products)}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
