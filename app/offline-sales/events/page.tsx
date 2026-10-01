import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {currentEventIds, eventRollups, manilaDayKey, resolveOrderEvents} from '@/src/pos-sales-compute';
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
  // expanded, at the top. Correcting a sale's event (reassign) now lives on the
  // Transactions tab, per-transaction, not here.
  const todayKey = manilaDayKey(new Date().toISOString());
  const currentIds = currentEventIds(events, todayKey);

  return (
    <OfflineEventsView
      rollups={eventRollups(events, orders)}
      orders={orders}
      leads={leads}
      currentEventIds={currentIds}
      todayKey={todayKey}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
