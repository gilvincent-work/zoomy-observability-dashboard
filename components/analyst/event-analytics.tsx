'use client';

import {useMemo, useState, type ReactNode} from 'react';
import {Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis} from 'recharts';
import type {PetMix, PosEvent, PosOrder} from '@/src/pos-sales-types';
import {computeKpis, datesInRange, eventDayPacingSeries, eventRevenueSeries, manilaDayKey, paymentBreakdown, petMix, topProducts, type DayPacingSeries} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodColor, paymentMethodLabel} from '@/src/pos-format';
import {cn} from '@/lib/utils';
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

/** "2026-09-15" → "Sep 15" for the day toggle. */
function dayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/** Minutes since Manila midnight → "10 AM", "1:30 PM" for the compare x-axis. */
function todLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, {
    hour: 'numeric',
    timeZone: 'UTC',
    ...(m ? {minute: '2-digit'} : {}),
  });
}

/**
 * Stroke for a day's pacing line. The latest day (last, usually the live one)
 * gets the solid ochre accent so "today vs history" reads at a glance; earlier
 * days recede into graduated warm gray, oldest faintest.
 */
function dayLineStyle(index: number, total: number): {stroke: string; width: number; opacity: number} {
  if (index === total - 1) return {stroke: 'var(--chart-4)', width: 2.5, opacity: 1};
  const pastCount = total - 1;
  const t = pastCount <= 1 ? 1 : index / (pastCount - 1); // 0 = oldest … 1 = most recent past
  return {stroke: 'var(--muted-foreground)', width: 1.75, opacity: 0.42 + t * 0.3};
}

/**
 * The per-event analytics panel: headline KPIs, a cumulative-revenue trend line,
 * a payment split, the pet mix, and top sellers. Pure-helper driven, all scoped
 * to this event's orders (its full lifetime, unfiltered by the home range tabs).
 */
export function EventAnalytics({event, orders}: {event: PosEvent; orders: PosOrder[]}) {
  // The event's own days; a toggle scopes every metric to one of them (or all).
  const days = useMemo(() => datesInRange(event.starts_on, event.ends_on), [event.starts_on, event.ends_on]);
  const multiDay = days.length > 1;
  const [day, setDay] = useState<string | null>(null); // null = all days
  const [compare, setCompare] = useState(false); // "compare days" overlay (all-days only)

  // Per-day cumulative pacing (all event orders, aligned by time of day). Only
  // meaningful once two or more days have sales to lay against each other.
  const pacing = useMemo(() => eventDayPacingSeries(orders), [orders]);
  const canCompare = multiDay && pacing.days.length >= 2;
  const showCompare = compare && day === null && canCompare;

  // Everything below reflects the selected day (or the whole event when 'all').
  const scoped = useMemo(
    () => (day ? orders.filter((o) => manilaDayKey(o.created_at) === day) : orders),
    [orders, day],
  );

  const kpis = useMemo(() => computeKpis(scoped), [scoped]);
  const pay = useMemo(() => paymentBreakdown(scoped), [scoped]);
  const pets = useMemo(() => petMix(scoped), [scoped]);
  const tops = useMemo(() => topProducts(scoped, 5), [scoped]);
  // When one day is selected the x-axis is intra-day (time only); across all
  // days of a multi-day event it also carries the date.
  const labelWithDay = !day && multiDay;
  const series = useMemo(
    () => eventRevenueSeries(scoped).map((p) => ({label: pointLabel(p.t, labelWithDay), revenue: p.revenue})),
    [scoped, labelWithDay],
  );

  const avgBasket = kpis.orders ? kpis.revenue / kpis.orders : 0;
  const payTotal = pay.reduce((s, p) => s + p.revenue, 0) || 1;
  const petTotal = (pets.dog.revenue + pets.cat.revenue + pets.both.revenue + pets.untagged.revenue) || 1;

  return (
    <div className="flex flex-col gap-6">
      {multiDay && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Day</span>
          <DayPill active={day === null} onClick={() => setDay(null)}>All days</DayPill>
          {days.map((d) => (
            <DayPill key={d} active={day === d} onClick={() => setDay(d)}>{dayShort(d)}</DayPill>
          ))}
        </div>
      )}

      {kpis.orders === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          {day ? `No sales on ${dayShort(day)}.` : 'No sales tagged to this event yet.'}
        </div>
      ) : (
        <AnalyticsBody
          kpis={kpis}
          avgBasket={avgBasket}
          series={series}
          pacing={pacing}
          showCompare={showCompare}
          canCompare={day === null && canCompare}
          compare={compare}
          onCompareChange={setCompare}
          pay={pay}
          payTotal={payTotal}
          pets={pets}
          petTotal={petTotal}
          tops={tops}
        />
      )}
    </div>
  );
}

function DayPill({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'border-transparent bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** "Combined | Compare days" segmented switch for the multi-day revenue chart. */
function CompareToggle({compare, onChange}: {compare: boolean; onChange: (v: boolean) => void}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      <ToggleBtn active={!compare} onClick={() => onChange(false)}>Combined</ToggleBtn>
      <ToggleBtn active={compare} onClick={() => onChange(true)}>Compare days</ToggleBtn>
    </div>
  );
}

function ToggleBtn({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-[5px] px-2.5 py-1 font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Per-day cumulative revenue overlaid on one time-of-day axis: each day resets to
 * ₱0 and climbs, so the latest day's pace reads directly against earlier days at
 * the same clock time. Latest day in the ochre accent, earlier days in muted gray.
 */
function DayPacingChart({pacing}: {pacing: DayPacingSeries}) {
  const {days, rows} = pacing;
  const n = days.length;
  const config: ChartConfig = Object.fromEntries(
    days.map((d, i) => [d, {label: dayShort(d), color: dayLineStyle(i, n).stroke}]),
  );

  // Lines are drawn from each day's own (sparse) points, but the tooltip must
  // report EVERY day's running total at the hovered time, not just the day that
  // happens to own that x-point. Step lookup: each day's cumulative as of the
  // last order at or before a given time (null before the day's first sale).
  const steps = useMemo(() => {
    const m = new Map<string, {tod: number; val: number}[]>();
    for (const d of days) m.set(d, []);
    for (const row of rows) {
      for (const d of days) {
        const v = row[d];
        if (v != null) m.get(d)!.push({tod: row.tod, val: v});
      }
    }
    return m;
  }, [days, rows]);

  const valueAt = (day: string, tod: number): number | null => {
    const pts = steps.get(day);
    if (!pts?.length) return null;
    let val: number | null = null;
    for (const p of pts) {
      if (p.tod <= tod) val = p.val;
      else break;
    }
    return val;
  };

  return (
    <>
      <ChartContainer config={config} className="h-[210px] w-full">
        <LineChart data={rows} margin={{left: 10, right: 12, top: 8, bottom: 20}}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
          <XAxis
            dataKey="tod"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={10}
            minTickGap={44}
            tickFormatter={(v) => todLabel(Number(v))}
            label={{value: 'Time of day', position: 'insideBottom', offset: -12, style: {...axisLabelStyle, textAnchor: 'middle'}}}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            fontSize={10}
            domain={[0, 'dataMax']}
            tickFormatter={(v) => pesoTick(Number(v))}
            label={{value: 'Revenue that day', angle: -90, position: 'insideLeft', offset: 2, style: {...axisLabelStyle, textAnchor: 'middle'}}}
          />
          <ChartTooltip
            cursor={{stroke: 'var(--muted-foreground)', strokeOpacity: 0.3}}
            content={({active, label}) => {
              if (!active || label == null) return null;
              const tod = Number(label);
              const entries = days
                .map((d, i) => ({day: d, style: dayLineStyle(i, n), latest: i === n - 1, val: valueAt(d, tod)}))
                .filter((e) => e.val != null);
              if (!entries.length) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="mb-1 text-muted-foreground">{todLabel(tod)}</div>
                  <div className="flex flex-col gap-1">
                    {entries.map((e) => (
                      <div key={e.day} className="flex items-center gap-2 tabular-nums">
                        <span className="size-2 rounded-[3px]" style={{backgroundColor: e.style.stroke, opacity: e.style.opacity}} />
                        <span className={cn(e.latest ? 'text-foreground' : 'text-muted-foreground')}>{dayShort(e.day)}</span>
                        <span className="ml-auto font-medium">{formatPeso(Number(e.val))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }}
          />
          {days.map((d, i) => {
            const s = dayLineStyle(i, n);
            return (
              <Line
                key={d}
                type="monotone"
                dataKey={d}
                stroke={s.stroke}
                strokeWidth={s.width}
                strokeOpacity={s.opacity}
                dot={false}
                activeDot={{r: 3.5}}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ChartContainer>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {days.map((d, i) => {
          const s = dayLineStyle(i, n);
          const latest = i === n - 1;
          return (
            <li key={d} className="flex items-center gap-1.5 text-xs">
              <span className="inline-block h-0.5 w-4 rounded-full" style={{backgroundColor: s.stroke, opacity: s.opacity}} />
              <span className={cn('tabular-nums', latest ? 'font-medium text-foreground' : 'text-muted-foreground')}>{dayShort(d)}</span>
              {latest && <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--chart-4)]">latest</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

type AnalyticsBodyProps = {
  kpis: {revenue: number; orders: number; units: number; oversells: number};
  avgBasket: number;
  series: {label: string; revenue: number}[];
  pacing: DayPacingSeries;
  showCompare: boolean;
  canCompare: boolean;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  pay: {method: string; revenue: number; orders: number}[];
  payTotal: number;
  pets: PetMix;
  petTotal: number;
  tops: {product_id: string; name: string; revenue: number; units: number}[];
};

function AnalyticsBody({kpis, avgBasket, series, pacing, showCompare, canCompare, compare, onCompareChange, pay, payTotal, pets, petTotal, tops}: AnalyticsBodyProps) {
  return (
    <div className="flex flex-col gap-7">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={formatPeso(kpis.revenue)} />
        <Stat label="Orders" value={String(kpis.orders)} />
        <Stat label="Units" value={String(kpis.units)} />
        <Stat label="Avg basket" value={formatPeso(avgBasket)} />
      </div>

      {/* Cumulative revenue trend */}
      {series.length >= 2 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue over time</span>
            {canCompare && <CompareToggle compare={compare} onChange={onCompareChange} />}
          </div>
          {showCompare ? (
            <DayPacingChart pacing={pacing} />
          ) : (
          <ChartContainer config={chartConfig} className="h-[210px] w-full">
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
          )}
        </div>
      )}

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        {/* Payment split */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment split</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {pay.map((p) => (
              <div key={p.method} style={{width: `${(p.revenue / payTotal) * 100}%`, backgroundColor: paymentMethodColor(p.method)}} />
            ))}
          </div>
          <ul className="mt-3.5 flex flex-col gap-2.5">
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
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pet mix</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {PET_SEGMENTS.map((s) => {
              const rev = pets[s.key].revenue;
              return rev > 0 ? <div key={s.key} style={{width: `${(rev / petTotal) * 100}%`, backgroundColor: s.color}} /> : null;
            })}
          </div>
          <ul className="mt-3.5 grid grid-cols-2 gap-x-8 gap-y-2.5">
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
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top sellers</div>
          <ol className="flex flex-col gap-2.5">
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
    <div className="rounded-lg border bg-background/60 px-4 py-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-xl font-normal tabular-nums">{value}</div>
    </div>
  );
}
