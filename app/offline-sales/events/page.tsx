import {getPosEvents, getPosOrders} from '@/src/pos-sales';
import {usingPosMock} from '@/src/pos-data';
import {eventRollups} from '@/src/pos-sales-compute';
import {OfflineEventsView} from '@/components/analyst/offline-events';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [events, orders] = await Promise.all([getPosEvents(), getPosOrders()]);
  return (
    <OfflineEventsView
      rollups={eventRollups(events, orders)}
      usingMock={usingPosMock()}
      fetchedAt={new Date().toISOString()}
    />
  );
}
