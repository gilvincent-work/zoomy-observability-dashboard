'use client';

// Sampling panel (free tastes). Shows the 30-day summary + top sampled products,
// and a recent list with an Undo per row (void_free_taste restores the Event
// stock) so a misclicked product can be reverted. Freebies are logged only, never
// counted in sales/units/revenue.

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Dog, Undo2} from 'lucide-react';
import {cn} from '@/lib/utils';
import {voidFreeTasteAction} from '@/src/pos-free-taste-actions';
import type {FreeTasteSummary} from '@/src/pos-free-taste-data';

export function SamplingPanel({sampling}: {sampling: FreeTasteSummary}) {
  const router = useRouter();
  const [showRecent, setShowRecent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  if (sampling.totalCount === 0) return null;

  function undo(clientUuid: string | null) {
    if (!clientUuid) return;
    setBusy(clientUuid);
    startTransition(async () => {
      await voidFreeTasteAction(clientUuid);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Dog className="size-3.5" /> Sampling · last {sampling.windowDays} days
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          <span className="tabular-nums text-foreground">{sampling.totalUnits}</span> units ·{' '}
          <span className="tabular-nums">{sampling.totalCount}</span> logged
          {sampling.oversoldCount > 0 && (
            <> · <span className="tabular-nums text-amber-600 dark:text-amber-400">{sampling.oversoldCount}</span> vs low stock</>
          )}
        </span>
      </div>

      {sampling.byProduct.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sampling.byProduct.slice(0, 6).map((p) => (
            <span key={p.product_id} className="inline-flex items-baseline gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
              <span className="text-foreground">{p.name}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{p.units}</span>
            </span>
          ))}
        </div>
      )}

      {sampling.recent.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showRecent ? 'Hide' : 'Undo a misclick'} · recent free tastes
          </button>
          {showRecent && (
            <ul className="mt-2 flex flex-col divide-y">
              {sampling.recent.map((r, i) => (
                <li key={(r.client_uuid ?? 'x') + i} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{r.qty}× {r.product_name}</span>
                    {r.oversold && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">low stock</span>}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      {new Date(r.opened_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => undo(r.client_uuid)}
                    disabled={!r.client_uuid || (pending && busy === r.client_uuid)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    title={r.client_uuid ? 'Undo this free taste (restores Event stock)' : 'Cannot undo (no reference)'}
                  >
                    <Undo2 className="size-3" /> {pending && busy === r.client_uuid ? 'Undoing…' : 'Undo'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
