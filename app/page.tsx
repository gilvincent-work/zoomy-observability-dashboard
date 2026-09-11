import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {ChannelOverview, type Channel} from '@/components/analyst/channel-compare';
import {HomeLanding} from '@/components/analyst/home-landing';
import {OfflineChannelCard} from '@/components/analyst/offline-channel-card';
import {getPosOrders} from '@/src/pos-sales';
import {computeKpis, filterOrdersByRange, offlineCompareMetrics} from '@/src/pos-sales-compute';
import {getDailyTarget} from '@/src/pos-target';
import {progress as computeProgress, todaysRevenue} from '@/src/pos-target-compute';
import type {SalesKpis} from '@/src/pos-sales-types';
import type {DailyProgress} from '@/src/pos-target-types';

export const dynamic = 'force-dynamic'; // reflect the latest archive when live

// All channels, including offline, are selected by default on the compare
// Overview (PO decision 2026-09-07). Note: offline totals are all-time (offline
// isn't tied to the digest's weekly window), so the headline totals mix bases;
// the period-over-period trend arrows stay like-for-like (offline is excluded
// from that comparison in CombinedKpis, since it has no prior-window data).
const ALL_CHANNELS: Channel[] = ['shopee', 'lazada', 'website', 'offline'];
const DEFAULT_CHANNELS: Channel[] = ['shopee', 'lazada', 'website', 'offline'];

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

// Today's revenue (Manila day) vs the owner-set goal, for the landing's compact
// health bar. Same fail-soft contract: null on any error hides the bar.
// getPosOrders is React-cached, so this shares the fetch with offlineKpis().
async function offlineDailyProgress(): Promise<DailyProgress | null> {
  try {
    const target = await getDailyTarget();
    return computeProgress(todaysRevenue(await getPosOrders()), target.amount);
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
    const [kpis, progress] = await Promise.all([offlineKpis(), offlineDailyProgress()]);
    return (
      <>
        <HomeLanding row={row} progress={progress} />
        {kpis && (
          <div className="mx-auto -mt-6 max-w-5xl px-6 pb-12 md:px-10">
            <OfflineChannelCard kpis={kpis} />
          </div>
        )}
      </>
    );
  }
  const initial = ALL_CHANNELS.includes(ch as Channel) ? [ch as Channel] : DEFAULT_CHANNELS;
  const offline = await offlineCompare();
  return <ChannelOverview brief={getBrief()} row={row} priorRow={priorRow} initialChannels={initial} offline={offline} />;
}
