'use client';

import {useState} from 'react';
import {Store} from 'lucide-react';
import {computeHealth} from '@/src/health-compute';
import {formatPeso} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {InfoTip} from './info-tip';

/**
 * Self-contained "Offline · Bazaar" health card for the Business Health page.
 * Lighter-touch per the 5D go/no-go: the 3 existing channel cards are driven by
 * the batch-computed business_health snapshot (fixed window) and a hardcoded
 * 'shopee' | 'lazada' | 'website' union that also carries cohorts / buyer-mix /
 * monthly history — none of which offline can fill (v1 has no buyer identity).
 * So instead of extending that machinery, this card REUSES the shared
 * computeHealth() math (DRY) with offline's own actuals + two editable knobs.
 *
 * Computed like the Website card (no ROAS): LTV = AOV × margin; CAC = event
 * cost ÷ orders → QRR. Repeat Rate is N/A (no buyers to divide by), shown as
 * such and never folded into QRR. Purely presentational; touches no existing
 * health code or types.
 */
export function OfflineHealthCard({aov, orders, target}: {aov: number; orders: number; target: number}) {
  const [cogsPct, setCogsPct] = useState(35); // %
  const [eventCost, setEventCost] = useState(0); // ₱ for the window

  const health = computeHealth(
    {aov, orders, buyers: 0, roas: null},
    {cogsPct: cogsPct / 100, platformFeePct: 0, promos: 0, acqCost: eventCost},
  );
  const qrr = health.qrr; // null when event cost is 0 (CAC = 0)
  const pct = qrr != null ? Math.min(100, (qrr / target) * 100) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-primary" />
      <CardContent className="py-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Store className="size-4" />
          </span>
          <span className="text-[15px] font-semibold">Offline · Bazaar</span>
          <InfoTip text="POS bazaar sales. Computed like the Website card (no ads): LTV = AOV × margin, CAC = event cost ÷ orders. Repeat Rate needs buyer identity, which the POS doesn’t capture yet, so it’s N/A." />
        </div>

        <div className="mb-1 flex items-end gap-2">
          <span className="text-4xl font-bold tabular-nums text-primary">{qrr != null ? qrr.toFixed(2) : 'N/A'}</span>
          <span className="mb-1 text-sm text-muted-foreground">/ target {target}</span>
        </div>
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{width: `${pct}%`}} />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          LTV {formatPeso(health.contribution)} ÷ CAC {qrr != null ? formatPeso(health.cac) : 'N/A'}
          {qrr != null ? ` = ${qrr.toFixed(2)}` : ' (set an event cost to compute QRR)'}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="AOV" value={formatPeso(aov)} />
          <Stat label="Orders" value={String(orders)} />
          <Stat label="Margin" value={`${Math.round(health.margin * 100)}%`} />
          <Stat label="Repeat rate" value="N/A" muted />
        </div>

        <div className="mt-4 flex flex-wrap gap-3 border-t pt-4">
          <Knob label="COGS %" value={cogsPct} onChange={setCogsPct} suffix="%" />
          <Knob label="Event cost" value={eventCost} onChange={setEventCost} prefix="₱" />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({label, value, muted}: {label: string; value: string; muted?: boolean}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={muted ? 'text-sm text-muted-foreground' : 'text-sm font-semibold tabular-nums'}>{value}</span>
    </div>
  );
}

function Knob({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="inline-flex items-center rounded-md border px-2 py-1">
        {prefix && <span className="mr-0.5 text-muted-foreground">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-16 bg-transparent text-right text-sm tabular-nums outline-none"
        />
        {suffix && <span className="ml-0.5 text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
}
