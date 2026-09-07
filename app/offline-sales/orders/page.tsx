import {getPosOrdersPage} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {parsePage} from '@/src/pos-sales-compute';
import {OfflineOrdersView} from '@/components/analyst/offline-orders';

export const dynamic = 'force-dynamic';

export default async function Page({searchParams}: {searchParams: {page?: string}}) {
  const {orders, pageInfo} = await getPosOrdersPage(parsePage(searchParams.page));
  return <OfflineOrdersView orders={orders} pageInfo={pageInfo} usingMock={usingPosMock()} />;
}
