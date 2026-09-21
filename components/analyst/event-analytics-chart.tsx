'use client';

// Recharts for the event analytics "Revenue over time" chart, split out of
// event-analytics.tsx so it loads as an async chunk (see the next/dynamic wrapper
// there) instead of riding in the /offline-sales/events initial JS. Holds both the
// cumulative-revenue AreaChart and the multi-day pacing LineChart, plus the helpers
// only they use. (`dayShort` is duplicated here because the parent also uses it for
// non-chart UI and must not statically import from this Recharts module.)
import {Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis} from 'recharts';
import {formatPeso} from '@/src/pos-format';
import type {DayPacingSeries} from '@/src/pos-sales-compute';
import {ChartContainer, ChartTooltip, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';

const chartConfig = {revenue: {label: 'Revenue', color: 'var(--status-good)'}} satisfies ChartConfig;

/** Compact peso for Y-axis ticks: ₱1.6k, ₱300. */
function pesoTick(v: number): string {
  return v >= 1000 ? `₱${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `₱${v}`;
}

const axisLabelStyle = {fontSize: 10, fill: 'var(--muted-foreground)'} as const;

/** "2026-09-15" → "Sep 15". */
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

// Distinct per-day line colors so a multi-day event reads as more than "gold + gray".
const DAY_COLORS = ['#4E9A87', '#5E8BD0', '#A87FB0', '#6E9E80', '#7C93A6', '#C98A5A'];

/** Stroke for a day's pacing line; the latest day gets the solid ochre accent. */
function dayLineStyle(index: number, total: number): {stroke: string; width: number; opacity: number} {
  if (index === total - 1) return {stroke: 'var(--chart-4)', width: 2.5, opacity: 1};
  return {stroke: DAY_COLORS[index % DAY_COLORS.length], width: 1.75, opacity: 1};
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
            content={({active, payload, label}) => {
              if (!active || !payload?.length) return null;
              const entries = payload.filter((p) => p.value != null);
              if (!entries.length) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                  <div className="mb-1 text-muted-foreground">{todLabel(Number(label))}</div>
                  <div className="flex flex-col gap-1">
                    {entries.map((p) => {
                      const i = days.indexOf(String(p.dataKey));
                      const s = dayLineStyle(i, n);
                      const latest = i === n - 1;
                      return (
                        <div key={String(p.dataKey)} className="flex items-center gap-2 tabular-nums">
                          <span className="size-2 rounded-[3px]" style={{backgroundColor: s.stroke, opacity: s.opacity}} />
                          <span className={cn(latest ? 'text-foreground' : 'text-muted-foreground')}>{dayShort(String(p.dataKey))}</span>
                          <span className="ml-auto font-medium">{formatPeso(Number(p.value))}</span>
                        </div>
                      );
                    })}
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

/**
 * The event "Revenue over time" chart: the cumulative-revenue area by default, or
 * the per-day pacing overlay when compare mode is on. Both use Recharts, so the
 * whole switch lives in this lazily-loaded module.
 */
export function EventRevenueChart({
  showCompare,
  pacing,
  series,
}: {
  showCompare: boolean;
  pacing: DayPacingSeries;
  series: {label: string; revenue: number}[];
}) {
  if (showCompare) return <DayPacingChart pacing={pacing} />;
  return (
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
  );
}
