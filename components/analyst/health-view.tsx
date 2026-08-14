'use client';

import {useState} from 'react';
import type {BusinessHealthSnapshot, ChannelFacts, Knobs} from '@/src/health-types';
import {computeChannelHealth} from '@/src/health-compute';
import {HEALTH_HINTS} from './health-hints';
import {InfoTip} from './info-tip';

const peso = (n: number) => '₱' + Math.round(n).toLocaleString();
const peso2 = (n: number) => '₱' + n.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pct = (f: number) => `${Math.round(f * 100)}%`;
const fmtQrr = (q: number | null) => (q == null ? 'N/A' : q >= 100 ? q.toLocaleString(undefined, {maximumFractionDigits: 0}) : q.toFixed(2));

const CHANNEL_LABEL: Record<string, string> = {shopee: 'Shopee', lazada: 'Lazada', website: 'Website'};
const CHANNEL_ACCENT: Record<string, string> = {shopee: '#EE4D2D', lazada: '#2F6BD4', website: '#2E7D5B'};

/** A bold, highlighted section label (QRR / LTV / CAC). */
function SectionLabel({children, hint, accent}: {children: React.ReactNode; hint?: string; accent?: string}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-foreground">
        {accent && <span className="size-1.5 rounded-full" style={{backgroundColor: accent}} />}
        {children}
      </span>
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

/** Read-only value token inside an equation. */
function Val({children, hint}: {children: React.ReactNode; hint?: string}) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold tabular-nums text-foreground">
      {children}
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

/** Editable variable inline in an equation. Owns its own text buffer so the field
 *  can be cleared and typed freely; emits a parsed number to the parent. */
function EditVal({initial, onChange, suffix, accent, disabled}: {initial: string; onChange: (n: number) => void; suffix: string; accent?: string; disabled?: boolean}) {
  const [text, setText] = useState(initial);
  return (
    <span className="inline-flex items-center">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (!/^\d*\.?\d*$/.test(v)) return;
          setText(v);
          const n = parseFloat(v);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        style={disabled ? undefined : {borderColor: accent, boxShadow: `inset 0 0 0 1px ${accent}22`}}
        className="w-14 rounded-md border bg-background px-1.5 py-0.5 text-center text-sm font-bold tabular-nums text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary/30 disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
      />
      <span className="ml-0.5 text-muted-foreground">{suffix}</span>
    </span>
  );
}

const op = (s: string) => <span className="mx-1 text-muted-foreground/70">{s}</span>;

function ChannelCard({facts, knobs, target, nonce, onChange}: {facts: ChannelFacts; knobs: Knobs; target: number; nonce: number; onChange: (k: Knobs) => void}) {
  const h = computeChannelHealth(facts, knobs);
  const accent = CHANNEL_ACCENT[facts.channel];
  const naQrr = h.qrr == null;
  const onTrack = !naQrr && h.qrr! >= target;
  const qrrColor = naQrr ? 'text-muted-foreground' : onTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
  const barColor = onTrack ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="h-1" style={{backgroundColor: accent}} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
          <span className="size-2.5 rounded-full" style={{backgroundColor: accent}} />
          {CHANNEL_LABEL[facts.channel]} <InfoTip text={HEALTH_HINTS[`ch_${facts.channel}`]} />
        </div>

        {/* QRR hero */}
        <div className="mt-4">
          <SectionLabel hint={HEALTH_HINTS.qrr}>QRR</SectionLabel>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className={`text-5xl font-bold leading-none tabular-nums ${qrrColor}`}>{fmtQrr(h.qrr)}</span>
            <span className="text-sm text-muted-foreground">/ target {target}</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{width: naQrr ? '0%' : `${Math.min(100, (h.qrr! / target) * 100)}%`}} />
          </div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">
            LTV {peso(h.ltv)}{op('÷')}CAC {peso(h.cac)}{op('=')}<span className="font-semibold text-foreground">{fmtQrr(h.qrr)}</span>
          </div>
        </div>

        {/* LTV */}
        <div className="mt-4 rounded-xl border border-border bg-background/40 p-3.5">
          <div className="flex items-center justify-between">
            <SectionLabel hint={HEALTH_HINTS.ltv}>LTV</SectionLabel>
            <span className="text-xl font-bold tabular-nums text-foreground">{peso(h.ltv)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center text-[13px] text-foreground/80">
            <span className="text-muted-foreground">AOV</span>&nbsp;<Val hint={HEALTH_HINTS.aov}>{peso(h.aov)}</Val>
            {op('×')}<span className="text-muted-foreground">Repeat</span>&nbsp;<Val hint={HEALTH_HINTS.repeat}>{h.repeat}×</Val>
            {op('×')}<span className="text-muted-foreground">Margin</span>&nbsp;<Val hint={HEALTH_HINTS.margin}>{pct(h.margin)}</Val>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-y-1.5 text-[13px] text-foreground/80">
            <span className="text-muted-foreground">Margin{op('=')}1</span>
            {op('−')}<span className="text-muted-foreground">COGS</span>&nbsp;
            <EditVal initial={String(Math.round(knobs.cogsPct * 100))} suffix="%" accent={accent} onChange={(n) => onChange({...knobs, cogsPct: n / 100})} />
            {op('−')}<span className="text-muted-foreground">Fee</span>&nbsp;
            <EditVal initial={String(Math.round(knobs.platformFeePct * 100))} suffix="%" accent={accent} disabled={!facts.platformFeeApplies} onChange={(n) => onChange({...knobs, platformFeePct: n / 100})} />
          </div>
        </div>

        {/* CAC */}
        <div className="mt-3 rounded-xl border border-border bg-background/40 p-3.5">
          <div className="flex items-center justify-between">
            <SectionLabel hint={HEALTH_HINTS.cac}>CAC</SectionLabel>
            <span className="text-xl font-bold tabular-nums text-foreground">{peso2(h.cac)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-y-1.5 text-[13px] text-foreground/80">
            {h.roas != null ? (
              <>
                <span className="text-muted-foreground">(AOV</span>&nbsp;<Val>{peso(h.aov)}</Val>{op('÷')}<span className="text-muted-foreground">ROAS</span>&nbsp;<Val hint={HEALTH_HINTS.roas}>{h.roas}×</Val><span className="text-muted-foreground">)</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">(Acq. cost</span>&nbsp;
                <EditVal initial={String(knobs.acqCost)} suffix="₱" accent={accent} onChange={(n) => onChange({...knobs, acqCost: n})} />
                {op('÷')}<Val>{facts.orders.toLocaleString()}</Val>&nbsp;<span className="text-muted-foreground">orders)</span>
                <InfoTip text={HEALTH_HINTS.acqCost} />
              </>
            )}
            {op('+')}
            <span className="text-muted-foreground">(Promos</span>&nbsp;
            <EditVal initial={String(knobs.promos)} suffix="₱" accent={accent} onChange={(n) => onChange({...knobs, promos: n})} />
            {op('÷')}<Val>{facts.orders.toLocaleString()}</Val>&nbsp;<span className="text-muted-foreground">orders)</span>
          </div>
          <div className="mt-2 text-[12.5px] text-muted-foreground">
            = {peso2(h.marketingPerOrder)}/order {h.roas != null ? 'marketing' : 'acquisition'} + {peso2(h.promosPerOrder)}/order promo
          </div>
          {naQrr && (
            <div className="mt-2 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[12px] text-amber-700 dark:text-amber-400">
              No acquisition cost yet — enter an Acq. cost or Promos above to compute QRR.
            </div>
          )}
        </div>

        {/* Facts footer */}
        <div className="mt-auto pt-3.5">
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">{facts.orders.toLocaleString()} orders <InfoTip text={HEALTH_HINTS.orders} /></span>
            <span className="inline-flex items-center gap-1">{facts.buyers.toLocaleString()} buyers <InfoTip text={HEALTH_HINTS.buyers} /></span>
            <span>{peso(facts.revenue)} revenue</span>
          </div>
          {facts.channel === 'website' && (
            <p className="mt-2 text-[11.5px] italic leading-snug text-muted-foreground">
              Note: CRM order history starts 17 Apr 2026 — earlier website orders aren’t synced, so volume is expected to be lower.
            </p>
          )}
        </div>
        <span hidden>{nonce}</span>
      </div>
    </div>
  );
}

export function HealthView({snapshot}: {snapshot: BusinessHealthSnapshot}) {
  const defaults = () => Object.fromEntries(snapshot.perChannel.map((c) => [c.channel, {...c.defaults}]));
  const [knobs, setKnobs] = useState<Record<string, Knobs>>(defaults);
  const [nonce, setNonce] = useState(0);
  const reset = () => {
    setKnobs(defaults());
    setNonce((n) => n + 1);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-foreground">Business Health</h1>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            Per-channel Quality Revenue Ratio · {snapshot.window.label} <InfoTip text={HEALTH_HINTS.window} />
          </p>
        </div>
        <button onClick={reset} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground">
          Reset assumptions
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {snapshot.perChannel.map((c) => (
          <ChannelCard key={`${c.channel}-${nonce}`} facts={c} knobs={knobs[c.channel]} target={snapshot.target} nonce={nonce} onChange={(k) => setKnobs((prev) => ({...prev, [c.channel]: k}))} />
        ))}
      </div>

      <footer className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          Each channel stands alone (no blending). The <strong className="text-foreground/80">outlined</strong> fields — COGS%, Platform Fee%, Promos, and (for Website) Acq. cost — are editable; everything else is measured from your data. Margin = 1 − COGS% − Platform Fee%. CAC is a per-order cost: (marketing or acquisition) + (Promos ÷ orders). QRR = LTV ÷ CAC, target {snapshot.target}. Website has no ad data, so enter an Acq. cost (organic/ops spend) to give it a real CAC. Edits reset on reload. Shopee ads cover Mar–Jul. Trailing window {snapshot.window.label}.
        </p>
      </footer>
    </div>
  );
}
