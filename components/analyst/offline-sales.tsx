'use client';

import Link from 'next/link';
import {ArrowLeftRight, CalendarClock, PackageX, Receipt, TriangleAlert} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from 'recharts';
import type {DailySales, PosOrder, PosSyncEntry, SalesKpis, SalesRange, TopProduct} from '@/src/pos-sales-types';
import type {StockAlerts} from '@/src/pos-sales-compute';
import {SALES_RANGES} from '@/src/pos-sales-compute';
import type {PosProductRow} from '@/src/pos-types';
import {formatPeso} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';
import {Eyebrow, MockNote} from './sections';

type Props = {
  range: SalesRange;
  kpis: SalesKpis;
  daily: DailySales[];
  top: TopProduct[];
  orders: PosOrder[]; // filtered, newest first
  sync: PosSyncEntry[];
  alerts: StockAlerts;
  usingMock: boolean;
};

const expiryLabel = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : 'no date';

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const timeLabel = (iso: string) => new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineSalesView({range, kpis, daily, top, orders, sync, alerts, usingMock}: Props) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow icon={Receipt}>Offline Sales</Eyebrow>
          <p className="text-sm text-muted-foreground">Bazaar sales synced from the POS.</p>
        </div>
        <RangeTabs active={range} />
      </div>

      {usingMock && (
        <MockNote>
          Mock sales. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
          Staging project to load real <code>pos_orders</code>.
        </MockNote>
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

        <Panel title="Top products">
          {top.length === 0 ? (
            <Empty>No sales in this range.</Empty>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {top.map((t, i) => (
                <li key={t.product_id} className="flex items-center gap-3">
                  <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.units} units</span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{formatPeso(t.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Recent orders" action={{label: 'View all', href: '/offline-sales/orders'}}>
          {orders.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {orders.slice(0, 12).map((o) => (
                <li key={o.id}>
                  <Link
                    href="/offline-sales/orders"
                    className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{timeLabel(o.created_at)}</span>
                        {o.oversold && (
                          <Badge variant="destructive">
                            <TriangleAlert /> oversold
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ') || 'No items'}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{formatPeso(o.total)}</span>
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
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={cn('text-2xl font-semibold tabular-nums', warn && 'text-destructive')}>{value}</span>
      </CardContent>
    </Card>
  );
}

function Panel({title, action, children}: {title: string; action?: {label: string; href: string}; children: React.ReactNode}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
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
