import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {currentEventIds, eventRollups, manilaDayKey, resolveOrderEvents, untaggedOnEventDays} from '@/src/pos-sales-compute';
import {OfflineEventsView} from '@/components/analyst/offline-events';
import {getSpinLeads} from '@/src/spin-leads';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [events, rawOrders, leads] = await Promise.all([getPosEvents(), getPosOrders(), getSpinLeads()]);
  // Attribute untagged past-day sales to any event whose dates now cover them
  // (automatic, read-time — see resolveOrderEvents). Everything below groups by the
  // resolved event_id, so extending an event's dates folds those sales in.
  const orders = resolveOrderEvents(rawOrders, events);
  // Every event running today (same-day events are allowed) is spotlighted,
  // expanded, at the top. Null-event sales on an event-covered day are surfaced
  // for manual assignment (the POS may have left one blank on an ambiguous day).
  const todayKey = manilaDayKey(new Date().toISOString());
  const currentIds = currentEventIds(events, todayKey);
  const untagged = untaggedOnEventDays(orders, events);

  return (
    <OfflineEventsView
      rollups={eventRollups(events, orders)}
      orders={orders}
      leads={leads}
      currentEventIds={currentIds}
      untagged={untagged}
      todayKey={todayKey}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
