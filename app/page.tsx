import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {OverviewTab} from '@/components/analyst/tabs';
import {HomeLanding} from '@/components/analyst/home-landing';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

const CHANNELS = ['shopee', 'lazada', 'website'] as const;
type Channel = (typeof CHANNELS)[number];

export default async function Page({searchParams}: {searchParams: {week?: string; channel?: string}}) {
  // Customer PII is masked inside getDigests() (server-only) rather than here, so
  // every route is fail-closed — see src/data.ts + src/pii.ts.
  const digests = await getDigests();
  const row = digests[pickIndex(digests, searchParams.week)];
  if (!row) return <div className="p-10 text-muted-foreground">No digests archived yet.</div>;

  // Home ("What should we do today?") is the default; a ?channel opens that
  // channel's analytics.
  const channel = CHANNELS.includes(searchParams.channel as Channel) ? (searchParams.channel as Channel) : null;
  if (!channel) return <HomeLanding row={row} />;
  return <OverviewTab brief={getBrief()} row={row} initialChannel={channel} />;
}
