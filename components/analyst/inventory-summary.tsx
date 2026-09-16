'use client';

// The Summary tab of the merged Inventory page: status counts, the next-event
// surge planner (interactive, recomputed client-side + persisted), the stock
// forecast settings, and the bundle controls. The heavy per-product work lives on
// the All products tab; this is the at-a-glance panel.

import {useMemo, useState, useTransition} from 'react';
import {TrendingUp} from 'lucide-react';
import {cn} from '@/lib/utils';
import {computeSurge, type ForecastRow, type ForecastConfig, type NextEventPlan} from '@/src/pos-forecast-compute';
import {setNextEventPlanAction} from '@/src/pos-stock-settings-actions';
import {StockSettingsForm} from './stock-settings-form';
import {BundleControls} from './bundle-controls';
import type {PosBundleRow} from '@/src/pos-types';

export function InventorySummary({
  summary,
  forecastRows,
  config,
  plan: initialPlan,
  bundles,
  usingMock,
}: {
  summary: {healthy: number; low: number; out: number; unlisted: number; total: number};
  forecastRows: ForecastRow[];
  config: ForecastConfig | null;
  plan: NextEventPlan | null;
  bundles: PosBundleRow[];
  usingMock: boolean;
}) {
  const [plan, setPlan] = useState<NextEventPlan>(initialPlan ?? {eventThisWeekend: true, multiplier: 1, byCategory: {}, byProduct: {}});
  const [pending, startTransition] = useTransition();

  const surgeSummary = useMemo(() => {
    if (!config) return null;
    return computeSurge(forecastRows, plan, config).summary;
  }, [forecastRows, plan, config]);

  function commit(next: NextEventPlan) {
    setPlan(next);
    if (usingMock) return;
    startTransition(async () => {
      await setNextEventPlanAction(next);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        <Chip stripe="bg-emerald-500" value={summary.healthy} label="Healthy" />
        <Chip stripe="bg-amber-500" value={summary.low} label="Low" />
        <Chip stripe="bg-red-500" value={summary.out} label="Out" />
        <Chip stripe="bg-muted-foreground" value={summary.unlisted} label="Unlisted" />
      </div>

      {config && surgeSummary && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3">
              <TrendingUp className="size-5 text-amber-600 dark:text-amber-400" />
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Next event <span className="font-mono text-xs font-normal text-amber-700 dark:text-amber-300">· {surgeSummary.nextEventLabel}</span>
                </div>
                <div className="text-xs text-muted-foreground">Will current stock survive the expected surge?</div>
              </div>
            </div>
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={plan.eventThisWeekend} onChange={(e) => commit({...plan, eventThisWeekend: e.target.checked})} className="size-4 accent-amber-600" />
              Event this weekend
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Expected volume</span>
              <span className="inline-flex items-center overflow-hidden rounded-md border bg-background">
                <button type="button" aria-label="Decrease" onClick={() => commit({...plan, multiplier: Math.max(1, plan.multiplier - 1)})} className="px-2.5 py-1 text-muted-foreground hover:text-foreground">−</button>
                <span className="min-w-[38px] border-x px-2 py-1 text-center font-mono text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{plan.multiplier}×</span>
                <button type="button" aria-label="Increase" onClick={() => commit({...plan, multiplier: plan.multiplier + 1})} className="px-2.5 py-1 text-muted-foreground hover:text-foreground">+</button>
              </span>
            </div>
            <div className="ml-auto text-sm">
              {surgeSummary.shortCount > 0 ? (
                <span><b className="text-red-600 dark:text-red-400">{surgeSummary.shortCount} product{surgeSummary.shortCount > 1 ? 's' : ''}</b> won&apos;t sustain{surgeSummary.restockByLabel && <> · restock by <b>{surgeSummary.restockByLabel}</b></>}</span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">All products sustain the expected surge ✓</span>
              )}
            </div>
          </div>
          {pending && <div className="mt-2 text-xs text-muted-foreground">Saving…</div>}
        </div>
      )}

      {config && <StockSettingsForm config={config} usingMock={usingMock} />}

      <BundleControls bundles={bundles} />
    </div>
  );
}

function Chip({stripe, value, label}: {stripe: string; value: number; label: string}) {
  return (
    <div className="flex min-w-[112px] flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className={cn('h-8 w-1 rounded-full', stripe)} />
      <div>
        <div className="text-xl font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
