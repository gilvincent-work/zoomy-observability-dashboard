'use client';

// Sampling panel (free tastes). Shows the 30-day summary (units + logged count, with
// an oversold flag) then lists each recent free taste as its own row with a small X to
// undo it. The X opens a confirmation modal (void_free_taste restores the Event stock)
// so a misclicked product can be reverted without a wordy toggle. Freebies are logged
// only, never counted in sales / units / revenue.

import {useEffect, useId, useRef, useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {createPortal} from 'react-dom';
import {Dog, Undo2, X} from 'lucide-react';
import {voidFreeTasteAction} from '@/src/pos-free-taste-actions';
import type {FreeTasteSummary, RecentFreeTaste} from '@/src/pos-free-taste-data';

export function SamplingPanel({sampling}: {sampling: FreeTasteSummary}) {
  const [confirming, setConfirming] = useState<RecentFreeTaste | null>(null);

  if (sampling.totalCount === 0) return null;

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

      {sampling.recent.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y border-t pt-1">
          {sampling.recent.map((r, i) => (
            <li key={(r.client_uuid ?? 'x') + i} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium">{r.qty}× {r.product_name}</span>
                {r.oversold && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">low stock</span>}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {new Date(r.opened_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}
                </span>
              </div>
              {r.client_uuid ? (
                <button
                  type="button"
                  onClick={() => setConfirming(r)}
                  aria-label={`Undo ${r.qty} ${r.product_name}`}
                  title="Undo this free taste (restores Event stock)"
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <span className="shrink-0 p-1 text-muted-foreground/40" title="Cannot undo (no reference)" aria-hidden>
                  <X className="size-3.5" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirming && <UndoConfirmModal taste={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

// Confirm before voiding a free taste. Portalled modal in the incumbent style; the
// firedRef guard keeps a double-click from voiding twice while the transition runs.
function UndoConfirmModal({taste, onClose}: {taste: RecentFreeTaste; onClose: () => void}) {
  const titleId = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const firedRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function confirm() {
    if (firedRef.current || !taste.client_uuid) return;
    firedRef.current = true;
    startTransition(async () => {
      await voidFreeTasteAction(taste.client_uuid as string);
      router.refresh();
      onClose();
    });
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <Undo2 className="size-4" /> Undo free taste
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">
            Undo this free taste? This restores {taste.qty} to Event stock.
          </p>
          <p className="mt-2 text-sm font-medium">{taste.qty}× {taste.product_name}</p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">🔒 recorded with your account · now</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Undoing…' : 'Undo'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
