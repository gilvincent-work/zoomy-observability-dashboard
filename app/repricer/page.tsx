import {getLastChangeSummary, getLatestRepriceRun} from '@/src/reprice-data';
import {RepricerView} from '@/components/analyst/repricer-view';

export const dynamic = 'force-dynamic';

export default async function RepricerPage() {
  const [run, lastChange] = await Promise.all([getLatestRepriceRun(), getLastChangeSummary()]);
  return <RepricerView run={run} lastChange={lastChange} />;
}
