'use client';

// Global Stock Forecast tuning, edited from the Products page (where catalog is
// managed). Writes the whole config via setStockConfigAction → set_pos_stock_config.
// Per-product threshold overrides live in the same config blob (thresholdOverrides)
// and are set from the forecast table; this panel is the global defaults.

import {useState, useTransition} from 'react';
import {Settings2} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import type {ForecastConfig} from '@/src/pos-forecast-compute';
import {setStockConfigAction} from '@/src/pos-stock-settings-actions';

export function StockSettingsForm({config, usingMock}: {config: ForecastConfig; usingMock: boolean}) {
  const [threshold, setThreshold] = useState(String(config.threshold));
  const [cover, setCover] = useState(String(config.targetCoverEventDays));
  const [lead, setLead] = useState(String(config.leadTimeDays));
  const [warn, setWarn] = useState(String(config.earlyWarningEvents));
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ok: boolean; text: string} | null>(null);

  function save() {
    setMsg(null);
    const next: ForecastConfig = {
      ...config,
      threshold: Number(threshold),
      targetCoverEventDays: Number(cover),
      leadTimeDays: Number(lead),
      earlyWarningEvents: Number(warn),
    };
    startTransition(async () => {
      const res = await setStockConfigAction(next);
      setMsg(res.ok ? {ok: true, text: 'Saved.'} : {ok: false, text: res.error});
    });
  }

  return (
    <Card className="mt-6">
      <CardContent className="py-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Settings2 className="size-3.5" />
          Stock forecast settings
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Drives the Offline forecast&apos;s Low/Out bands and reorder suggestions. Applies to every product; a single SKU can override its
          low threshold from the forecast table.
        </p>

        <div className="flex flex-wrap gap-4">
          <Field label="Low-stock threshold" hint="units" value={threshold} onChange={setThreshold} />
          <Field label="Target cover" hint="selling days" value={cover} onChange={setCover} />
          <Field label="Lead time" hint="days" value={lead} onChange={setLead} />
          <Field label="Early warning" hint="selling days" value={warn} onChange={setWarn} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending || usingMock}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save settings'}
          </button>
          {usingMock && <span className="text-xs text-muted-foreground">Demo mode — set the Supabase pos_* env to save.</span>}
          {msg && <span className={msg.ok ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs text-destructive'}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({label, hint, value, onChange}: {label: string; hint: string; value: string; onChange: (v: string) => void}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">
        {label} <span className="font-normal text-muted-foreground">({hint})</span>
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus-visible:border-ring"
      />
    </label>
  );
}
