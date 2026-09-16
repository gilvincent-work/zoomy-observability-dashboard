import Link from 'next/link';
import {getDigests} from '@/src/data';
import {getBrief} from '@/src/salesSignals';
import {pickIndex} from '@/src/week';
import {usingPosMock} from '@/src/pos-data';
import {getStockForecast} from '@/src/pos-forecast-data';
import {getStockReceipts} from '@/src/pos-stock-intake';
import {cn} from '@/lib/utils';
import {InventoryTab} from '@/components/analyst/tabs';
import {InventoryForecast} from '@/components/analyst/inventory-forecast';

export const dynamic = 'force-dynamic';

type Channel = 'all' | 'online' | 'offline';
const CHANNELS: {value: Channel; label: string; hint: string}[] = [
  {value: 'all', label: 'All', hint: ''},
  {value: 'offline', label: 'Offline', hint: 'POS'},
  {value: 'online', label: 'Online', hint: 'market'},
];

function parseChannel(v: string | undefined): Channel {
  return v === 'online' || v === 'offline' ? v : 'all';
}

export default async function Page({searchParams}: {searchParams: {channel?: string; week?: string}}) {
  // Default landing scope is All (Q8); the Offline Sales "View all" deep-links to
  // ?channel=offline. Online keeps the existing marketplace (digest) view (Q7).
  const channel = parseChannel(searchParams.channel);
  const week = searchParams.week;

  return (
    <div>
      <div className="mx-auto flex max-w-5xl items-center justify-end px-6 pt-6 md:px-10">
        <ChannelTabs channel={channel} week={week} />
      </div>
      {channel === 'online' ? <OnlineInventory week={week} /> : <OfflineInventory channel={channel} />}
    </div>
  );
}

async function OfflineInventory({channel}: {channel: Exclude<Channel, 'online'>}) {
  const [forecast, receipts] = await Promise.all([getStockForecast(), safeReceipts()]);
  const props = forecast ? {rows: forecast.rows, config: forecast.config, plan: forecast.plan} : null;
  return <InventoryForecast forecast={props} receipts={receipts} scope={channel} usingMock={usingPosMock()} />;
}

// Fail-soft: history is a secondary panel, so a read hiccup just yields an empty
// list rather than taking down the forecast.
async function safeReceipts() {
  try {
    return await getStockReceipts();
  } catch {
    return [];
  }
}

async function OnlineInventory({week}: {week?: string}) {
  const digests = await getDigests();
  const row = digests[pickIndex(digests, week)];
  if (!row) return <div className="p-10 text-muted-foreground">No digests archived yet.</div>;
  return <InventoryTab brief={getBrief()} row={row} />;
}

function ChannelTabs({channel, week}: {channel: Channel; week?: string}) {
  const href = (c: Channel) => {
    const p = new URLSearchParams();
    if (c !== 'all') p.set('channel', c);
    if (week) p.set('week', week);
    const qs = p.toString();
    return qs ? `/inventory?${qs}` : '/inventory';
  };
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {CHANNELS.map((c) => (
        <Link
          key={c.value}
          href={href(c.value)}
          scroll={false}
          className={cn(
            'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            c.value === channel ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {c.label}
          {c.hint && <span className="font-mono text-[9px] opacity-70">{c.hint}</span>}
        </Link>
      ))}
    </div>
  );
}
