import {getLatestRepriceRun, getRepricedVariants, getVariantHistory} from '@/src/reprice-data';
import {RepricerView} from '@/components/analyst/repricer-view';

export const dynamic = 'force-dynamic';

export default async function RepricerPage() {
  const [run, repriced] = await Promise.all([getLatestRepriceRun(), getRepricedVariants()]);
  const history = await getVariantHistory(repriced.map((v) => v.shopifyVariantId));
  return <RepricerView run={run} repriced={repriced} history={history} />;
}
