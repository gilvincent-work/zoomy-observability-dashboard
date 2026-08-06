'use client';

// Unified channel Overview — merges Shopee / Lazada / Website into one view with a
// channel filter, an apples-to-apples comparison chart, combined KPIs, and merged
// (channel-tagged) recommendations. Single-channel selection drills into that
// channel's full detail. Comparison numbers are read from each channel's existing
// figures (label-matched) — interim until the batch emits a normalized summary.
import {useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, Globe} from 'lucide-react';
import type {DigestArchiveRow, DigestFigure, DigestRec} from '../../src/types';
import type {AnalystBrief} from '../../src/salesSignals';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Sparkles} from 'lucide-react';
import {ShopeeIcon, LazadaIcon} from './brand-icons';
import {usePlaybook, recAction, recSteps} from './playbook';
import {ShopeeSection, LazadaSection, SalesSection, CustomersSection, ConversationsSection, VerdictHero} from './sections';

export type Channel = 'shopee' | 'lazada' | 'website';
const CHANNELS: {key: Channel; label: string; icon: React.ComponentType<{className?: string; style?: React.CSSProperties}>; accent: string}[] = [
  {key: 'shopee', label: 'Shopee', icon: ShopeeIcon, accent: '#ee4d2d'},
  {key: 'lazada', label: 'Lazada', icon: LazadaIcon, accent: '#f57224'},
  {key: 'website', label: 'Website', icon: Globe, accent: 'var(--primary)'},
];
const CH = Object.fromEntries(CHANNELS.map((c) => [c.key, c])) as Record<Channel, (typeof CHANNELS)[number]>;

// ── metric extraction (interim: read from each channel's existing figures) ───────
type Metric = 'revenue' | 'orders' | 'aov' | 'units';
const METRICS: {key: Metric; label: string; money?: boolean}[] = [
  {key: 'revenue', label: 'Revenue', money: true},
  {key: 'orders', label: 'Orders'},
  {key: 'aov', label: 'AOV', money: true},
  {key: 'units', label: 'Units'},
];

function figVal(figs: DigestFigure[] | undefined, re: RegExp, exclude?: RegExp): number | null {
  const f = (figs ?? []).find((x) => re.test(x.label) && (!exclude || !exclude.test(x.label)));
  return f ? f.value : null;
}
type ChannelMetrics = Record<Metric, number | null>;

function channelMetrics(row: DigestArchiveRow): Record<Channel, ChannelMetrics | null> {
  const d = row.digest;
  const sh = d.shopee?.sales?.figures;
  const lz = d.lazada?.sales?.figures;
  const wb = d.sales?.figures;
  return {
    shopee: d.shopee?.sales
      ? {revenue: figVal(sh, /^sales php/i), orders: figVal(sh, /buyers/i), aov: figVal(sh, /per buyer/i), units: null}
      : null,
    lazada: d.lazada?.sales
      ? {revenue: figVal(lz, /net revenue/i), orders: figVal(lz, /net orders/i), aov: figVal(lz, /aov/i), units: figVal(lz, /units/i)}
      : null,
    website: d.sales
      ? {revenue: figVal(wb, /net revenue/i), orders: figVal(wb, /orders/i, /trend|%/i), aov: figVal(wb, /aov/i), units: figVal(wb, /units/i)}
      : null,
  };
}

const money = (n: number) => `₱${n.toLocaleString(undefined, {maximumFractionDigits: n < 100 ? 2 : 0})}`;
const fmt = (m: Metric, n: number) => (METRICS.find((x) => x.key === m)?.money ? money(n) : n.toLocaleString());

// ── comparison chart ─────────────────────────────────────────────────────────────
function ComparisonChart({metrics, channels}: {metrics: Record<Channel, ChannelMetrics | null>; channels: Channel[]}) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const rows = channels
    .map((c) => ({c, value: metrics[c]?.[metric] ?? null}))
    .filter((r): r is {c: Channel; value: number} => r.value != null);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compare channels</div>
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                  metric === m.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data for this metric in the selected channels.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(({c, value}) => {
              const meta = CH[c];
              const Icon = meta.icon;
              return (
                <div key={c} className="flex items-center gap-3">
                  <div className="flex w-28 shrink-0 items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Icon className="size-4" style={{color: meta.accent}} /> {meta.label}
                  </div>
                  <div className="h-8 flex-1 overflow-hidden rounded-lg bg-muted">
                    <div className="h-full rounded-lg transition-all" style={{width: `${Math.max(3, (value / max) * 100)}%`, backgroundColor: meta.accent}} />
                  </div>
                  <div className="w-28 shrink-0 text-right text-[14px] font-semibold tabular-nums text-foreground">{fmt(metric, value)}</div>
                </div>
              );
            })}
          </div>
        )}
        {channels.includes('shopee') && metric === 'units' && (
          <p className="mt-3 text-[11px] text-muted-foreground">Shopee doesn’t report units in its sales export, so it’s omitted here.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── combined KPIs (for selected channels) ────────────────────────────────────────
function CombinedKpis({metrics, channels}: {metrics: Record<Channel, ChannelMetrics | null>; channels: Channel[]}) {
  const sum = (m: Metric) => channels.reduce((a, c) => a + (metrics[c]?.[m] ?? 0), 0);
  const revenue = sum('revenue');
  const orders = sum('orders');
  const aov = orders ? revenue / orders : 0;
  const tiles = [
    {label: 'Total revenue', value: money(revenue)},
    {label: 'Total orders', value: orders.toLocaleString()},
    {label: 'Blended AOV', value: money(aov)},
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <Card key={t.label}>
          <CardContent className="p-4">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{t.label}</div>
            <div className="text-[24px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{t.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── merged, channel-tagged recommendations (left column) ─────────────────────────
function collectRecs(row: DigestArchiveRow, channels: Channel[]): {channel: Channel; rec: DigestRec}[] {
  const d = row.digest;
  const out: {channel: Channel; rec: DigestRec}[] = [];
  const add = (channel: Channel, recs?: DigestRec[]) => (recs ?? []).forEach((rec) => out.push({channel, rec}));
  if (channels.includes('shopee')) for (const f of ['sales', 'ads', 'traffic', 'products'] as const) add('shopee', d.shopee?.[f]?.recommendations);
  if (channels.includes('lazada')) for (const f of ['sales', 'finance', 'inventory'] as const) add('lazada', d.lazada?.[f]?.recommendations);
  if (channels.includes('website')) {
    add('website', d.sales?.recommendations);
    add('website', d.customers?.recommendations);
    add('website', d.recommendations);
  }
  return out;
}

function MergedActions({items}: {items: {channel: Channel; rec: DigestRec}[]}) {
  const {open} = usePlaybook();
  if (!items.length) return null;
  return (
    <div className="space-y-2.5">
      {items.map(({channel, rec}, i) => {
        const meta = CH[channel];
        const Icon = meta.icon;
        const action = recAction(rec);
        const steps = recSteps(rec);
        const clickable = steps.length > 0;
        const body = (
          <CardContent className="p-4">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Icon className="size-3" style={{color: meta.accent}} /> {meta.label}
            </div>
            <p className="text-[14.5px] leading-relaxed text-foreground/90">{action}</p>
            {clickable && (
              <div className="mt-2 text-[11px] font-medium text-primary">{steps.length} steps →</div>
            )}
          </CardContent>
        );
        return clickable ? (
          <Card key={i} className="cursor-pointer transition-colors hover:border-primary/40">
            <button type="button" onClick={() => open({action, steps})} className="block w-full text-left">
              {body}
            </button>
          </Card>
        ) : (
          <Card key={i}>{body}</Card>
        );
      })}
    </div>
  );
}

// ── single-channel drill-down detail ─────────────────────────────────────────────
function ChannelDetail({channel, row}: {channel: Channel; row: DigestArchiveRow}) {
  if (channel === 'shopee') return <ShopeeSection row={row} />;
  if (channel === 'lazada') return <LazadaSection row={row} />;
  return (
    <>
      <SalesSection row={row} />
      <CustomersSection row={row} />
      <ConversationsSection row={row} />
    </>
  );
}

// ── the unified overview ─────────────────────────────────────────────────────────
export function ChannelOverview({row, initialChannels}: {brief: AnalystBrief; row: DigestArchiveRow; initialChannels: Channel[]}) {
  const [selected, setSelected] = useState<Channel[]>(initialChannels.length ? initialChannels : ['shopee', 'lazada', 'website']);
  const metrics = useMemo(() => channelMetrics(row), [row]);
  const recs = useMemo(() => collectRecs(row, selected), [row, selected]);
  const backHref = row.window_from ? `/?week=${encodeURIComponent(row.window_from)}` : '/';

  if (row.digest.degraded) {
    return <div className="mx-auto max-w-6xl px-6 py-8 md:px-10 text-muted-foreground">No data for this window — check the batch job.</div>;
  }

  const toggle = (c: Channel) =>
    setSelected((prev) => {
      const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
      return next.length ? next : prev; // never empty
    });

  const single = selected.length === 1 ? selected[0] : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">
      <Link href={backHref} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Today
      </Link>
      <VerdictHero row={row} />

      {/* channel filter */}
      <div className="mb-6">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Channels</div>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => {
            const on = selected.includes(c.key);
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                aria-pressed={on}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all',
                  on ? 'border-primary/60 bg-primary/[0.06] text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" style={{color: on ? c.accent : undefined}} />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* left: merged recommendations */}
        <div className="lg:col-span-1">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Recommended actions
          </div>
          <MergedActions items={recs} />
        </div>

        {/* right: KPIs + comparison (or single-channel note) */}
        <div className="space-y-5 lg:col-span-2">
          <CombinedKpis metrics={metrics} channels={selected} />
          {selected.length >= 2 ? (
            <ComparisonChart metrics={metrics} channels={selected} />
          ) : (
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
              <Sparkles className="size-3" /> Showing {CH[single!].label} detail below
            </Badge>
          )}
        </div>
      </div>

      {/* single-channel drill-down */}
      {single && (
        <div className="mt-10 border-t border-border pt-8">
          <ChannelDetail channel={single} row={row} />
        </div>
      )}
    </div>
  );
}
