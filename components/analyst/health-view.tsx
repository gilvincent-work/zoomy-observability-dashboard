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

/** A read-only value token inside an equation. */
function Val({children, hint}: {children: React.ReactNode; hint?: string}) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium tabular-nums text-foreground">
      {children}
      {hint && <InfoTip text={hint} />}
    </span>
  );
}

/** An editable variable inline in an equation. Owns its own text buffer so the
 *  field can be cleared and typed freely; emits a parsed number to the parent. */
function EditVal({initial, onChange, suffix, disabled}: {initial: string; onChange: (n: number) => void; suffix: string; disabled?: boolean}) {
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
          if (!/^\d*\.?\d*$/.test(v)) return; // digits + one dot only
          setText(v);
          const n = parseFloat(v);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="w-12 rounded-md border border-primary/40 bg-background px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
      />
      <span className="ml-0.5 text-muted-foreground">{suffix}</span>
    </span>
  );
}

const op = (s: string) => <span className="mx-1 text-muted-foreground">{s}</span>;

function ChannelCard({facts, knobs, target, nonce, onChange}: {facts: ChannelFacts; knobs: Knobs; target: number; nonce: number; onChange: (k: Knobs) => void}) {
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

      {/* QRR hero */}
      <div className="mt-3 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">QRR <InfoTip text={HEALTH_HINTS.qrr} /></div>
      <div className="flex items-baseline gap-2">
        <span className={`text-4xl font-bold tabular-nums ${qrrColor}`}>{fmtQrr(h.qrr)}</span>
        <span className="text-xs text-muted-foreground">/ target {target}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor}`} style={{width: naQrr ? '0%' : `${Math.min(100, (h.qrr! / target) * 100)}%`}} />
      </div>
      <div className="mt-2 text-[13px] text-foreground/80">
        QRR{op('=')}<span className="text-muted-foreground">LTV</span> {peso(h.ltv)}{op('÷')}<span className="text-muted-foreground">CAC</span> {peso(h.cac)}{op('=')}<span className="font-semibold">{fmtQrr(h.qrr)}</span>
      </div>

      {/* LTV equation */}
      <div className="mt-4 rounded-xl border border-border p-3">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">LTV <InfoTip text={HEALTH_HINTS.ltv} /></span>
          <span className="text-lg font-semibold tabular-nums">{peso(h.ltv)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center text-[13px] text-foreground/85">
          <span className="text-muted-foreground">AOV</span>&nbsp;<Val hint={HEALTH_HINTS.aov}>{peso(h.aov)}</Val>
          {op('×')}<span className="text-muted-foreground">Repeat</span>&nbsp;<Val hint={HEALTH_HINTS.repeat}>{h.repeat}×</Val>
          {op('×')}<span className="text-muted-foreground">Margin</span>&nbsp;<Val hint={HEALTH_HINTS.margin}>{pct(h.margin)}</Val>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-y-1 text-[13px] text-foreground/85">
          <span className="text-muted-foreground">Margin{op('=')}1</span>
          {op('−')}<span className="text-muted-foreground">COGS</span>&nbsp;
          <EditVal initial={String(Math.round(knobs.cogsPct * 100))} suffix="%" onChange={(n) => onChange({...knobs, cogsPct: n / 100})} />
          {op('−')}<span className="text-muted-foreground">Fee</span>&nbsp;
          <EditVal initial={String(Math.round(knobs.platformFeePct * 100))} suffix="%" disabled={!facts.platformFeeApplies} onChange={(n) => onChange({...knobs, platformFeePct: n / 100})} />
        </div>
      </div>

      {/* CAC equation */}
      <div className="mt-3 rounded-xl border border-border p-3">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">CAC <InfoTip text={HEALTH_HINTS.cac} /></span>
          <span className="text-lg font-semibold tabular-nums">{peso2(h.cac)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-y-1 text-[13px] text-foreground/85">
          {/* marketing term */}
          {h.roas != null ? (
            <>
              <span className="text-muted-foreground">(AOV</span>&nbsp;<Val>{peso(h.aov)}</Val>{op('÷')}<span className="text-muted-foreground">ROAS</span>&nbsp;<Val hint={HEALTH_HINTS.roas}>{h.roas}×</Val><span className="text-muted-foreground">)</span>
            </>
          ) : (
            <span className="text-muted-foreground">no ads (₱0)</span>
          )}
          {op('+')}
          {/* promo term */}
          <span className="text-muted-foreground">(Promos</span>&nbsp;
          <EditVal initial={String(knobs.promos)} suffix="₱" onChange={(n) => onChange({...knobs, promos: n})} />
          {op('÷')}<Val hint={HEALTH_HINTS.orders}>{facts.orders.toLocaleString()}</Val>&nbsp;<span className="text-muted-foreground">orders)</span>
        </div>
        <div className="mt-1.5 text-[13px] text-muted-foreground">
          = {peso2(h.marketingPerOrder)}/order marketing + {peso2(h.promosPerOrder)}/order promo
        </div>
      </div>

      {/* Facts footer */}
      <div className="mt-3 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">{facts.orders.toLocaleString()} orders <InfoTip text={HEALTH_HINTS.orders} /></span>
        <span className="inline-flex items-center gap-1">{facts.buyers.toLocaleString()} buyers <InfoTip text={HEALTH_HINTS.buyers} /></span>
        <span>{peso(facts.revenue)} revenue</span>
      </div>
      {facts.channel === 'website' && (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Note: CRM order history starts 17 Apr 2026 — earlier website orders aren’t synced, so this channel’s volume is expected to be lower. With no ads, a small promo makes CAC tiny and QRR very large.
        </p>
      )}
      <span hidden>{nonce}</span>
    </div>
  );
}

export function HealthView({snapshot}: {snapshot: BusinessHealthSnapshot}) {
  const defaults = () => Object.fromEntries(snapshot.perChannel.map((c) => [c.channel, {...c.defaults}]));
  const [knobs, setKnobs] = useState<Record<string, Knobs>>(defaults);
  const [nonce, setNonce] = useState(0);
  const reset = () => {
    setKnobs(defaults());
    setNonce((n) => n + 1); // remounts the EditVal inputs with default text
  };

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
          <ChannelCard key={`${c.channel}-${nonce}`} facts={c} knobs={knobs[c.channel]} target={snapshot.target} nonce={nonce} onChange={(k) => setKnobs((prev) => ({...prev, [c.channel]: k}))} />
        ))}
      </div>

      <footer className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
        <p>
          Each channel stands alone (no blending). The <strong>bold outlined</strong> fields — COGS%, Platform Fee%, Promos — are editable; everything else is measured from your data. Margin = 1 − COGS% − Platform Fee%. CAC is a per-order cost: (AOV ÷ ROAS) + (Promos ÷ orders). QRR = LTV ÷ CAC, target {snapshot.target}. Website has no ad data, so its marketing cost is ₱0 — enter a promo to get a CAC (a small promo yields a very large QRR by design). Edits reset on reload. Shopee ads cover Mar–Jul. Trailing window {snapshot.window.label}.
        </p>
      </footer>
    </div>
  );
}
