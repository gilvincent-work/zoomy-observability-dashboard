import {getPosOrdersPage, getPosOrdersPriceBounds} from '@/src/pos-sales';
import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {parseOrdersFilter, parsePage} from '@/src/pos-sales-compute';
import {OfflineOrdersView} from '@/components/analyst/offline-orders';
import type {PosCatalogItem} from '@/src/pos-sales-types';

export const dynamic = 'force-dynamic';

type SearchParams = {page?: string; method?: string; range?: string; min?: string; max?: string};

export default async function Page({searchParams}: {searchParams: SearchParams}) {
  const filter = parseOrdersFilter(searchParams);
  const [{orders, pageInfo}, bounds, products] = await Promise.all([
    getPosOrdersPage(parsePage(searchParams.page), filter),
    getPosOrdersPriceBounds(),
    getPosProducts(),
  ]);
  // Slim catalog for the edit-order product picker (listed products only).
  const catalog: PosCatalogItem[] = products
    .filter((p) => p.active)
    .map((p) => ({product_id: p.product_id, name: p.name, price: p.price}));
  return (
    <OfflineOrdersView
      orders={orders}
      pageInfo={pageInfo}
      filter={filter}
      bounds={bounds}
      catalog={catalog}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
