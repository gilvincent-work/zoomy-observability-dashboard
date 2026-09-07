import {getBusinessHealth} from '@/src/health-data';
import {HealthView} from '@/components/analyst/health-view';
import {getPosOrders} from '@/src/pos-sales';
import {offlineChannelFacts} from '@/src/pos-sales-compute';
import type {BusinessHealthSnapshot} from '@/src/health-types';

export const dynamic = 'force-dynamic';

// Append offline as a fourth channel (from pos_orders) so it renders as a card
// and pools into the Overall QRR. Isolated + fail-soft: any offline error, or no
// offline orders, leaves the batch snapshot exactly as-is (three channels).
async function withOffline(snapshot: BusinessHealthSnapshot): Promise<BusinessHealthSnapshot> {
  try {
    const offline = offlineChannelFacts(await getPosOrders());
    if (!offline) return snapshot;
    return {...snapshot, perChannel: [...snapshot.perChannel, offline]};
  } catch {
    return snapshot;
  }
}

export default async function HealthPage() {
  const snapshot = await withOffline(await getBusinessHealth());
  return <HealthView snapshot={snapshot} />;
}
