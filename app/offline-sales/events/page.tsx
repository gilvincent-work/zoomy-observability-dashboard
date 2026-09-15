import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {eventRollups, featuredEvent, manilaDayKey} from '@/src/pos-sales-compute';
import {OfflineEventsView} from '@/components/analyst/offline-events';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [events, orders] = await Promise.all([getPosEvents(), getPosOrders()]);
  // The event running today (if any) gets spotlighted, expanded, at the top.
  const featured = featuredEvent(events, manilaDayKey(new Date().toISOString()));
  const currentEventId = featured?.state === 'current' ? featured.event.event_id : null;

  return (
    <OfflineEventsView
      rollups={eventRollups(events, orders)}
      orders={orders}
      currentEventId={currentEventId}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
