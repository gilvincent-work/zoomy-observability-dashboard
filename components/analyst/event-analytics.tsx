'use client';

import {useMemo} from 'react';
import {Area, AreaChart, CartesianGrid, XAxis, YAxis} from 'recharts';
import type {PetMix, PosEvent, PosOrder} from '@/src/pos-sales-types';
import {computeKpis, eventRevenueSeries, paymentBreakdown, petMix, topProducts} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodColor, paymentMethodLabel} from '@/src/pos-format';
import {ChartContainer, ChartTooltip, type ChartConfig} from '@/components/ui/chart';

const PET_SEGMENTS: {key: keyof PetMix; label: string; color: string}[] = [
  {key: 'dog', label: 'Dog', color: '#3b82f6'},
  {key: 'cat', label: 'Cat', color: '#a855f7'},
  {key: 'both', label: 'Both', color: '#22c55e'},
  {key: 'untagged', label: 'Untagged', color: '#a1a1aa'},
];

const chartConfig = {revenue: {label: 'Revenue', color: 'var(--status-good)'}} satisfies ChartConfig;

/** Format an order instant for the trend axis. Multi-day events get the day too. */
function pointLabel(iso: string, multiDay: boolean): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, multiDay ? {month: 'short', day: 'numeric', hour: 'numeric'} : {hour: 'numeric', minute: '2-digit'});
}

/** Compact peso for Y-axis ticks: ₱1.6k, ₱300. */
function pesoTick(v: number): string {
  return v >= 1000 ? `₱${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `₱${v}`;
}

const axisLabelStyle = {fontSize: 10, fill: 'var(--muted-foreground)'} as const;

/**
 * The per-event analytics panel: headline KPIs, a cumulative-revenue trend line,
 * a payment split, the pet mix, and top sellers. Pure-helper driven, all scoped
 * to this event's orders (its full lifetime, unfiltered by the home range tabs).
 */
export function EventAnalytics({event, orders}: {event: PosEvent; orders: PosOrder[]}) {
  const kpis = useMemo(() => computeKpis(orders), [orders]);
  const pay = useMemo(() => paymentBreakdown(orders), [orders]);
  const pets = useMemo(() => petMix(orders), [orders]);
  const tops = useMemo(() => topProducts(orders, 5), [orders]);
  const multiDay = Boolean(event.starts_on && event.ends_on && event.starts_on !== event.ends_on);
  const series = useMemo(
    () => eventRevenueSeries(orders).map((p) => ({label: pointLabel(p.t, multiDay), revenue: p.revenue})),
    [orders, multiDay],
  );

  if (kpis.orders === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
        No sales tagged to this event yet.
      </div>
    );
  }

  const avgBasket = kpis.revenue / kpis.orders;
  const payTotal = pay.reduce((s, p) => s + p.revenue, 0) || 1;
  const petTotal = (pets.dog.revenue + pets.cat.revenue + pets.both.revenue + pets.untagged.revenue) || 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Revenue" value={formatPeso(kpis.revenue)} />
        <Stat label="Orders" value={String(kpis.orders)} />
        <Stat label="Units" value={String(kpis.units)} />
        <Stat label="Avg basket" value={formatPeso(avgBasket)} />
      </div>

      {/* Cumulative revenue trend */}
      {series.length >= 2 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue over time</div>
          <ChartContainer config={chartConfig} className="h-[190px] w-full">
            <AreaChart data={series} margin={{left: 10, right: 12, top: 8, bottom: 20}}>
              <defs>
                <linearGradient id="eventRevFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={10}
                minTickGap={44}
                label={{value: 'Order time', position: 'insideBottom', offset: -12, style: {...axisLabelStyle, textAnchor: 'middle'}}}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                fontSize={10}
                domain={[0, 'dataMax']}
                tickFormatter={(v) => pesoTick(Number(v))}
                label={{value: 'Cumulative revenue', angle: -90, position: 'insideLeft', offset: 2, style: {...axisLabelStyle, textAnchor: 'middle'}}}
              />
              <ChartTooltip
                cursor={{stroke: 'var(--color-revenue)', strokeOpacity: 0.3}}
                content={({active, payload, label}) =>
                  active && payload?.length ? (
                    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="font-medium tabular-nums">{formatPeso(Number(payload[0].value))} total</div>
                    </div>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="var(--color-revenue)"
                strokeWidth={2}
                fill="url(#eventRevFill)"
                dot={false}
                activeDot={{r: 3.5}}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Payment split */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment split</div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {pay.map((p) => (
              <div key={p.method} style={{width: `${(p.revenue / payTotal) * 100}%`, backgroundColor: paymentMethodColor(p.method)}} />
            ))}
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {pay.map((p) => (
              <li key={p.method} className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-[3px]" style={{backgroundColor: paymentMethodColor(p.method)}} />
                <span className="text-muted-foreground">{paymentMethodLabel(p.method)}</span>
                <span className="ml-auto tabular-nums">{formatPeso(p.revenue)}</span>
                <span className="w-14 text-right tabular-nums text-muted-foreground">
                  {p.orders} {p.orders === 1 ? 'order' : 'orders'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pet mix */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pet mix</div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {PET_SEGMENTS.map((s) => {
              const rev = pets[s.key].revenue;
              return rev > 0 ? <div key={s.key} style={{width: `${(rev / petTotal) * 100}%`, backgroundColor: s.color}} /> : null;
            })}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {PET_SEGMENTS.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-[3px]" style={{backgroundColor: s.color}} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto tabular-nums">{formatPeso(pets[s.key].revenue)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Top sellers */}
      {tops.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top sellers</div>
          <ol className="flex flex-col gap-1">
            {tops.map((t, i) => (
              <li key={t.product_id ?? `${t.name}-${i}`} className="flex items-center gap-2.5 text-sm">
                <span className="w-4 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{t.units} {t.units === 1 ? 'unit' : 'units'}</span>
                <span className="w-20 text-right font-medium tabular-nums">{formatPeso(t.revenue)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-serif text-lg font-normal tabular-nums">{value}</div>
    </div>
  );
}
