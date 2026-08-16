'use client';

import {useEffect, useRef, useState} from 'react';
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

/** Short focus-guide captions (what each field is asking for). */
const FIELD_HELP: Record<string, string> = {
  cogs: 'COGS — cost to make + ship the product, as a % of revenue.',
  platformFee: 'Platform Fee — the marketplace’s cut, as a % of revenue.',
  promos: 'Promos — total ₱ spent on discounts & bundles this window.',
  acqCost: 'Acq. cost — total ₱ spent acquiring website customers (organic/ops).',
};

/** A bold, highlighted section label (QRR / LTV / CAC). */
function SectionLabel({children, hint}: {children: React.ReactNode; hint?: string}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-md bg-foreground/[0.07] px-2 py-0.5 text-xs font-bold uppercase tracking-[0.09em] text-foreground">{children}</span>
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

/** Wraps a computed value and replays a "pop" animation whenever `value` changes
 *  (skips the initial render). Respects prefers-reduced-motion via CSS. */
function Pop({value, className, children}: {value: number | string | null; className?: string; children: React.ReactNode}) {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove('health-pop');
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add('health-pop');
  }, [value]);
  return (
    <span ref={ref} className={`inline-block ${className ?? ''}`}>
      {children}
    </span>
  );
}

/** Orders ÷ Distinct-buyers shown as a stacked fraction (the repeat rate). */
function Fraction({num, den, hint}: {num: string; den: string; hint?: string}) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <span className="inline-flex flex-col items-center leading-tight">
        <span className="px-1 text-[12.5px] font-semibold tabular-nums text-foreground">{num}</span>
        <span className="my-0.5 h-px w-full bg-foreground/40" />
        <span className="px-1 text-[12.5px] font-semibold tabular-nums text-foreground">{den}</span>
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

/** A labelled, editable variable chip. The label lives inside the chip so it's
 *  always clear what the field is; focus lights it up and shows a guide caption. */
function Knob({label, helpKey, initial, suffix, accent, disabled, onChange, setHelp}: {
  label: string; helpKey: string; initial: string; suffix: string; accent: string; disabled?: boolean;
  onChange: (n: number) => void; setHelp: (s: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border-2 bg-background px-2 py-1 transition-colors ${disabled ? 'border-border opacity-60' : 'border-border focus-within:bg-background'}`}
      style={disabled ? undefined : {borderColor: 'var(--knob-border)', ['--knob-border' as string]: accent + '55'}}
    >
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-foreground/70">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        onFocus={() => setHelp(FIELD_HELP[helpKey] ?? null)}
        onBlur={() => setHelp(null)}
        onChange={(e) => {
          const v = e.target.value;
          if (!/^\d*\.?\d*$/.test(v)) return;
          setText(v);
          const n = parseFloat(v);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="w-16 bg-transparent text-center text-base font-bold tabular-nums text-foreground outline-none disabled:text-muted-foreground"
      />
      <span className="text-sm font-medium text-muted-foreground">{suffix}</span>
    </span>
  );
}

const op = (s: string) => <span className="mx-1.5 font-medium text-foreground/45">{s}</span>;

function ChannelCard({facts, knobs, target, nonce, onChange}: {facts: ChannelFacts; knobs: Knobs; target: number; nonce: number; onChange: (k: Knobs) => void}) {
  const h = computeChannelHealth(facts, knobs);
  const accent = CHANNEL_ACCENT[facts.channel];
  const [help, setHelp] = useState<string | null>(null);
  const naQrr = h.qrr == null;
  const onTrack = !naQrr && h.qrr! >= target;
  const qrrColor = naQrr ? 'text-muted-foreground' : onTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
  const barColor = onTrack ? 'bg-emerald-500' : 'bg-amber-500';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="h-1.5" style={{backgroundColor: accent}} />
      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-center gap-2 text-base font-bold text-foreground">
          <span className="size-3 rounded-full" style={{backgroundColor: accent}} />
          {CHANNEL_LABEL[facts.channel]} <InfoTip text={HEALTH_HINTS[`ch_${facts.channel}`]} />
        </div>

        {/* QRR hero */}
        <div>
          <SectionLabel hint={HEALTH_HINTS.qrr}>QRR</SectionLabel>
          <div className="mt-2 flex items-baseline gap-2.5">
            <Pop value={h.qrr} className={`text-[54px] font-bold leading-none tabular-nums ${qrrColor}`}>{fmtQrr(h.qrr)}</Pop>
            <span className="text-sm font-medium text-muted-foreground">/ target {target}</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{width: naQrr ? '0%' : `${Math.min(100, (h.qrr! / target) * 100)}%`}} />
          </div>
          <div className="mt-2.5 text-sm text-foreground/75">
            LTV <span className="font-semibold text-foreground">{peso(h.ltv)}</span>{op('÷')}CAC <span className="font-semibold text-foreground">{peso(h.cac)}</span>{op('=')}<span className="font-bold text-foreground">{fmtQrr(h.qrr)}</span>
          </div>
        </div>

        {/* LTV */}
        <div className="rounded-xl border border-border bg-muted/25 p-4">
          <div className="flex items-center justify-between">
            <SectionLabel hint={HEALTH_HINTS.ltv}>LTV</SectionLabel>
            <Pop value={h.ltv} className="text-[22px] font-bold tabular-nums text-foreground">{peso(h.ltv)}</Pop>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center text-[15px] text-foreground/85">
            <span className="text-foreground/60">AOV</span>&nbsp;<Val hint={HEALTH_HINTS.aov}>{peso(h.aov)}</Val>
            {op('×')}<Fraction num={`${facts.orders.toLocaleString()} orders`} den={`${facts.buyers.toLocaleString()} buyers`} hint={HEALTH_HINTS.repeat} />
            {op('×')}<span className="text-foreground/60">Margin</span>&nbsp;
            <span className="inline-flex items-center gap-0.5 font-semibold tabular-nums text-foreground">
              <Pop value={h.margin}>{pct(h.margin)}</Pop>
              <InfoTip text={HEALTH_HINTS.margin} />
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[15px] text-foreground/85">
            <span className="text-foreground/60">Margin{op('=')}1</span>
            {op('−')}
            <Knob label="COGS" helpKey="cogs" initial={String(Math.round(knobs.cogsPct * 100))} suffix="%" accent={accent} setHelp={setHelp} onChange={(n) => onChange({...knobs, cogsPct: n / 100})} />
            {op('−')}
            <Knob label="Platform Fee" helpKey="platformFee" initial={String(Math.round(knobs.platformFeePct * 100))} suffix="%" accent={accent} disabled={!facts.platformFeeApplies} setHelp={setHelp} onChange={(n) => onChange({...knobs, platformFeePct: n / 100})} />
          </div>
        </div>

        {/* CAC */}
        <div className="rounded-xl border border-border bg-muted/25 p-4">
          <div className="flex items-center justify-between">
            <SectionLabel hint={HEALTH_HINTS.cac}>CAC</SectionLabel>
            <Pop value={h.cac} className="text-[22px] font-bold tabular-nums text-foreground">{peso2(h.cac)}</Pop>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[15px] text-foreground/85">
            {h.roas != null ? (
              <span className="inline-flex items-center">
                <span className="text-foreground/60">(AOV</span>&nbsp;<Val>{peso(h.aov)}</Val>{op('÷')}<span className="text-foreground/60">ROAS</span>&nbsp;<Val hint={HEALTH_HINTS.roas}>{h.roas}×</Val><span className="text-foreground/60">)</span>
              </span>
            ) : (
              <Knob label="Acq. cost" helpKey="acqCost" initial={String(knobs.acqCost)} suffix="₱" accent={accent} setHelp={setHelp} onChange={(n) => onChange({...knobs, acqCost: n})} />
            )}
            {h.roas == null && <span className="text-foreground/60">÷ {facts.orders.toLocaleString()} orders</span>}
            {op('+')}
            <Knob label="Promos" helpKey="promos" initial={String(knobs.promos)} suffix="₱" accent={accent} setHelp={setHelp} onChange={(n) => onChange({...knobs, promos: n})} />
            <span className="text-foreground/60">÷ {facts.orders.toLocaleString()} orders</span>
          </div>
          <div className="mt-3 text-sm text-foreground/60">
            = {peso2(h.marketingPerOrder)}/order {h.roas != null ? 'marketing' : 'acquisition'} + {peso2(h.promosPerOrder)}/order promo
          </div>
          {naQrr && (
            <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-[13px] font-medium text-amber-700 dark:text-amber-400">
              No acquisition cost yet — enter an Acq. cost or Promos to compute QRR.
            </div>
          )}
        </div>

        {/* Focus guide */}
        <div className={`min-h-[1.25rem] text-[13px] font-medium transition-colors ${help ? 'text-foreground/80' : 'text-transparent'}`}>
          {help ?? 'placeholder'}
        </div>

        {/* Facts footer */}
        <div className="mt-auto border-t border-border pt-3.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-foreground/70">
            <span className="inline-flex items-center gap-1">{facts.orders.toLocaleString()} orders <InfoTip text={HEALTH_HINTS.orders} /></span>
            <span className="inline-flex items-center gap-1">{facts.buyers.toLocaleString()} buyers <InfoTip text={HEALTH_HINTS.buyers} /></span>
            <span>{peso(facts.revenue)} revenue</span>
          </div>
          {facts.channel === 'website' && (
            <p className="mt-2 text-xs italic leading-snug text-foreground/55">
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
    <div className="mx-auto max-w-[1560px] space-y-6 px-6 py-6">
      <style>{`@keyframes healthPop{0%{transform:scale(1)}35%{transform:scale(1.22)}100%{transform:scale(1)}}.health-pop{animation:healthPop .4s ease-out}@media (prefers-reduced-motion: reduce){.health-pop{animation:none}}`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">Business Health</h1>
          <p className="mt-1 flex items-center gap-1 text-sm text-foreground/65">
            Per-channel Quality Revenue Ratio · {snapshot.window.label} <InfoTip text={HEALTH_HINTS.window} />
          </p>
        </div>
        <button onClick={reset} className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground/70 transition-colors hover:border-foreground/25 hover:text-foreground">
          Reset assumptions
        </button>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {snapshot.perChannel.map((c) => (
          <ChannelCard key={`${c.channel}-${nonce}`} facts={c} knobs={knobs[c.channel]} target={snapshot.target} nonce={nonce} onChange={(k) => setKnobs((prev) => ({...prev, [c.channel]: k}))} />
        ))}
      </div>

      <footer className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground/65">
        <p>
          Each channel stands alone (no blending). The <strong className="text-foreground">outlined</strong> fields — COGS%, Platform Fee%, Promos, and (for Website) Acq. cost — are editable; everything else is measured from your data. Margin = 1 − COGS% − Platform Fee%. CAC is a per-order cost: (marketing or acquisition) + (Promos ÷ orders). QRR = LTV ÷ CAC, target {snapshot.target}. Website has no ad data, so enter an Acq. cost (organic/ops spend) to give it a real CAC. Edits reset on reload. Shopee ads cover Mar–Jul. Trailing window {snapshot.window.label}.
        </p>
      </footer>
    </div>
  );
}
