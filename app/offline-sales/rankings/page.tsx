import {notFound} from 'next/navigation';
import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {datesInRange, manilaDayKey, resolveOrderEvents, topBundles, topProducts} from '@/src/pos-sales-compute';
import {parseRankingsDir, parseRankingsSort, pickEventDay} from '@/src/pos-rankings';
import {RankingsView, type RankingsEventScope} from '@/components/analyst/rankings-view';

export const dynamic = 'force-dynamic';

// "View all" target for the Offline Sales overview's Top products / Top bundles
// cards, and (with `?event=`) for an event tile's Top sellers. Self-contained: it
// re-derives the FULL ranked lists (limit Infinity) rather than the top-5, then
// hands them to the client view which filters / sorts / paginates entirely
// client-side (the catalog is small, and getPosOrders already pages its
// underlying reads, so the lists are complete).
export default async function Page(props: {searchParams: Promise<{event?: string; day?: string; sort?: string; dir?: string}>}) {
  const sp = await props.searchParams;
  const [allOrders, products, events] = await Promise.all([
    getPosOrders(),
    getPosProducts(),
    sp.event ? getPosEvents() : Promise.resolve([]),
  ]);

  // Event scope: the same order set the event tile analyses (read-time resolved
  // event attribution, then the tile's optional day filter), so the tile's top 5
  // are exactly the first rows here.
  let orders = allOrders;
  let scope: RankingsEventScope | null = null;
  if (sp.event) {
    const event = events.find((e) => e.event_id === sp.event);
    if (!event) notFound();
    const days = datesInRange(event.starts_on, event.ends_on);
    const day = pickEventDay(sp.day, days);
    orders = resolveOrderEvents(allOrders, events).filter(
      (o) => o.event_id === event.event_id && (!day || manilaDayKey(o.created_at) === day),
    );
    scope = {eventId: event.event_id, name: event.name || 'Untitled event', days, day};
  }

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
      scope={scope}
      initialSort={parseRankingsSort(sp.sort)}
      initialDir={parseRankingsDir(sp.dir)}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
