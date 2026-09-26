import Link from 'next/link';
import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {getPosBundles} from '@/src/pos-data';
import {getInventoryPageData} from '@/src/pos-inventory-data';
import {getLocationStock} from '@/src/pos-location-data';
import {getFreeTasteSummary} from '@/src/pos-free-taste-data';
import {cn} from '@/lib/utils';
import {InventoryTab} from '@/components/analyst/tabs';
import {InventoryView} from '@/components/analyst/inventory-view';

export const dynamic = 'force-dynamic';

// D12: the URL param stays `channel`; `offline`/`stratpoint`/`all` alias the merged
// Stratpoint (Offline) catalog (the default), and `online`/`boxme` the BoxMe/online
// scope. This keeps the low-stock email CTA and the Offline Sales "View all"
// snapshot (both deep-linking `?channel=offline`) working with no cross-repo change.
function isOnline(channel: string | undefined): boolean {
  return channel === 'online' || channel === 'boxme';
}

export default async function Page(
  props: {searchParams: Promise<{channel?: string; tab?: string; venue?: string; week?: string}>}
) {
  const searchParams = await props.searchParams;
  if (isOnline(searchParams.channel)) {
    return <OnlineInventory week={searchParams.week} />;
  }
  const tab = searchParams.tab === 'summary' ? 'summary' : searchParams.tab === 'bundles' ? 'bundles' : 'all';
  const venue = searchParams.venue ?? 'all';
  const [data, bundles, locations, sampling] = await Promise.all([
    getInventoryPageData(venue),
    getPosBundles(),
    getLocationStock().catch(() => []),
    getFreeTasteSummary().catch(() => ({windowDays: 30, totalUnits: 0, totalCount: 0, oversoldCount: 0, byProduct: [], recent: []})),
  ]);
  return <InventoryView data={data} bundles={bundles} tab={tab} channel="offline" venue={data.activeVenue} locations={locations} sampling={sampling} />;
}

// D13: the Online scope KEEPS the existing marketplace analytics (digest-driven
// InventoryTab) and adds a BoxMe stock stub above it — nothing is removed.
async function OnlineInventory({week}: {week?: string}) {
  const digests = await getDigests();
  const row = digests[pickIndex(digests, week)];
  return (
    <div>
      <div className="mx-auto max-w-5xl px-6 pt-8 md:px-10">
        <div className="mb-4 inline-flex rounded-md border p-0.5">
          <Link href="/inventory" scroll={false} className="rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">Stratpoint <span className="font-mono text-[9px] opacity-70">offline</span></Link>
          <span className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium', 'bg-primary text-primary-foreground')}>BoxMe <span className="font-mono text-[9px] opacity-70">online</span></span>
        </div>
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <span aria-hidden>🛰️</span>
          <span>
            <b className="font-medium text-foreground">BoxMe online stock isn&apos;t connected yet.</b> Until a feed lands, this shows the marketplace analytics below.
            {/* TODO: real online (BoxMe) stock feed — replace this stub with live per-SKU online inventory. */}
          </span>
        </div>
      </div>
      {row ? <InventoryTab brief={getBrief()} row={row} /> : <div className="mx-auto max-w-5xl px-6 py-6 text-muted-foreground md:px-10">No marketplace digest archived yet.</div>}
    </div>
  );
}
