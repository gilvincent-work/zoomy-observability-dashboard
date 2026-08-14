'use client';

import {useState} from 'react';
import type {BusinessHealthSnapshot, ChannelFacts, Knobs} from '@/src/health-types';
import {computeChannelHealth} from '@/src/health-compute';
import {HEALTH_HINTS} from './health-hints';
import {InfoTip} from './info-tip';

const peso = (n: number) => '₱' + Math.round(n).toLocaleString();
const pct = (f: number) => `${Math.round(f * 100)}%`;
const CHANNEL_LABEL: Record<string, string> = {shopee: 'Shopee', lazada: 'Lazada', website: 'Website'};

function Derived({label, value, hint}: {label: string; value: string; hint: string}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      <InfoTip text={hint} />
    </span>
  );
}

function KnobField({
  label, hint, value, onChange, suffix, disabled,
}: {label: string; hint: string; value: number; onChange: (n: number) => void; suffix: string; disabled?: boolean}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label} <InfoTip text={hint} />
      </span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          disabled={disabled}
          value={Number.isFinite(value) ? value : 0}
          min={0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </span>
    </label>
  );
}

function ChannelCard({facts, knobs, target, onChange}: {facts: ChannelFacts; knobs: Knobs; target: number; onChange: (k: Knobs) => void}) {
  const h = computeChannelHealth(facts, knobs);
  const naQrr = h.qrr == null;
  const onTrack = !naQrr && h.qrr! >= target;
  const qrrColor = naQrr ? 'text-muted-foreground' : onTrack ? 'text-emerald-600' : 'text-amber-600';
  const barColor = onTrack ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
        {CHANNEL_LABEL[facts.channel]} <InfoTip text={HEALTH_HINTS[`ch_${facts.channel}`]} />
      </div>

      {/* QRR */}
      <div className="mt-3 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        QRR <InfoTip text={HEALTH_HINTS.qrr} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-4xl font-bold tabular-nums ${qrrColor}`}>{naQrr ? 'N/A' : h.qrr!.toFixed(2)}</span>
        <span className="text-xs text-muted-foreground">/ target {target}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{width: naQrr ? '0%' : `${Math.min(100, (h.qrr! / target) * 100)}%`}} />
      </div>

      {/* LTV / CAC */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">LTV <InfoTip text={HEALTH_HINTS.ltv} /></div>
          <div className="text-xl font-semibold tabular-nums">{peso(h.ltv)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">AOV × Repeat × Margin</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">CAC <InfoTip text={HEALTH_HINTS.cac} /></div>
          <div className="text-xl font-semibold tabular-nums">{peso(h.cac)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {h.roas ? `${peso(h.marketingPerOrder)}/order + ` : 'no ads + '}{peso(h.promosPerOrder)} promo
          </div>
        </div>
      </div>

      {/* Derived facts */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Derived label="AOV" value={peso(h.aov)} hint={HEALTH_HINTS.aov} />
        <Derived label="Repeat" value={`${h.repeat}×`} hint={HEALTH_HINTS.repeat} />
        <Derived label="ROAS" value={h.roas != null ? `${h.roas}×` : '—'} hint={HEALTH_HINTS.roas} />
        <Derived label="Margin" value={pct(h.margin)} hint={HEALTH_HINTS.margin} />
      </div>

      {/* Editable knobs */}
      <div className="mt-4 border-t border-dashed border-border pt-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Assumptions — edit to model</div>
        <div className="flex flex-wrap gap-3">
          <KnobField label="COGS" hint={HEALTH_HINTS.cogs} suffix="%" value={Math.round(knobs.cogsPct * 100)} onChange={(n) => onChange({...knobs, cogsPct: n / 100})} />
          <KnobField label="Platform fee" hint={HEALTH_HINTS.platformFee} suffix="%" disabled={!facts.platformFeeApplies} value={Math.round(knobs.platformFeePct * 100)} onChange={(n) => onChange({...knobs, platformFeePct: n / 100})} />
          <KnobField label="Promos" hint={HEALTH_HINTS.promos} suffix="₱" value={knobs.promos} onChange={(n) => onChange({...knobs, promos: n})} />
        </div>
      </div>

      {/* Facts footer */}
      <div className="mt-3 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">{facts.orders.toLocaleString()} orders <InfoTip text={HEALTH_HINTS.orders} /></span>
        <span className="inline-flex items-center gap-1">{facts.buyers.toLocaleString()} buyers <InfoTip text={HEALTH_HINTS.buyers} /></span>
        <span>{peso(facts.revenue)} revenue</span>
      </div>
    </div>
  );
}

export function HealthView({snapshot}: {snapshot: BusinessHealthSnapshot}) {
  const initial: Record<string, Knobs> = Object.fromEntries(snapshot.perChannel.map((c) => [c.channel, {...c.defaults}]));
  const [knobs, setKnobs] = useState<Record<string, Knobs>>(initial);
  const reset = () => setKnobs(Object.fromEntries(snapshot.perChannel.map((c) => [c.channel, {...c.defaults}])));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Business Health</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            Per-channel Quality Revenue Ratio · {snapshot.window.label} <InfoTip text={HEALTH_HINTS.window} />
          </p>
        </div>
        <button onClick={reset} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          Reset assumptions
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {snapshot.perChannel.map((c) => (
          <ChannelCard key={c.channel} facts={c} knobs={knobs[c.channel]} target={snapshot.target} onChange={(k) => setKnobs((prev) => ({...prev, [c.channel]: k}))} />
        ))}
      </div>

      <footer className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p>
          Each channel stands alone (no blending). LTV = AOV × Repeat × Margin, where Margin = 1 − COGS% − Platform Fee%.
          CAC = (AOV ÷ ROAS) + (Promos ÷ orders); QRR = LTV ÷ CAC, target {snapshot.target}. Website has no ad data, so its ROAS
          and marketing cost are N/A — its QRR needs a promo figure to compute. Assumptions above are editable and reset on reload;
          Shopee ads cover Mar–Jul (ads started March). Trailing window {snapshot.window.label}.
        </p>
      </footer>
    </div>
  );
}
