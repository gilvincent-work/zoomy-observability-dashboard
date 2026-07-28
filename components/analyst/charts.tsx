'use client';

// Presentational Recharts charts for the analyst dashboard. Each takes a plain
// array and renders one chart (SRP). Series colors come from CSS vars so light/
// dark themes swap in one place — see app/globals.css and dashboard-charts.md.
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import type {SalesSignals} from '../../src/salesSignals';
import {ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig} from '@/components/ui/chart';

const money = (n: number) => `$${n.toLocaleString()}`;

// ── Revenue: 6-week actuals + a one-week forecast with an 80% confidence band ──
export function RevenueForecastChart({revenue}: {revenue: SalesSignals['revenue']}) {
  const actuals = revenue.series.filter((s) => s.revenue != null);
  const lastActual = actuals[actuals.length - 1];
  const fc = revenue.series.find((s) => s.forecast != null);

  // Shape one connected series: the forecast line + band both anchor at the last
  // actual (band collapses to a point there, then widens into a cone at Jul 27).
  const data = revenue.series.map((s) => {
    const row: {week: string; revenue?: number; forecast?: number; band?: [number, number]} = {
      week: s.week,
      revenue: s.revenue,
    };
    if (lastActual && s.week === lastActual.week) {
      row.forecast = lastActual.revenue;
      row.band = [lastActual.revenue as number, lastActual.revenue as number];
    }
    if (fc && s.week === fc.week) {
      row.forecast = fc.forecast;
      row.band = [fc.lo as number, fc.hi as number];
    }
    return row;
  });

  const config = {
    revenue: {label: 'Revenue', color: 'var(--chart-1)'},
    forecast: {label: 'Forecast', color: 'var(--chart-1)'},
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-full min-h-[220px] w-full">
      <ComposedChart data={data} margin={{left: 4, right: 8, top: 8, bottom: 0}}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          fontSize={11}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
        />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        {/* confidence band (range area) — recessive fill, no stroke */}
        <Area dataKey="band" stroke="none" fill="var(--chart-1)" fillOpacity={0.14} isAnimationActive={false} />
        {/* actuals — solid */}
        <Line
          dataKey="revenue"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{r: 3}}
          connectNulls={false}
          isAnimationActive={false}
        />
        {/* forecast — dashed */}
        <Line
          dataKey="forecast"
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{r: 3}}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ── Top SKUs by revenue — horizontal bar (ranking / magnitude, single hue) ──
export function TopSkusChart({skus}: {skus: SalesSignals['topSkus']}) {
  const config = {revenue: {label: 'Revenue', color: 'var(--chart-1)'}} satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <BarChart data={skus} layout="vertical" margin={{left: 8, right: 44, top: 4, bottom: 4}}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={110}
          fontSize={11}
        />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
        <Bar dataKey="revenue" fill="var(--chart-1)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="revenue"
            position="right"
            offset={8}
            fontSize={11}
            className="fill-muted-foreground"
            formatter={(v) => money(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ── Traffic sources — donut (part-of-whole, ≤5 parts → distinct categorical hues) ──
const CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)'];

export function TrafficDonut({traffic}: {traffic: SalesSignals['traffic']}) {
  const total = traffic.sessions;
  const data = traffic.sources.map((s, i) => ({
    ...s,
    pct: Math.round((s.sessions / total) * 100),
    fill: CAT[i % CAT.length],
  }));
  const config: ChartConfig = Object.fromEntries(
    data.map((d, i) => [d.name, {label: d.name, color: CAT[i % CAT.length]}]),
  );
  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-[220px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${Number(v).toLocaleString()} sessions`} />} />
        <Pie
          data={data}
          dataKey="sessions"
          nameKey="name"
          innerRadius={54}
          outerRadius={86}
          paddingAngle={2}
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
          <LabelList
            dataKey="pct"
            className="fill-background"
            fontSize={11}
            fontWeight={600}
            formatter={(v) => `${Number(v)}%`}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

// ── Conversion funnel — ordered stages (width encodes the value) ──
const FUNNEL_RAMP = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-2)', 'var(--chart-4)', 'var(--chart-5)'];

export function ConversionFunnel({funnel}: {funnel: SalesSignals['funnel']}) {
  const top = funnel[0]?.value || 1;
  const data = funnel.map((f, i) => ({...f, fill: FUNNEL_RAMP[i % FUNNEL_RAMP.length]}));
  const config: ChartConfig = {value: {label: 'People'}};
  return (
    <div>
      <ChartContainer config={config} className="h-[200px] w-full">
        <FunnelChart margin={{left: 0, right: 0, top: 4, bottom: 4}}>
          <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${Number(v).toLocaleString()} people`} />} />
          <Funnel dataKey="value" data={data} isAnimationActive={false} lastShapeType="rectangle">
            {data.map((d) => (
              <Cell key={d.stage} fill={d.fill} />
            ))}
          </Funnel>
        </FunnelChart>
      </ChartContainer>
      {/* HTML stage legend — fully controlled, no SVG clipping */}
      <div className="mt-3 grid grid-cols-5 gap-2 border-t pt-3 text-center">
        {data.map((d) => (
          <div key={d.stage} className="min-w-0">
            <div className="mx-auto mb-1 h-1 w-6 rounded-full" style={{backgroundColor: d.fill}} />
            <div className="truncate text-[11px] text-muted-foreground">{d.stage}</div>
            <div className="font-mono text-sm font-semibold tabular-nums">{d.value.toLocaleString()}</div>
            <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {Math.round((d.value / top) * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
