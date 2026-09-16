import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {eventRollups, featuredEvent, manilaDayKey, resolveOrderEvents} from '@/src/pos-sales-compute';
import {OfflineEventsView} from '@/components/analyst/offline-events';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [events, rawOrders] = await Promise.all([getPosEvents(), getPosOrders()]);
  // Attribute untagged past-day sales to any event whose dates now cover them
  // (automatic, read-time — see resolveOrderEvents). Everything below groups by the
  // resolved event_id, so extending an event's dates folds those sales in.
  const orders = resolveOrderEvents(rawOrders, events);
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
