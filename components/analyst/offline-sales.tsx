'use client';

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowLeftRight, CalendarClock, CalendarDays, ChevronDown, ChevronRight, PackageX, Receipt, TriangleAlert} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from 'recharts';
import type {BundleSalesSummary, DayMethodRevenue, FeaturedEvent, PetMix, PosOrder, PosSyncEntry, SalesKpis, SalesRange, TopBundle, TopProduct} from '@/src/pos-sales-types';
import type {DailyProgress} from '@/src/pos-target-types';
import type {PaymentMethodOption, StockAlerts} from '@/src/pos-sales-compute';
import {SALES_RANGES, computeKpis, orderMethod, paymentMethodOptions, petMix, presentMethods, salesByDayAndMethod} from '@/src/pos-sales-compute';
import type {PosProductRow} from '@/src/pos-types';
import {formatPeso, paymentMethodColor, paymentMethodLabel} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {ChartContainer, ChartTooltip, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';
import {Eyebrow, MockNote} from './sections';
import {Metric} from './metric';
import {RefreshControl} from './refresh-control';
import {DailyTargetBar} from './daily-target-bar';
import {InfoTip} from './info-tip';

type Props = {
  range: SalesRange;
  progress: DailyProgress | null; // today vs daily goal; null = hidden (fail-soft)
  featured: FeaturedEvent | null; // event running today, else next upcoming, else null
  kpis: SalesKpis; // all-methods totals for the range
  top: TopProduct[]; // ranked by revenue
  topByUnits: TopProduct[]; // same products ranked by units sold
  topBundles: TopBundle[]; // bundles sold by name (from bundle_id lines)
  bundles: BundleSalesSummary; // reconciles itemized product revenue with the KPI
  orders: PosOrder[]; // filtered, newest first
  sync: PosSyncEntry[];
  alerts: StockAlerts;
  usingMock: boolean;
  fetchedAt: string; // ISO; when the server loaded this data
};

const expiryLabel = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'no date';

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const timeLabel = (iso: string) => new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineSalesView({range, progress, featured, kpis, top, topByUnits, topBundles, bundles, orders, sync, alerts, usingMock, fetchedAt}: Props) {
  // 'all' or a specific payment method. The method drives the KPI cards and
  // which segment of the stacked chart is highlighted. Computed client-side from
  // the range-filtered orders so switching is instant (no reload).
  const [method, setMethod] = useState<string>('all');
  const methods = useMemo(() => presentMethods(orders), [orders]);
  // Full method list for the filter: enabled (has sales) first, then the rest
  // greyed. The chart still uses `methods` (present only).
  const methodOptions = useMemo(() => paymentMethodOptions(orders), [orders]);
  const stackData = useMemo(() => salesByDayAndMethod(orders), [orders]);
  // The orders the KPI cards summarize: the range-filtered set, narrowed to the
  // selected method (or all). Pet mix reads from the exact same set so the split
  // reacts to the method toggle client-side, just like the KPIs above it.
  const shownOrders = useMemo(
    () => (method === 'all' ? orders : orders.filter((o) => orderMethod(o) === method)),
    [method, orders],
  );
  const shownKpis = useMemo(() => (method === 'all' ? kpis : computeKpis(shownOrders)), [method, kpis, shownOrders]);
  const mix = useMemo(() => petMix(shownOrders), [shownOrders]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow icon={Receipt}>Offline Sales</Eyebrow>
          <p className="text-sm text-muted-foreground">Bazaar sales synced from the POS.</p>
          <div className="mt-2.5">
            <PaymentMethodSelect value={method} options={methodOptions} onChange={setMethod} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RefreshControl fetchedAt={fetchedAt} />
          <RangeTabs active={range} />
        </div>
      </div>

      {usingMock && (
        <div className="mb-6">
          <MockNote>
            Mock sales. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
            Staging project to load real <code>pos_orders</code>.
          </MockNote>
        </div>
      )}

      {/* Event (left) + daily goal (right); the event card stretches to match. */}
      {progress ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <EventStatusCard featured={featured} />
          <DailyTargetBar progress={progress} variant="full" />
        </div>
      ) : (
        <div className="mb-6">
          <EventStatusCard featured={featured} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Revenue" value={formatPeso(shownKpis.revenue)} />
        <Kpi label="Orders" value={String(shownKpis.orders)} />
        <Kpi label="Units" value={String(shownKpis.units)} />
        <Kpi label="Oversells" value={String(shownKpis.oversells)} warn={shownKpis.oversells > 0} />
      </div>

      <div className="mb-6">
        <PetMixCard mix={mix} />
      </div>

      <div className="grid gap-5 md:grid-cols-2 md:items-start">
        <Panel title="Sales over time">
          {stackData.length === 0 ? (
            <Empty>No sales in this range.</Empty>
          ) : (
            <MethodStackChart data={stackData} methods={methods} selected={method} />
          )}
        </Panel>

        <TopSellersColumn byRevenue={top} byUnits={topByUnits} bundles={bundles} topBundles={topBundles} />
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2 md:items-start">
        <Panel title="Recent orders" action={{label: 'View all', href: '/offline-sales/orders'}}>
          {orders.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {orders.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <Link
                    href="/offline-sales/orders"
                    className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('text-sm', o.status === 'voided' && 'line-through')}>{timeLabel(o.created_at)}</span>
                        {o.status === 'voided' && <Badge variant="destructive">voided</Badge>}
                        {o.oversold && (
                          <Badge variant="destructive">
                            <TriangleAlert /> oversold
                          </Badge>
                        )}
                      </div>
                      <p className={cn('truncate text-xs text-muted-foreground', o.status === 'voided' && 'line-through')}>
                        {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ') || 'No items'}
                      </p>
                    </div>
                    <span className={cn('text-sm font-medium tabular-nums', o.status === 'voided' && 'text-muted-foreground line-through')}>{formatPeso(o.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recently synced">
          {sync.length === 0 ? (
            <Empty>Nothing synced yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {sync.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <ArrowLeftRight className="size-3.5 text-muted-foreground" />
                  <span className="capitalize">{s.direction}</span>
                  <span className="text-muted-foreground">{s.entity}</span>
                  {typeof s.summary?.count === 'number' && (
                    <span className="text-xs text-muted-foreground">· {s.summary.count}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{timeLabel(s.synced_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <StockAlertsCard alerts={alerts} />
      </div>
    </div>
  );
}

function StockAlertsCard({alerts}: {alerts: StockAlerts}) {
  const nothing = alerts.out.length === 0 && alerts.low.length === 0 && alerts.nearExpiry.length === 0;
  return (
    <Panel title="Stock alerts">
      {nothing ? (
        <Empty>All good. Nothing low, out, or near expiry.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <AlertColumn
            icon={<PackageX className="size-3.5" />}
            title="Out of stock"
            rows={alerts.out.map((p) => ({key: p.product_id, name: p.name, note: `${p.stock}`}))}
            tone="destructive"
          />
          <AlertColumn
            icon={<TriangleAlert className="size-3.5" />}
            title="Low stock"
            rows={alerts.low.map((p) => ({key: p.product_id, name: p.name, note: `${p.stock} left`}))}
            tone="warn"
          />
          <AlertColumn
            icon={<CalendarClock className="size-3.5" />}
            title="Near expiry"
            rows={alerts.nearExpiry.map((p) => ({key: p.product_id, name: p.name, note: expiryLabel(p.next_expiry)}))}
            tone="warn"
          />
        </div>
      )}
    </Panel>
  );
}

function AlertColumn({
  icon,
  title,
  rows,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  rows: {key: string; name: string; note: string}[];
  tone: 'destructive' | 'warn';
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}>
        {icon}
        {title}
        <span className="text-muted-foreground">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeTabs({active}: {active: SalesRange}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {SALES_RANGES.map((r) => (
        <Link
          key={r.value}
          href={`/offline-sales?range=${r.value}`}
          scroll={false}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            r.value === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}

function Kpi({label, value, warn}: {label: string; value: string; warn?: boolean}) {
  return <Metric label={label} value={value} valueClassName={warn ? 'text-destructive' : undefined} />;
}

/** A compact event date range: "Sep 16", "Sep 16 – 18", "Sep 30 – Oct 1". */
function eventDatesShort(startsOn: string | null, endsOn: string | null): string {
  if (!startsOn && !endsOn) return 'No dates set';
  if (!startsOn) return shortDay(endsOn as string);
  if (!endsOn || endsOn === startsOn) return shortDay(startsOn);
  return `${shortDay(startsOn)} – ${shortDay(endsOn)}`;
}

/** The event spotlight banner: the bazaar running today ("Happening now"), else
 *  the next upcoming one, else an empty prompt to schedule. The whole card links
 *  to the Events page (replacing the old plain "Events" button). */
function EventStatusCard({featured}: {featured: FeaturedEvent | null}) {
  const ev = featured?.event ?? null;
  const current = featured?.state === 'current';
  const place = ev ? [ev.venue, ev.city].filter(Boolean).join(', ') : '';
  const meta = ev ? [place, eventDatesShort(ev.starts_on, ev.ends_on)].filter(Boolean).join(' · ') : '';

  return (
    <Link
      href="/offline-sales/events"
      className="group flex h-full flex-col justify-between gap-5 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40"
    >
      {/* Top row: status icon (left) + the go-to-events affordance (right). */}
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            current ? 'text-[var(--status-good)]' : 'text-muted-foreground',
          )}
          style={current ? {backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'} : {backgroundColor: 'var(--muted)'}}
        >
          {ev ? <CalendarClock className="size-5" /> : <CalendarDays className="size-5" />}
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {ev ? 'All events' : 'Schedule'}
          <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>

      {/* Identity, anchored to the bottom so the tile fills its column height. */}
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
          {current && <span className="size-1.5 rounded-full bg-[var(--status-good)]" aria-hidden />}
          <span className={current ? 'text-[var(--status-good)]' : 'text-muted-foreground'}>
            {ev ? (current ? 'Happening now' : 'Next event') : 'Events'}
          </span>
        </div>
        <div className="truncate text-lg font-semibold tracking-tight">{ev ? ev.name || 'Untitled event' : 'No events scheduled'}</div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {ev ? meta : 'Schedule a bazaar so the POS can tag that day’s sales.'}
        </div>
      </div>
    </Link>
  );
}

// Pet-mix segments. Colors are deliberately distinct from the ochre page accent
// and from the payment-method hues: dog = blue, cat = purple, both = green,
// untagged = a muted neutral so it reads as "not yet categorized".
const PET_SEGMENTS: {key: keyof PetMix; label: string; color: string}[] = [
  {key: 'dog', label: 'Dog', color: '#3b82f6'}, // blue-500
  {key: 'cat', label: 'Cat', color: '#a855f7'}, // purple-500
  {key: 'both', label: 'Both', color: '#22c55e'}, // green-500
  {key: 'untagged', label: 'Untagged', color: '#a1a1aa'}, // zinc-400
];

/** Revenue + order split by tagged pet: a 4-segment bar over a per-segment
 *  legend. Widths are revenue-proportional; the legend always lists all four so
 *  a zero segment still reads. Empty (no orders) shows a friendly note. */
function PetMixCard({mix}: {mix: PetMix}) {
  const totalRevenue = PET_SEGMENTS.reduce((s, seg) => s + mix[seg.key].revenue, 0);
  const totalOrders = PET_SEGMENTS.reduce((s, seg) => s + mix[seg.key].orders, 0);

  return (
    <Panel
      title="Pet mix"
      info="Sales split by the pet each order was tagged for at the POS. Untagged sales were recorded without a pet type. Honors the range and payment-option filters above."
    >
      {totalOrders === 0 ? (
        <Empty>No sales in this range.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Revenue share by pet type">
            {PET_SEGMENTS.map((seg) => {
              const pct = totalRevenue > 0 ? (mix[seg.key].revenue / totalRevenue) * 100 : 0;
              if (pct <= 0) return null;
              return <div key={seg.key} style={{width: `${pct}%`, backgroundColor: seg.color}} />;
            })}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {PET_SEGMENTS.map((seg) => {
              const s = mix[seg.key];
              const pct = totalRevenue > 0 ? Math.round((s.revenue / totalRevenue) * 100) : 0;
              return (
                <div key={seg.key} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span className="size-2 rounded-[3px]" style={{backgroundColor: seg.color}} aria-hidden />
                    {seg.label}
                    {totalRevenue > 0 && <span className="tabular-nums text-muted-foreground/60">{pct}%</span>}
                  </span>
                  <span className="text-sm font-medium tabular-nums">{formatPeso(s.revenue)}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {s.orders} {s.orders === 1 ? 'order' : 'orders'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Right column of the overview: Top products stacked over Top bundles, both
 *  driven by one shared Revenue/Units toggle. In Units mode bundles rank by
 *  orders (their unit analog: one order == one bundle sold). */
function TopSellersColumn({
  byRevenue,
  byUnits,
  bundles,
  topBundles,
}: {
  byRevenue: TopProduct[];
  byUnits: TopProduct[];
  bundles: BundleSalesSummary;
  topBundles: TopBundle[];
}) {
  const [sort, setSort] = useState<'revenue' | 'units'>('revenue');
  const rows = sort === 'revenue' ? byRevenue : byUnits;
  const bundleRows =
    sort === 'revenue'
      ? topBundles
      : [...topBundles].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);

  const pill = (
    <div className="inline-flex rounded-md border p-0.5">
      {(['revenue', 'units'] as const).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setSort(key)}
          aria-pressed={sort === key}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            sort === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {key === 'revenue' ? 'Revenue' : 'Units'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Top products"
        info="Money shown is itemized sales only. Bundle deals are priced as a set, so their value is listed once under Bundle deals, not split per item."
        control={pill}
      >
        {rows.length === 0 && bundles.bundleRevenue <= 0 ? (
          <Empty>No sales in this range.</Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
            <ul className="flex flex-col gap-2.5">
              {rows.map((t, i) => (
                <li key={t.product_id} className="flex items-start gap-3">
                  <span className="w-4 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{t.name}</span>
                    {t.bundledUnits > 0 && (
                      <span className="text-[11px] text-muted-foreground">{t.bundledUnits} of these units were bundled</span>
                    )}
                  </span>
                  <span className={cn('pt-0.5 text-xs tabular-nums', sort === 'units' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {t.units} units
                  </span>
                  <span className={cn('w-20 pt-0.5 text-right text-sm tabular-nums', sort === 'revenue' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {formatPeso(t.revenue)}
                  </span>
                </li>
              ))}
            </ul>

            {bundles.bundleRevenue > 0 && (
              <>
                <div className="h-px w-full bg-border" />
                <div className="flex items-center gap-3">
                  <span className="w-4" />
                  <span className="min-w-0 flex-1 text-sm">
                    Bundle deals
                    <span className="ml-1.5 text-[11px] text-muted-foreground">priced as a set</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{bundles.bundleOrders} orders</span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{formatPeso(bundles.bundleRevenue)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Itemized {formatPeso(bundles.itemizedRevenue)} plus bundles {formatPeso(bundles.bundleRevenue)} is{' '}
                  {formatPeso(bundles.totalRevenue)}, matching Revenue above.
                </p>
              </>
            )}
          </div>
        )}
      </Panel>

      {topBundles.length > 0 && (
        <Panel
          title="Top bundles"
          info="Bundles sold as a set. Sales made offline, or before bundle tracking landed, are counted in the Bundle deals total on Top products but are not listed by name here."
        >
          <ul className="flex flex-col gap-2.5">
            {bundleRows.map((b, i) => (
              <li key={b.bundle_id} className="flex items-center gap-3">
                <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                <span className={cn('text-xs tabular-nums', sort === 'units' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {b.orders} {b.orders === 1 ? 'order' : 'orders'}
                </span>
                <span className={cn('w-20 text-right text-sm tabular-nums', sort === 'revenue' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {formatPeso(b.revenue)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Panel({title, info, action, control, children}: {title: string; info?: string; action?: {label: string; href: string}; control?: React.ReactNode; children: React.ReactNode}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1 text-sm font-semibold">
            {title}
            {info && <InfoTip text={info} />}
          </h3>
          {control}
          {action && (
            <Link href={action.href} className="text-xs font-medium text-primary hover:underline">
              {action.label}
            </Link>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Empty({children}: {children: React.ReactNode}) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

// Per-day revenue stacked by payment method. When a method is selected its
// segments keep full color and the rest go grey (still visible). Hovering a bar
// shows each payment option's amount for that day.
function MethodStackChart({data, methods, selected}: {data: DayMethodRevenue[]; methods: string[]; selected: string}) {
  const config = Object.fromEntries(methods.map((m) => [m, {label: paymentMethodLabel(m), color: paymentMethodColor(m)}])) as ChartConfig;
  const rows = data.map((d) => ({label: shortDay(d.day), ...Object.fromEntries(methods.map((m) => [m, d.byMethod[m] ?? 0]))}));
  const topMethod = methods[methods.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={config} className="h-[220px] w-full">
        <BarChart data={rows} margin={{left: 4, right: 8, top: 8, bottom: 0}}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => formatPeso(Number(v))} />
          <ChartTooltip cursor={{fill: 'var(--muted)', opacity: 0.35}} content={<MethodTooltip />} />
          {methods.map((m) => {
            const active = selected === 'all' || selected === m;
            return (
              <Bar
                key={m}
                dataKey={m}
                stackId="rev"
                fill={active ? paymentMethodColor(m) : '#52525b'}
                fillOpacity={active ? 1 : 0.35}
                radius={m === topMethod ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              />
            );
          })}
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {methods.map((m) => {
          const active = selected === 'all' || selected === m;
          return (
            <span key={m} className={cn('inline-flex items-center gap-1.5 text-[11px]', active ? 'text-muted-foreground' : 'text-muted-foreground/40')}>
              <span className="size-2 rounded-[3px]" style={{backgroundColor: active ? paymentMethodColor(m) : '#52525b'}} />
              {paymentMethodLabel(m)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

type TooltipRow = {dataKey?: string; value?: number};

/** Mini tooltip: each payment option's revenue for the hovered day. */
function MethodTooltip({active, payload, label}: {active?: boolean; payload?: TooltipRow[]; label?: string}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <ul className="flex min-w-[9rem] flex-col gap-0.5">
        {rows.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[3px]" style={{backgroundColor: paymentMethodColor(p.dataKey)}} />
            <span className="text-muted-foreground">{paymentMethodLabel(p.dataKey)}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">{formatPeso(Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Color-coded payment-method dropdown. Default "All payment options". */
function PaymentMethodSelect({value, options, onChange}: {value: string; options: PaymentMethodOption[]; onChange: (v: string) => void}) {
  const [open, setOpen] = useState(false);
  const currentLabel = value === 'all' ? 'All payment options' : paymentMethodLabel(value);
  // Index of the first greyed (no-sales) method, so a divider marks the split.
  const firstDisabled = options.findIndex((o) => !o.enabled);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
      >
        <MethodDot method={value} />
        {currentLabel}
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <ul
            role="listbox"
            className="absolute left-0 z-50 mt-1 min-w-[14rem] overflow-hidden rounded-lg border bg-background p-1 shadow-lg"
          >
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === 'all'}
                onClick={() => select('all')}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                  value === 'all' ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <MethodDot method="all" />
                All payment options
              </button>
            </li>
            {options.map((o, i) => {
              const label = paymentMethodLabel(o.method);
              if (!o.enabled) {
                return (
                  <li key={o.method}>
                    {i === firstDisabled && <div className="mx-1 my-1 border-t border-border/70" role="separator" />}
                    {/* No sales in range: shown for completeness, greyed + unclickable. */}
                    <div
                      aria-disabled="true"
                      className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground opacity-50"
                    >
                      <MethodDot method={o.method} />
                      {label}
                      <span className="ml-auto text-[10px] font-medium uppercase tracking-wide">No sales</span>
                    </div>
                  </li>
                );
              }
              return (
                <li key={o.method}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.method === value}
                    onClick={() => select(o.method)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                      o.method === value ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <MethodDot method={o.method} />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** The color swatch for a method; a muted ring for "all". */
function MethodDot({method}: {method: string}) {
  if (method === 'all') return <span className="size-2.5 rounded-full border border-muted-foreground/50" aria-hidden />;
  return <span className="size-2.5 rounded-full" style={{backgroundColor: paymentMethodColor(method)}} aria-hidden />;
}
