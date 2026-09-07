import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {ChannelOverview, type Channel} from '@/components/analyst/channel-compare';
import {HomeLanding} from '@/components/analyst/home-landing';
import {OfflineChannelCard} from '@/components/analyst/offline-channel-card';
import {getPosOrders} from '@/src/pos-sales';
import {computeKpis, filterOrdersByRange, offlineCompareMetrics} from '@/src/pos-sales-compute';
import type {SalesKpis} from '@/src/pos-sales-types';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

const CHANNELS: Channel[] = ['shopee', 'lazada', 'website', 'offline'];

// Offline 30-day KPIs for the Overview home card. Isolated + fail-soft: an
// offline data hiccup must never break the core (digest-driven) Overview — on
// any error the card is simply omitted.
async function offlineKpis(): Promise<SalesKpis | null> {
  try {
    const orders = filterOrdersByRange(await getPosOrders(), '30d');
    return computeKpis(orders);
  } catch {
    return null;
  }
}

// Offline metrics (all orders to date) for the Compare Channels chart. Same
// fail-soft contract: null on any error so the chart just omits offline.
async function offlineCompare(): Promise<ReturnType<typeof offlineCompareMetrics>> {
  try {
    return offlineCompareMetrics(await getPosOrders());
  } catch {
    return null;
  }
}

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
  if (!ch) {
    const kpis = await offlineKpis();
    return (
      <>
        <HomeLanding row={row} />
        {kpis && (
          <div className="mx-auto -mt-6 max-w-5xl px-6 pb-12 md:px-10">
            <OfflineChannelCard kpis={kpis} />
          </div>
        )}
      </>
    );
  }
  const initial = CHANNELS.includes(ch as Channel) ? [ch as Channel] : CHANNELS;
  const offline = await offlineCompare();
  return <ChannelOverview brief={getBrief()} row={row} priorRow={priorRow} initialChannels={initial} offline={offline} />;
}
