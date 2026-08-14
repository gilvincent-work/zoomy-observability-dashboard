import {getBusinessHealth} from '@/src/health-data';
import {HealthView} from '@/components/analyst/health-view';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const snapshot = await getBusinessHealth();
  return <HealthView snapshot={snapshot} />;
}
