'use client';

// Prizes panel (spin-a-wheel free items). Lists which transactions / customers won
// a free item, with an undo, and an "Add prize" modal to backfill a past order.
// A prize deducts the Event pool (reason='free_item'), separate from sales. The POS
// tags prizes live in the cart; this is the online / backfill path.

import {useEffect, useId, useState, useTransition} from 'react';
import {createPortal} from 'react-dom';
import {useRouter} from 'next/navigation';
import {Gift, Undo2, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {addPrizeAction, voidPrizeAction} from '@/src/pos-prize-actions';
import type {PrizeRow, RecentOrder, PrizeProduct} from '@/src/pos-prize-data';

const DELTAS = [1, 2, 5];

export function PrizePanel({prizes, recentOrders, products}: {prizes: PrizeRow[]; recentOrders: RecentOrder[]; products: PrizeProduct[]}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pendingVoid, startVoid] = useTransition();
  const [voidId, setVoidId] = useState<string | null>(null);
  const active = prizes.filter((p) => !p.voided_at);

  function undo(clientUuid: string | null) {
    if (!clientUuid) return;
    setVoidId(clientUuid);
    startVoid(async () => {
      await voidPrizeAction(clientUuid);
      setVoidId(null);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Gift className="size-3.5" /> Free items won
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Spin-a-wheel prizes given with a sale. {active.length} logged.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Gift className="size-3.5" /> Add prize
        </button>
      </div>

      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          No free items logged yet. Use Add prize to record a spin-a-wheel win on a past order.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {active.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm">
                  <span className="font-medium">{p.customer_handle?.trim() || 'Walk-in'}</span>
                  <span className="text-muted-foreground"> won </span>
                  <span className="font-medium">{p.qty}× {p.product_name}</span>
                  {p.oversold && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-amber-600 dark:text-amber-400">low stock</span>}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {new Date(p.won_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}
                  {p.note ? ` · ${p.note}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => undo(p.client_uuid)}
                disabled={!p.client_uuid || (pendingVoid && voidId === p.client_uuid)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                title={p.client_uuid ? 'Undo this prize (restores stock)' : 'Cannot undo (no reference)'}
              >
                <Undo2 className="size-3" /> {pendingVoid && voidId === p.client_uuid ? 'Undoing…' : 'Undo'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && <AddPrizeModal recentOrders={recentOrders} products={products} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddPrizeModal({recentOrders, products, onClose}: {recentOrders: RecentOrder[]; products: PrizeProduct[]; onClose: () => void}) {
  const titleId = useId();
  const router = useRouter();
  const [orderUuid, setOrderUuid] = useState('');
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ok: boolean; text: string} | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const picked = products.find((p) => p.product_id === sku);
  const canSubmit = Boolean(orderUuid) && Boolean(sku) && qty > 0;

  function submit() {
    if (!canSubmit) return;
    setMsg(null);
    startTransition(async () => {
      const res = await addPrizeAction({orderClientUuid: orderUuid, sku, qty, note});
      if (res.ok) {
        setMsg({ok: true, text: `Prize logged${res.oversold ? ' (opened against 0 on-hand).' : '.'}`});
        setSku('');
        setQty(1);
        setDraft(null);
        setNote('');
        router.refresh();
      } else {
        setMsg({ok: false, text: res.error});
      }
    });
  }

  if (typeof document === 'undefined') return null;
  const qtyValue = draft ?? (qty === 0 ? '' : String(qty));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <Gift className="size-4" /> Add a free item
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-xs text-muted-foreground">
            Attach a spin-a-wheel prize to a past sale. It deducts the Event pool and is logged as a giveaway, separate from sales.
          </p>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Order that won</span>
            <select
              value={orderUuid}
              onChange={(e) => {
                setOrderUuid(e.target.value);
                setMsg(null);
              }}
              aria-label="Select order"
              className={cn('w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring', !orderUuid && 'text-muted-foreground')}
            >
              <option value="">Select order…</option>
              {recentOrders.map((o) => (
                <option key={o.client_uuid} value={o.client_uuid}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Prize product</span>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              aria-label="Select product"
              className={cn('w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring', !sku && 'text-muted-foreground')}
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.product_id} value={p.product_id}>{p.name}</option>
              ))}
            </select>
            {picked && <span className="mt-1.5 block font-mono text-[10px] text-muted-foreground">{picked.event} on hand at Event</span>}
          </label>

          <div className={cn('mt-4', !sku && 'pointer-events-none opacity-40')}>
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Quantity</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                value={qtyValue}
                aria-label="Quantity"
                placeholder="1"
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, '');
                  setDraft(v);
                  setQty(v === '' ? 0 : parseInt(v, 10));
                }}
                onBlur={() => setDraft(null)}
                className="w-20 rounded-lg border-2 border-primary bg-background px-2 py-1.5 text-center font-mono text-[15px] font-bold tabular-nums text-primary outline-none"
              />
              {DELTAS.map((d) => (
                <button key={d} type="button" onClick={() => setQty((q) => q + d)} className="min-w-[38px] rounded-md border px-2 py-1.5 font-mono text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                  +{d}
                </button>
              ))}
            </div>
            {picked && qty > picked.event && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">More than the {picked.event} on hand. It will still log and flag as opened against low stock.</p>
            )}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Note <span className="opacity-60">(optional)</span></span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. grand-prize spin" className="w-full rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring" />
          </label>

          {msg && <p className={cn('mt-3 text-xs', msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>{msg.text}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">🔒 recorded with your account · now</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !canSubmit}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Logging…' : 'Log prize'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
