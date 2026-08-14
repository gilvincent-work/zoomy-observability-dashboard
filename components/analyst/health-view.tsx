import type {BusinessHealthSnapshot} from '@/src/health-types';
import {HEALTH_HINTS} from './health-hints';
import {InfoTip} from './info-tip';

const peso = (n: number) => '₱' + Math.round(n).toLocaleString();
const x2 = (n: number) => n.toFixed(2);

function Stat({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {label} {hint && <InfoTip text={hint} />}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function HealthView({snapshot: s}: {snapshot: BusinessHealthSnapshot}) {
  const onTrack = s.qrr >= s.target;
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* Hero */}
      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          Quality Revenue Ratio <InfoTip text={HEALTH_HINTS.qrr} />
          <span className="ml-2 text-xs">· {s.window.label} <InfoTip text={HEALTH_HINTS.window} /></span>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className={`text-6xl font-bold tabular-nums ${onTrack ? 'text-emerald-600' : 'text-amber-600'}`}>{x2(s.qrr)}</span>
          <span className="text-lg text-muted-foreground">/ target {s.target}</span>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${onTrack ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{width: `${Math.min(100, (s.qrr / s.target) * 100)}%`}} />
        </div>
        <p className="mt-3 text-sm text-foreground/80">
          {onTrack ? 'On track — lifetime value comfortably exceeds acquisition cost.' : `Below target — each customer is worth ${x2(s.qrr)}× what we spend to acquire them; we want ${s.target}×.`}
        </p>
      </section>

      {/* Decomposition — the three levers */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">QRR = Repeat × Margin × ROAS</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Repeat factor" value={`${s.repeatFactor}×`} hint={HEALTH_HINTS.repeatFactor} />
          <Stat label="Margin" value={s.margin.toFixed(2)} hint={HEALTH_HINTS.margin} />
          <Stat label="Blended ROAS" value={`${s.blendedRoas}×`} hint={HEALTH_HINTS.blendedRoas} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{s.repeatFactor} × {s.margin.toFixed(2)} × {s.blendedRoas} = {x2(s.qrr)} — blended AOV cancels out, so these three levers are what move QRR.</p>
      </section>

      {/* LTV & CAC formula cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-1 text-sm font-semibold">LTV <InfoTip text={HEALTH_HINTS.ltv} /></div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{peso(s.ltv)}</div>
          <p className="mt-2 text-sm text-muted-foreground">Blended AOV ({peso(s.blendedAov)}) × Repeat ({s.repeatFactor}) × Margin ({s.margin.toFixed(2)})</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-1 text-sm font-semibold">CAC <InfoTip text={HEALTH_HINTS.cac} /></div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{peso(s.cac)}</div>
          <p className="mt-2 text-sm text-muted-foreground">Blended AOV ({peso(s.blendedAov)}) ÷ Blended ROAS ({s.blendedRoas})</p>
        </div>
      </section>

      {/* Supporting stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Blended AOV" value={peso(s.blendedAov)} hint={HEALTH_HINTS.blendedAov} />
        <Stat label="Distinct buyers" value={s.totals.buyers.toLocaleString()} hint={HEALTH_HINTS.buyers} />
        <Stat label="Total orders" value={s.totals.orders.toLocaleString()} hint={HEALTH_HINTS.orders} />
        <Stat label="Revenue" value={peso(s.totals.revenue)} hint={HEALTH_HINTS.blendedAov} />
      </section>

      {/* Per-channel table */}
      <section className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Channel</th>
              <th className="p-3 text-right">Orders <InfoTip text={HEALTH_HINTS.orders} /></th>
              <th className="p-3 text-right">Buyers <InfoTip text={HEALTH_HINTS.buyers} /></th>
              <th className="p-3 text-right">Revenue</th>
              <th className="p-3 text-right">ROAS <InfoTip text={HEALTH_HINTS.blendedRoas} /></th>
            </tr>
          </thead>
          <tbody>
            {s.perChannel.map((c) => (
              <tr key={c.channel} className="border-t border-border">
                <td className="p-3 capitalize">
                  <span className="inline-flex items-center gap-1">{c.channel} <InfoTip text={HEALTH_HINTS[`ch_${c.channel}`]} /></span>
                </td>
                <td className="p-3 text-right tabular-nums">{c.orders.toLocaleString()}</td>
                <td className="p-3 text-right tabular-nums">{c.buyers.toLocaleString()}</td>
                <td className="p-3 text-right tabular-nums">{peso(c.revenue)}</td>
                <td className="p-3 text-right tabular-nums">{c.roas != null ? `${c.roas}×` : '—'}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-3">Blended</td>
              <td className="p-3 text-right tabular-nums">{s.totals.orders.toLocaleString()}</td>
              <td className="p-3 text-right tabular-nums">{s.totals.buyers.toLocaleString()}</td>
              <td className="p-3 text-right tabular-nums">{peso(s.totals.revenue)}</td>
              <td className="p-3 text-right tabular-nums">{s.blendedRoas}×</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Methodology footer */}
      <footer className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p>Trailing 6-month window ({s.window.label}), computed fresh from each channel. Margin is a fixed {s.margin.toFixed(2)} assumption (COGS/shipping to come). CAC uses paid channels only (Shopee + Lazada). Lazada buyers are a ~1.3% conservative proxy; Shopee &amp; Website are exact.</p>
      </footer>
    </div>
  );
}
