import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {eventRollups, featuredEvent, manilaDayKey, resolveOrderEvents} from '@/src/pos-sales-compute';
import {OfflineEventsView} from '@/components/analyst/offline-events';
import {getSpinLeads} from '@/src/spin-leads';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [events, rawOrders, leads] = await Promise.all([getPosEvents(), getPosOrders(), getSpinLeads()]);
  // Attribute untagged past-day sales to any event whose dates now cover them
  // (automatic, read-time — see resolveOrderEvents). Everything below groups by the
  // resolved event_id, so extending an event's dates folds those sales in.
  const orders = resolveOrderEvents(rawOrders, events);
  // The event running today (if any) gets spotlighted, expanded, at the top.
  const todayKey = manilaDayKey(new Date().toISOString());
  const featured = featuredEvent(events, todayKey);
  const currentEventId = featured?.state === 'current' ? featured.event.event_id : null;

  return (
    <OfflineEventsView
      rollups={eventRollups(events, orders)}
      orders={orders}
      leads={leads}
      currentEventId={currentEventId}
      todayKey={todayKey}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
