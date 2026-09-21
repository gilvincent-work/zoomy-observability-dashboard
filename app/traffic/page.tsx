import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {TrafficTab} from '@/components/analyst/tabs';

export const dynamic = 'force-dynamic';

export default async function Page(props: {searchParams: Promise<{week?: string}>}) {
  const searchParams = await props.searchParams;
  const digests = await getDigests();
  const row = digests[pickIndex(digests, searchParams.week)];
  if (!row) return <div className="p-10 text-muted-foreground">No digests archived yet.</div>;
  return <TrafficTab brief={getBrief()} row={row} />;
}
