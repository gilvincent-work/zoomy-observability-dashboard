import {getBusinessHealth} from '@/src/health-data';
import {HealthView} from '@/components/analyst/health-view';
import {OfflineHealthCard} from '@/components/analyst/offline-health-card';
import {getPosOrders} from '@/src/pos-sales';
import {computeKpis} from '@/src/pos-sales-compute';

export const dynamic = 'force-dynamic';

// Offline actuals for the self-contained health card. Isolated + fail-soft: an
// offline-data hiccup must never break the core (batch-driven) Business Health
// page — on any error or when there are no offline orders, the card is omitted.
async function offlineActuals(): Promise<{aov: number; orders: number} | null> {
  try {
    const orders = await getPosOrders();
    if (orders.length === 0) return null;
    const {revenue, orders: count} = computeKpis(orders);
    return {aov: count ? Math.round((revenue / count) * 100) / 100 : 0, orders: count};
  } catch {
    return null;
  }
}

export default async function HealthPage() {
  const [snapshot, offline] = await Promise.all([getBusinessHealth(), offlineActuals()]);
  return (
    <>
      <HealthView snapshot={snapshot} />
      {offline && (
        <div className="mx-auto max-w-[1560px] px-6 pb-10">
          <OfflineHealthCard aov={offline.aov} orders={offline.orders} target={snapshot.target} />
        </div>
      )}
    </>
  );
}
