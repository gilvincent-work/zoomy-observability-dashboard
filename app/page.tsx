import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {ChannelOverview, type Channel} from '@/components/analyst/channel-compare';
import {HomeLanding} from '@/components/analyst/home-landing';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

const CHANNELS: Channel[] = ['shopee', 'lazada', 'website'];

export default async function Page({searchParams}: {searchParams: {week?: string; channel?: string}}) {
  // Customer PII is masked inside getDigests() (server-only) rather than here, so
  // every route is fail-closed — see src/data.ts + src/pii.ts.
  const digests = await getDigests();
  const idx = pickIndex(digests, searchParams.week);
  const row = digests[idx];
  if (!row) return <div className="p-10 text-muted-foreground">No digests archived yet.</div>;
  const priorRow = digests[idx + 1] ?? null; // the next-older period, for KPI deltas

  // Home ("What should we do today?") is the default; a ?channel opens the unified
  // overview — 'all' (or an unknown value) selects every channel, a single channel
  // starts filtered to it (drills into its detail).
  const ch = searchParams.channel;
  if (!ch) return <HomeLanding row={row} />;
  const initial = CHANNELS.includes(ch as Channel) ? [ch as Channel] : CHANNELS;
  return <ChannelOverview brief={getBrief()} row={row} priorRow={priorRow} initialChannels={initial} />;
}
