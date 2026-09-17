'use client';

// Chrome for the merged Inventory page (Stratpoint / Offline channel): title,
// the All products / Summary tabs, the channel segment, the venue dropdown, and
// the New product + Add stock header actions. Tab / channel / venue are URL params
// so the server refetches (monthly sales are venue-scoped); Line/status/search/sort
// stay client-side on the loaded rows.

import {useState, useTransition} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {createPortal} from 'react-dom';
import {Package, Plus, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {POS_CATEGORIES} from '@/src/pos-format';
import {createProductAction} from '@/src/pos-actions';
import {AddStockButton} from './add-stock-button';
import {InventoryTable} from './inventory-table';
import {InventorySummary} from './inventory-summary';
import {BundleControls} from './bundle-controls';
import type {InventoryPageData} from '@/src/pos-inventory-data';
import type {PosBundleRow} from '@/src/pos-types';

type Tab = 'all' | 'bundles' | 'summary';

export function InventoryView({data, bundles, tab, channel, venue}: {
  data: InventoryPageData; bundles: PosBundleRow[]; tab: Tab; channel: string; venue: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  // Build an /inventory href preserving the other params (omitting defaults).
  const href = (next: {tab?: Tab; channel?: string; venue?: string}) => {
    const t = next.tab ?? tab, c = next.channel ?? channel, v = next.venue ?? venue;
    const p = new URLSearchParams();
    if (c && c !== 'offline') p.set('channel', c);
    if (t && t !== 'all') p.set('tab', t);
    if (v && v !== 'all') p.set('venue', v);
    const qs = p.toString();
    return qs ? `/inventory?${qs}` : '/inventory';
  };

  const intake = data.rows.map((r) => ({product_id: r.product_id, name: r.name, stock: r.stock}));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Package className="size-3.5" /> Offline inventory {data.usingMock && <span className="text-amber-600 dark:text-amber-400">· demo data</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Inventory</h1>
            <div className="inline-flex rounded-md border p-0.5">
              <ChannelLink href={href({channel: 'offline'})} active={channel === 'offline'}>Stratpoint <span className="font-mono text-[9px] opacity-70">offline</span></ChannelLink>
              <ChannelLink href={href({channel: 'online'})} active={false}>BoxMe <span className="font-mono text-[9px] opacity-70">online</span></ChannelLink>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <Plus className="size-3.5" /> New product
          </button>
          <AddStockButton products={intake} />
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-4 inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
        <TabLink href={href({tab: 'all'})} active={tab === 'all'}>All products</TabLink>
        <TabLink href={href({tab: 'bundles'})} active={tab === 'bundles'}>Bundles</TabLink>
        <TabLink href={href({tab: 'summary'})} active={tab === 'summary'}>Summary</TabLink>
      </div>

      {/* Venue (only meaningful on All products) */}
      {tab === 'all' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Venue</span>
            <select value={venue} onChange={(e) => router.push(href({venue: e.target.value}))} aria-label="Filter by venue" className="bg-transparent font-medium outline-none">
              {data.venues.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {tab === 'all' ? (
        <InventoryTable rows={data.rows} usingMock={data.usingMock} />
      ) : tab === 'bundles' ? (
        <BundleControls bundles={bundles} />
      ) : (
        <InventorySummary summary={data.summary} forecastRows={data.forecastRows} config={data.config} plan={data.plan} usingMock={data.usingMock} />
      )}

      {creating && <NewProductDialog usingMock={data.usingMock} onClose={() => setCreating(false)} onCreated={() => {setCreating(false); router.refresh();}} />}
    </div>
  );
}

function TabLink({href, active, children}: {href: string; active: boolean; children: React.ReactNode}) {
  return <Link href={href} scroll={false} className={cn('rounded-md px-4 py-1.5 text-sm font-semibold transition-colors', active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{children}</Link>;
}
function ChannelLink({href, active, children}: {href: string; active: boolean; children: React.ReactNode}) {
  return <Link href={href} scroll={false} className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors', active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{children}</Link>;
}

function NewProductDialog({usingMock, onClose, onCreated}: {usingMock: boolean; onClose: () => void; onCreated: () => void}) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await createProductAction({product_id: sku.trim(), name: name.trim(), price: price.trim() || undefined, category: category || null});
      if (res.ok) onCreated();
      else setError(res.error);
    });
  }
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-md rounded-xl border bg-popover p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">New product</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="SKU Code"><input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ZMY…" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring" /></Field>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring" /></Field>
          <div className="flex gap-3">
            <Field label="Price"><div className="flex items-center gap-1"><span className="text-sm text-muted-foreground">₱</span><input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus-visible:border-ring" /></div></Field>
            <Field label="Line"><select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring"><option value="">—</option>{POS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          </div>
        </div>
        {usingMock && <p className="mt-3 text-xs text-muted-foreground">Demo mode — set the Supabase pos_* env to create.</p>}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={pending || usingMock || !sku.trim() || !name.trim()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{pending ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
function Field({label, children}: {label: string; children: React.ReactNode}) {
  return <label className="flex flex-col gap-1"><span className="text-xs font-medium">{label}</span>{children}</label>;
}
