import {getPosOrders, getPosSyncLog} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {
  computeKpis,
  filterOrdersByRange,
  isSalesRange,
  salesByDay,
  topProducts,
} from '@/src/pos-sales-compute';
import {OfflineSalesView} from '@/components/analyst/offline-sales';

export const dynamic = 'force-dynamic';

export default async function Page({searchParams}: {searchParams: {range?: string}}) {
  const range = isSalesRange(searchParams.range) ? searchParams.range : '30d';
  const [allOrders, sync] = await Promise.all([getPosOrders(), getPosSyncLog()]);
  const orders = filterOrdersByRange(allOrders, range);

  return (
    <OfflineSalesView
      range={range}
      kpis={computeKpis(orders)}
      daily={salesByDay(orders)}
      top={topProducts(orders)}
      orders={orders}
      sync={sync}
      usingMock={usingPosMock()}
    />
  );
}
