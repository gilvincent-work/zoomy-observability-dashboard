import {getPosOrders} from '@/src/pos-sales';
import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {topBundles, topProducts} from '@/src/pos-sales-compute';
import {RankingsView} from '@/components/analyst/rankings-view';

export const dynamic = 'force-dynamic';

// "View all" target for the Offline Sales overview's Top products / Top bundles
// cards. Self-contained: it re-derives the FULL ranked lists (limit Infinity)
// rather than the overview's top-5, then hands them to the client view which
// filters / sorts / paginates entirely client-side (the catalog is small, and
// getPosOrders already pages its underlying reads, so the lists are complete).
export default async function Page() {
  const [orders, products] = await Promise.all([getPosOrders(), getPosProducts()]);
  // product_ids still in the catalog. topProducts only emits rows with a real
  // product_id, but a delisted SKU can linger in historical orders — gate the
  // per-row link on catalog membership so a live product deep-links to its
  // /inventory/[sku] detail and a gone one renders as plain text (no 404).
  const liveProductIds = products.map((p) => p.product_id);
  return (
    <RankingsView
      products={topProducts(orders, Infinity, 'revenue')}
      bundles={topBundles(orders, Infinity)}
      liveProductIds={liveProductIds}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
