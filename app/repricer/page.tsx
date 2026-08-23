import {getLatestRepriceRun} from '@/src/reprice-data';
import {RepricerView} from '@/components/analyst/repricer-view';

export const dynamic = 'force-dynamic';

export default async function RepricerPage() {
  const run = await getLatestRepriceRun();
  return <RepricerView run={run} />;
}
