import {getPosOrdersPage, getPosOrdersPriceBounds} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {parseOrdersFilter, parsePage} from '@/src/pos-sales-compute';
import {OfflineOrdersView} from '@/components/analyst/offline-orders';

export const dynamic = 'force-dynamic';

type SearchParams = {page?: string; method?: string; range?: string; min?: string; max?: string};

export default async function Page({searchParams}: {searchParams: SearchParams}) {
  const filter = parseOrdersFilter(searchParams);
  const [{orders, pageInfo}, bounds] = await Promise.all([
    getPosOrdersPage(parsePage(searchParams.page), filter),
    getPosOrdersPriceBounds(),
  ]);
  return (
    <OfflineOrdersView
      orders={orders}
      pageInfo={pageInfo}
      filter={filter}
      bounds={bounds}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
