import {getDigests, usingMock} from '../src/data';
import {getBrief} from '../src/salesSignals';
import {AnalystDashboard} from '@/components/analyst/analyst-dashboard';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

export default async function Page() {
  const digests = await getDigests();
  // Sales/CRM/traffic analyst brief is mocked until the extended retrieval bundle
  // (Shopify/CRM/GA4 — Dev A's seam) exists; the digest archive is already live-shaped.
  const brief = getBrief();
  return <AnalystDashboard digests={digests} brief={brief} usingMock={usingMock()} />;
}
