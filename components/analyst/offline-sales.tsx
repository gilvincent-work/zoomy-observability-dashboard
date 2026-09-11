'use client';

import {useState} from 'react';
import Link from 'next/link';
import {ArrowLeftRight, CalendarClock, PackageX, Receipt, TriangleAlert} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from 'recharts';
import type {BundleSalesSummary, DailySales, PosOrder, PosSyncEntry, SalesKpis, SalesRange, TopBundle, TopProduct} from '@/src/pos-sales-types';
import type {DailyProgress} from '@/src/pos-target-types';
import type {StockAlerts} from '@/src/pos-sales-compute';
import {SALES_RANGES} from '@/src/pos-sales-compute';
import type {PosProductRow} from '@/src/pos-types';
import {formatPeso} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';
import {Eyebrow, MockNote} from './sections';
import {Metric} from './metric';
import {RefreshControl} from './refresh-control';
import {DailyTargetBar} from './daily-target-bar';
import {InfoTip} from './info-tip';

type Props = {
  range: SalesRange;
  progress: DailyProgress | null; // today vs daily goal; null = hidden (fail-soft)
  kpis: SalesKpis;
  daily: DailySales[];
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

export function OfflineSalesView({range, progress, kpis, daily, top, topByUnits, topBundles, bundles, orders, sync, alerts, usingMock, fetchedAt}: Props) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow icon={Receipt}>Offline Sales</Eyebrow>
          <p className="text-sm text-muted-foreground">Bazaar sales synced from the POS.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RefreshControl fetchedAt={fetchedAt} />
          <RangeTabs active={range} />
        </div>
      </div>

      {usingMock && (
        <MockNote>
          Mock sales. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
          Staging project to load real <code>pos_orders</code>.
        </MockNote>
      )}

      {progress && (
        <div className="mb-4">
          <DailyTargetBar progress={progress} variant="full" />
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Revenue" value={formatPeso(kpis.revenue)} />
        <Kpi label="Orders" value={String(kpis.orders)} />
        <Kpi label="Units" value={String(kpis.units)} />
        <Kpi label="Oversells" value={String(kpis.oversells)} warn={kpis.oversells > 0} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Sales over time">
          {daily.length === 0 ? (
            <Empty>No sales in this range.</Empty>
          ) : (
            <DailyChart data={daily} />
          )}
        </Panel>

        <TopProductsPanel byRevenue={top} byUnits={topByUnits} bundles={bundles} />
      </div>

      {topBundles.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Top bundles"
            info="Bundles sold as a set. Sales made offline, or before bundle tracking landed, are counted in the Bundle deals total on Top products but are not listed by name here."
          >
            <ul className="flex flex-col gap-2.5">
              {topBundles.map((b, i) => (
                <li key={b.bundle_id} className="flex items-center gap-3">
                  <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                  <span className="text-xs text-muted-foreground">{b.orders} {b.orders === 1 ? 'order' : 'orders'}</span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{formatPeso(b.revenue)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
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

      <div className="mt-4">
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

function TopProductsPanel({byRevenue, byUnits, bundles}: {byRevenue: TopProduct[]; byUnits: TopProduct[]; bundles: BundleSalesSummary}) {
  const [sort, setSort] = useState<'revenue' | 'units'>('revenue');
  const rows = sort === 'revenue' ? byRevenue : byUnits;

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

function DailyChart({data}: {data: DailySales[]}) {
  const config = {revenue: {label: 'Revenue', color: 'var(--chart-1)'}} satisfies ChartConfig;
  const rows = data.map((d) => ({label: shortDay(d.day), revenue: d.revenue}));
  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={rows} margin={{left: 4, right: 8, top: 8, bottom: 0}}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => formatPeso(Number(v))} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatPeso(Number(v))} />} />
        <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
