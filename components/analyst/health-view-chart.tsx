'use client';

// Recharts for the two Business Health charts, split out of health-view.tsx so they
// load as an async chunk (see the next/dynamic wrappers there) instead of riding in
// the /health initial JS. Holds the QRR-by-month ComposedChart (TrendView) and the
// New-vs-Returning buyer-mix BarChart (BuyerMixChart), plus the chart-only tooltips,
// legend and axis helper. Shared constants live in ./health-view-shared.
import {Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {BusinessHealthSnapshot, ChannelActuals, Knobs} from '@/src/health-types';
import {computeChannelHealth, computeOverallHealth, factsToActuals} from '@/src/health-compute';
import {CHANNELS, CHANNEL_ACCENT} from './health-view-shared';
import {InfoTip} from './info-tip';

/** Channels in card order, blend last with a dashed swatch that matches the
 *  line — recharts' own legend would sort them and draw a circle. */
function TrendLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
      {CHANNELS.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{background: CHANNEL_ACCENT[c.key]}} />
          {c.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <span className="h-0 w-4 border-t-2 border-dashed border-foreground" />
        Overall
      </span>
    </div>
  );
}

/** A tight y-axis: round the peak up to the next round step rather than letting
 *  recharts pick a domain twice the data's height. Aims for 4–6 gridlines. */
function niceScale(peak: number) {
  const headroom = Math.max(peak, 0.5) * 1.02; // just enough to clear the tallest bar
  const step = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50, 100].find((s) => headroom / s <= 6) ?? 200;
  const max = Math.ceil(headroom / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return {max, ticks};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TrendTooltip({active, payload, label}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {/* Channels first, then the blend set apart below a rule — it summarises
          the rows above it rather than sitting alongside them. */}
      {payload
        .filter((p: {dataKey: string}) => p.dataKey !== 'overall')
        .map((p: {dataKey: string; name: string; value: number; color: string}) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{background: p.color}} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">{p.value == null ? 'N/A' : Number(p.value).toFixed(2)}</span>
          </div>
        ))}
      {payload
        .filter((p: {dataKey: string}) => p.dataKey === 'overall')
        .map((p: {dataKey: string; value: number}) => (
          <div key={p.dataKey} className="mt-1 flex items-center gap-2 border-t border-border pt-1">
            <span className="h-0 w-2.5 border-t-2 border-dashed border-foreground" />
            <span className="text-muted-foreground">Overall</span>
            <span className="ml-auto font-bold tabular-nums text-foreground">{p.value == null ? 'N/A' : Number(p.value).toFixed(2)}</span>
          </div>
        ))}
    </div>
  );
}

export function TrendView({snapshot, knobs}: {snapshot: BusinessHealthSnapshot; knobs: Record<string, Knobs>}) {
  const totalOrders: Record<string, number> = Object.fromEntries(snapshot.perChannel.map((c) => [c.channel, c.orders]));
  // Recompute each month's QRR with the current knobs; window-total promos/acq are
  // spread across months in proportion to that month's share of the channel's orders.
  const data = (snapshot.monthly ?? []).map((mo) => {
    const row: Record<string, number | string | null> = {label: mo.label};
    // Collected per month so the blended line uses exactly the same inputs as
    // the bars above it (same knobs, same promo/acq spread).
    const forOverall: {channel: string; actuals: ChannelActuals; knobs: Knobs}[] = [];
    for (const c of CHANNELS) {
      const f = mo.perChannel.find((x) => x.channel === c.key);
      const k = knobs[c.key];
      if (!f || !k) {
        row[c.key] = null;
        continue;
      }
      const share = totalOrders[c.key] ? f.orders / totalOrders[c.key] : 0;
      const monthKnobs = {cogsPct: k.cogsPct, platformFeePct: k.platformFeePct, promos: k.promos * share, acqCost: k.acqCost * share};
      const facts = {...f, platformFeeApplies: c.key !== 'website', defaults: k};
      const h = computeChannelHealth(facts, monthKnobs);
      row[c.key] = h.qrr;
      if (f.orders > 0) forOverall.push({channel: c.key, actuals: factsToActuals(facts), knobs: monthKnobs});
    }
    // Same volume-weighted pooling as the header pill: total gross margin over
    // total spend; channels without a CAC that month sit out.
    row.overall = computeOverallHealth(forOverall).qrr;
    return row;
  });

  // Scale to the data (plus the target line, which must stay visible).
  const peak = data.reduce((m, r) => {
    for (const k of [...CHANNELS.map((c) => c.key), 'overall']) {
      const v = r[k];
      if (typeof v === 'number' && v > m) m = v;
    }
    return m;
  }, snapshot.target);
  const {max: yMax, ticks: yTicks} = niceScale(peak);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-1 text-sm font-semibold text-foreground">
        QRR by month <InfoTip text="Each channel's Quality Revenue Ratio per month, using your current assumptions. The dashed line is the blended Overall QRR for that month. Bars below the target line are under the target of 3." />
      </div>
      <div className="h-[420px] text-muted-foreground max-md:h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{top: 8, right: 16, bottom: 4, left: 0}} barGap={2} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.14} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 13}} dy={4} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={34}
              tick={{fill: 'currentColor', fontSize: 12}}
              domain={[0, yMax]}
              ticks={yTicks}
              allowDecimals
            />
            <Tooltip cursor={{fill: 'currentColor', fillOpacity: 0.05}} content={<TrendTooltip />} />
            <Legend content={<TrendLegend />} wrapperStyle={{paddingTop: 8}} />
            <ReferenceLine y={snapshot.target} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="5 4" label={{value: `target ${snapshot.target}`, position: 'insideTopRight', fontSize: 11, fill: 'currentColor'}} />
            {CHANNELS.map((c) => (
              <Bar key={c.key} dataKey={c.key} name={c.label} fill={CHANNEL_ACCENT[c.key]} radius={[3, 3, 0, 0]} maxBarSize={40} />
            ))}
            {/* Blended QRR rides over the bars — neutral ink so it reads as a
                summary of the channels rather than another channel. */}
            <Line
              type="monotone"
              dataKey="overall"
              name="Overall"
              stroke="var(--foreground)"
              strokeWidth={2}
              strokeDasharray="7 4"
              strokeLinecap="round"
              connectNulls
              // Hollow markers: the card colour punches a clean disc out of
              // whatever bar sits behind, so the ring stays crisp either way.
              dot={{r: 3.5, fill: 'var(--card)', stroke: 'var(--foreground)', strokeWidth: 2}}
              activeDot={{r: 5, fill: 'var(--foreground)', stroke: 'var(--card)', strokeWidth: 2.5}}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MixTooltip({active, payload, label}: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: {value: number}) => s + (p.value || 0), 0);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.slice().reverse().map((p: {dataKey: string; name: string; value: number; color: string}) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{background: p.color}} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums text-foreground">{p.value}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
        <span className="text-muted-foreground">Total buyers</span>
        <span className="ml-auto font-bold tabular-nums text-foreground">{total}</span>
      </div>
    </div>
  );
}

/** New vs Returning buyers, stacked per month. `rgb` is the channel accent as an
 *  "r,g,b" string (returning bar uses it at 0.4 alpha); `accent` is the hex for the
 *  New bar. Both are computed in the parent (they also colour the heatmap cells). */
export function BuyerMixChart({data, rgb, accent}: {data: {label: string; newBuyers: number; returning: number}[]; rgb: string; accent: string}) {
  return (
    <div className="h-[320px] text-muted-foreground max-md:h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{top: 8, right: 12, bottom: 4, left: 0}} barCategoryGap="26%">
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.14} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill: 'currentColor', fontSize: 13}} dy={4} />
          <YAxis tickLine={false} axisLine={false} width={30} tick={{fill: 'currentColor', fontSize: 12}} allowDecimals={false} />
          <Tooltip cursor={{fill: 'currentColor', fillOpacity: 0.05}} content={<MixTooltip />} />
          <Legend wrapperStyle={{fontSize: 13, paddingTop: 6}} iconType="circle" />
          <Bar dataKey="returning" name="Returning" stackId="mix" fill={`rgba(${rgb},0.4)`} maxBarSize={52} />
          <Bar dataKey="newBuyers" name="New" stackId="mix" fill={accent} radius={[3, 3, 0, 0]} maxBarSize={52} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
