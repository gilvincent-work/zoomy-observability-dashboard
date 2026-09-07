'use client';

import Link from 'next/link';
import {ArrowLeftRight, Receipt, TriangleAlert} from 'lucide-react';
import {Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis} from 'recharts';
import type {DailySales, PosOrder, PosSyncEntry, SalesKpis, SalesRange, TopProduct} from '@/src/pos-sales-types';
import {SALES_RANGES} from '@/src/pos-sales-compute';
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
  usingMock: boolean;
};

const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const timeLabel = (iso: string) => new Date(iso).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineSalesView({range, kpis, daily, top, orders, sync, usingMock}: Props) {
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
          Mock sales — set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
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
        <Panel title="Recent orders">
          {orders.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <ul className="flex flex-col divide-y">
              {orders.slice(0, 12).map((o) => (
                <li key={o.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
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
                      {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ') || '—'}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums">{formatPeso(o.total)}</span>
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

function Panel({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <Card>
      <CardContent className="py-4">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
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
