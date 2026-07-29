import {getDigests, usingMock} from '../src/data';
import {maskRows} from '../src/pii';
import {AnalystDashboard} from '@/components/analyst/analyst-dashboard';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

export default async function Page() {
  // Server Component: read archives (service-role) and mask customer PII HERE,
  // before anything reaches the browser (no auth in front of this app yet).
  const digests = maskRows(await getDigests());
  return <AnalystDashboard digests={digests} usingMock={usingMock()} />;
}
