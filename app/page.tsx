import {getDigests, usingMock} from '../src/data';
import {Dashboard} from '@/components/dashboard';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

export default async function Page() {
  const digests = await getDigests();
  return <Dashboard digests={digests} usingMock={usingMock()} />;
}
