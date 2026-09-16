'use client';

// Stock history (Q19) — the Add-stock receipts surfaced two ways: a global panel
// ("what's been added lately") and a per-product drawer opened from a forecast
// row. Stock-ins only (reason receipt / add-void). The latest add carries an
// Undo (void-last-add, Q20). Both read the same pos_stock_movements rows.

import {useEffect, useId, useState, useTransition} from 'react';
import {createPortal} from 'react-dom';
import {ScrollText, Undo2, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import type {StockReceipt} from '@/src/pos-stock-intake';
import {voidLastAddAction} from '@/src/pos-stock-intake-actions';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

function Row({r}: {r: StockReceipt}) {
  const reversal = r.reason === 'add-void';
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 border-b py-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{r.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{r.product_id}</div>
      </div>
      <div className={cn('font-mono text-sm font-bold tabular-nums', reversal ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
        {reversal ? '' : '+'}
        {r.delta}
      </div>
      <div className="text-right font-mono text-[10.5px] leading-tight text-muted-foreground">
        <span className="block font-semibold text-foreground/80">{r.created_by ?? 'unknown'}</span>
        {when(r.created_at)}
      </div>
    </div>
  );
}

/** Global recent-adds panel for the Inventory page. */
export function StockHistoryPanel({receipts}: {receipts: StockReceipt[]}) {
  return (
    <Card className="mt-5">
      <CardContent className="py-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <ScrollText className="size-3.5" /> Stock history
        </h3>
        {receipts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No stock added yet.</p>
        ) : (
          <div className="mt-2">
            {receipts.slice(0, 8).map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Per-product drawer with that SKU's adds, a running total, and Undo on the latest. */
export function StockHistoryDrawer({
  product,
  receipts,
  onClose,
}: {
  product: {product_id: string; name: string; stock: number};
  receipts: StockReceipt[];
  onClose: () => void;
}) {
  const titleId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mine = receipts.filter((r) => r.product_id === product.product_id);
  const total = mine.reduce((s, r) => s + r.delta, 0);
  const receiptCount = mine.filter((r) => r.reason === 'receipt').length;
  // Undo targets the latest receipt only if it hasn't already been reversed.
  const latest = mine[0];
  const canUndo = latest?.reason === 'receipt';

  function undo() {
    setError(null);
    startTransition(async () => {
      const res = await voidLastAddAction(product.product_id);
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-popover shadow-xl">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold">{product.name}</h2>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{product.product_id} · {product.stock} on hand</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">
              Stock added · {receiptCount} receipt{receiptCount === 1 ? '' : 's'} · {total >= 0 ? '+' : ''}{total} net
            </span>
            {canUndo && (
              <button
                type="button"
                onClick={undo}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/60 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                <Undo2 className="size-3" /> {pending ? 'Undoing…' : 'Undo last add'}
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {mine.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No recent stock adds for this product.</p>
          ) : (
            mine.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b py-3 last:border-0">
                <span className="text-sm font-medium">{r.reason === 'add-void' ? 'Reversed add' : 'Added stock'}</span>
                <span
                  className={cn(
                    'font-mono text-sm font-bold tabular-nums',
                    r.reason === 'add-void' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {r.reason === 'add-void' ? '' : '+'}
                  {r.delta}
                </span>
                <span className="w-40 text-right font-mono text-[10.5px] leading-tight text-muted-foreground">
                  <span className="block font-semibold text-foreground/80">{r.created_by ?? 'unknown'}</span>
                  {when(r.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
