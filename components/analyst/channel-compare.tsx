'use client';

// Unified channel Overview — merges Shopee / Lazada / Website into one view with a
// channel filter, an apples-to-apples comparison chart, combined KPIs, and merged
// (channel-tagged) recommendations. Single-channel selection drills into that
// channel's full detail. Comparison numbers are read from each channel's existing
// figures (label-matched) — interim until the batch emits a normalized summary.
import {useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, Check, Globe, Search} from 'lucide-react';
import type {DigestArchiveRow, DigestFigure, DigestRec} from '../../src/types';
import type {AnalystBrief} from '../../src/salesSignals';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Sparkles} from 'lucide-react';
import {ShopeeIcon, LazadaIcon} from './brand-icons';
import {usePlaybook, usePlaybookProgress, recAction, recSteps} from './playbook';
import {fmtRange} from '../../src/week';
import {ShopeeSection, LazadaSection, SalesSection, CustomersSection, ConversationsSection} from './sections';

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
function ComparisonChart({metrics, channels, metric, setMetric}: {metrics: Record<Channel, ChannelMetrics | null>; channels: Channel[]; metric: Metric; setMetric: (m: Metric) => void}) {
  const rows = channels
    .map((c) => ({c, value: metrics[c]?.[metric] ?? null}))
    .filter((r): r is {c: Channel; value: number} => r.value != null);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">Compare channels</div>
          <div className="relative grid grid-cols-4 rounded-xl border border-border bg-muted/40 p-1">
            {/* liquid-glass sliding indicator — springs to the active metric */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-primary shadow-sm"
              style={{
                width: 'calc((100% - 0.5rem) / 4)',
                transform: `translateX(${Math.max(0, METRICS.findIndex((m) => m.key === metric)) * 100}%)`,
                transition: 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={cn(
                  'relative z-10 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors duration-300',
                  metric === m.key ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
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
          <>
          <div
            className="flex items-end justify-center gap-8 border-b border-border pt-1 sm:gap-12"
            style={{
              height: 168,
              // faint horizontal gridlines for a sense of scale
              backgroundImage:
                'repeating-linear-gradient(to top, transparent 0, transparent 41px, color-mix(in oklab, var(--border) 55%, transparent) 41px, color-mix(in oklab, var(--border) 55%, transparent) 42px)',
            }}
          >
            {rows.map(({c, value}) => {
              const meta = CH[c];
              return (
                <div key={c} className="flex flex-col items-center justify-end gap-1.5">
                  <div className="text-[15px] font-semibold tabular-nums text-foreground">{fmt(metric, value)}</div>
                  <div
                    className="w-20 rounded-t-xl shadow-sm transition-all sm:w-24 lg:w-28"
                    style={{
                      height: Math.max(6, (value / max) * 130),
                      backgroundImage: `linear-gradient(180deg, ${meta.accent} 0%, color-mix(in oklab, ${meta.accent} 72%, white) 100%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-center gap-8 pt-2.5 sm:gap-12">
            {rows.map(({c}) => {
              const meta = CH[c];
              const Icon = meta.icon;
              return (
                <div key={c} className="flex w-20 items-center justify-center gap-1.5 text-[13px] font-medium text-foreground sm:w-24 lg:w-28">
                  <Icon className="size-4" style={{color: meta.accent}} /> {meta.label}
                </div>
              );
            })}
          </div>
          </>
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
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3 sm:gap-x-9">
      {tiles.map((t, i) => (
        <div key={t.label} className={cn('flex flex-col', i > 0 && 'sm:border-l sm:border-border/70 sm:pl-7 md:pl-9')}>
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-foreground/80">{t.label}</span>
          <span className="font-serif text-[23px] font-normal leading-tight tracking-tight tabular-nums text-foreground">{t.value}</span>
        </div>
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

// Keywords that mark a recommendation as relevant to the metric currently on the
// chart — used to float the related actions to the top (regardless of channel).
const METRIC_KEYWORDS: Record<Metric, RegExp> = {
  revenue: /revenue|sales|gmv|turnover|top-?line|growth|traffic|visitor|acquisition|discover/i,
  orders: /order|conversion|convert|checkout|cart|placed|click-to-order|visit-to-placed|bounce|funnel|abandon/i,
  aov: /basket|sales-?per-?buyer|per buyer|aov|order value|bundle|voucher|upsell|cross-?sell|add-?on|minimum spend/i,
  units: /unit|stock|inventory|quantity|sku|restock|out of stock|sell-?through/i,
};

/** Stable-sort recs so those matching the active metric come first (channel-agnostic). */
function orderRecsByMetric(items: {channel: Channel; rec: DigestRec}[], metric: Metric): {channel: Channel; rec: DigestRec}[] {
  const re = METRIC_KEYWORDS[metric];
  return items
    .map((it, i) => ({it, i, hit: re.test(recAction(it.rec)) ? 0 : 1}))
    .sort((a, b) => a.hit - b.hit || a.i - b.i)
    .map((x) => x.it);
}

function MergedActionCard({channel, rec}: {channel: Channel; rec: DigestRec}) {
  const {open} = usePlaybook();
  const meta = CH[channel];
  const Icon = meta.icon;
  const action = recAction(rec);
  const steps = recSteps(rec);
  const clickable = steps.length > 0;
  const {done, complete} = usePlaybookProgress(action, steps.length);

  const badge = complete ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">
      <Check className="size-3" /> Done
    </span>
  ) : (
    <span className="shrink-0 text-[10.5px] font-medium text-primary">
      {done > 0 ? `${done}/${steps.length} done` : `${steps.length} steps`} →
    </span>
  );

  const body = (
    <CardContent className="px-3.5 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
          <Icon className="size-3" style={{color: meta.accent}} /> {meta.label}
        </span>
        {clickable && badge}
      </div>
      <p className="line-clamp-2 text-[13.5px] leading-snug text-foreground/90">{action}</p>
    </CardContent>
  );

  if (!clickable) return <Card className="h-full py-0">{body}</Card>;
  return (
    <Card className="h-full cursor-pointer py-0 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-primary">
      <button type="button" onClick={() => open({action, steps, label: meta.label})} className="block h-full w-full text-left">
        {body}
      </button>
    </Card>
  );
}

function MergedActions({items}: {items: {channel: Channel; rec: DigestRec}[]}) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {items.map(({channel, rec}, i) => (
        <MergedActionCard key={i} channel={channel} rec={rec} />
      ))}
    </div>
  );
}

// ── top products by revenue — one ranked list per channel, in a tabbed card ───────
type SkuRow = {title: string; revenue: number; units?: number};

/** Per-SKU ranking for a channel, or [] when that channel has no per-product data. */
function productsFor(row: DigestArchiveRow, c: Channel): SkuRow[] {
  const d = row.digest;
  const raw =
    c === 'shopee'
      ? d.shopee?.sales?.topProducts ?? d.shopee?.products?.topProducts
      : c === 'lazada'
        ? d.lazada?.sales?.topProducts
        : d.sales?.topProducts;
  return [...(raw ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
}

function TopProducts({row, channels}: {row: DigestArchiveRow; channels: Channel[]}) {
  const sources = channels.map((c) => ({channel: c, meta: CH[c], items: productsFor(row, c)})).filter((s) => s.items.length);
  const [tab, setTab] = useState<Channel | null>(null);
  if (!sources.length) return null;
  const active = sources.find((s) => s.channel === tab) ?? sources[0];
  const max = Math.max(1, ...active.items.map((p) => p.revenue));
  // channels selected but without any per-SKU feed yet (e.g. Shopee before its export)
  const missing = channels.filter((c) => !sources.some((s) => s.channel === c));

  return (
    <Card className="py-0">
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">Top products by revenue</div>
          {sources.length > 1 && (
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {sources.map((s) => {
                const on = s.channel === active.channel;
                const Icon = s.meta.icon;
                return (
                  <button
                    key={s.channel}
                    onClick={() => setTab(s.channel)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                      on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3.5" style={{color: on ? undefined : s.meta.accent}} /> {s.meta.label}
                  </button>
                );
              })}
            </div>
          )}
          {sources.length === 1 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              <active.meta.icon className="size-3" style={{color: active.meta.accent}} /> {active.meta.label}
            </span>
          )}
        </div>

        <ol className="space-y-4">
          {active.items.map((p, i) => (
            <li key={p.title} className="flex gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold tabular-nums text-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                {/* full title on its own line — wraps, never truncated */}
                <p className="mb-1.5 text-[13px] font-medium leading-snug text-foreground">{p.title}</p>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{width: `${(p.revenue / max) * 100}%`, backgroundColor: active.meta.accent}} />
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                    {money(p.revenue)}
                    {p.units ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">· {p.units.toLocaleString()} units</span> : null}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {missing.length > 0 && (
          <p className="mt-3.5 text-[11px] text-muted-foreground">
            No per-SKU feed yet for {missing.map((c) => CH[c].label).join(', ')}.
          </p>
        )}
      </CardContent>
    </Card>
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
  const [metric, setMetric] = useState<Metric>('revenue');
  const metrics = useMemo(() => channelMetrics(row), [row]);
  // Merged recs, reordered so those relevant to the metric on the chart come first.
  const recs = useMemo(() => orderRecsByMetric(collectRecs(row, selected), metric), [row, selected, metric]);
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
    <div className="w-full px-6 py-8 md:px-10 lg:px-12">
      {/* return link + Ask Coop hero search on one line to conserve space */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={backHref}
          aria-label="Back to Today"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <ArrowLeft className="size-5" />
        </Link>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card p-1.5 pl-4 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md"
        >
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          placeholder="Chat with Coop!"
          aria-label="Chat with Coop"
          className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-primary px-6 py-2 text-sm font-semibold tracking-wide text-primary-foreground transition-colors hover:bg-primary/90"
        >
          ASK
        </button>
        </form>
      </div>

      {/* header — date range · channel filter (center) · compact KPIs (right) */}
      <div className="mb-7 flex flex-wrap items-center gap-x-8 gap-y-4">
        <h1 className="font-serif text-[2.6rem] font-normal leading-[1.05] tracking-tight text-foreground">
          {fmtRange(row.window_from, row.window_to, row.digest.window.label)}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          {CHANNELS.map((c, i) => {
            const on = selected.includes(c.key);
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                aria-pressed={on}
                style={{animationDelay: `${1.7 + i * 0.18}s`}}
                className={cn(
                  'coop-chip-hint inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95',
                  on
                    ? 'border-primary bg-primary/[0.1] text-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground opacity-70 hover:opacity-100',
                )}
              >
                <Icon className="size-4" style={{color: on ? c.accent : undefined}} />
                {c.label}
                {on ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <span className="size-3.5 rounded-full border border-current opacity-40" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        <div className="ml-auto">
          <CombinedKpis metrics={metrics} channels={selected} />
        </div>
      </div>

      {single ? (
        /* single channel — full-width detail, no compact comparison layout */
        <ChannelDetail channel={single} row={row} />
      ) : (
        /* comparing 2+ channels — merged recs (2-col) beside the comparison chart */
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
            <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
              <Sparkles className="size-3.5 text-primary" /> Recommended actions
              <span className="font-medium normal-case tracking-normal text-muted-foreground/70">· {METRICS.find((m) => m.key === metric)?.label} first</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">{recs.length}</span>
            </div>
            {/* fills the column height and scrolls; px/py + matching -mx give the
                card borders, shadows and hover-lift room so overflow doesn't crop them */}
            <div className="lg:-mx-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-2 lg:py-1.5">
              <MergedActions items={recs} />
            </div>
          </section>

          <main className="min-w-0 space-y-6 lg:sticky lg:top-4 lg:self-start">
            <ComparisonChart metrics={metrics} channels={selected} metric={metric} setMetric={setMetric} />
            <TopProducts row={row} channels={selected} />
          </main>
        </div>
      )}
    </div>
  );
}
