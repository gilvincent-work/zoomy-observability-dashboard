'use client';

// Add stock: a dynamic multi-product form (Q18). Click "Add product" to spawn a
// line with its own product picker; each picked product drops out of the other
// lines' menus (no duplicates). The qty field takes numbers-only keyboard input
// plus -20/-10/-5/-1 / +1/+5/+10/+20 quick-steps. "Update" commits the whole
// batch all-or-nothing via addStockAction (→ add_pos_stock RPC). Reused on the
// Inventory forecast and the Products page.

import {useEffect, useId, useState, useTransition} from 'react';
import {createPortal} from 'react-dom';
import {Package, Plus, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {addStockAction, type StockLocation} from '@/src/pos-stock-intake-actions';

export interface IntakeProduct {
  product_id: string;
  name: string;
  stock: number;
}

interface Line {
  key: number;
  sku: string; // '' until picked
  qty: number;
}

const DELTAS = [-20, -10, -5, -1, 1, 5, 10, 20];

export function AddStockButton({products, className}: {products: IntakeProduct[]; className?: string}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90',
          className,
        )}
      >
        <Plus className="size-3.5" /> Add stock
      </button>
      {open && <AddStockModal products={products} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddStockModal({products, onClose}: {products: IntakeProduct[]; onClose: () => void}) {
  const titleId = useId();
  const [lines, setLines] = useState<Line[]>([{key: 1, sku: '', qty: 1}]);
  const [seq, setSeq] = useState(2);
  const [location, setLocation] = useState<StockLocation>('office');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ok: boolean; text: string} | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byId = new Map(products.map((p) => [p.product_id, p]));
  const usedSkus = (exceptKey: number) => new Set(lines.filter((l) => l.key !== exceptKey && l.sku).map((l) => l.sku));
  const validCount = lines.filter((l) => l.sku && l.qty > 0).length;

  function addLine() {
    if (lines.filter((l) => l.sku).length >= products.length) return;
    setMsg(null);
    setLines((ls) => [...ls, {key: seq, sku: '', qty: 1}]);
    setSeq((s) => s + 1);
  }
  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? {...l, ...patch} : l)));
  }
  function remove(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }
  function submit() {
    setMsg(null);
    const payload = lines.filter((l) => l.sku && l.qty > 0).map((l) => ({sku: l.sku, qty: l.qty}));
    if (payload.length === 0) return;
    startTransition(async () => {
      const res = await addStockAction(payload, location);
      if (res.ok) {
        const units = payload.reduce((s, l) => s + l.qty, 0);
        const where = location === 'event' ? 'Event' : 'Office';
        setMsg({ok: true, text: `Added ${units} units across ${res.count} product${res.count > 1 ? 's' : ''} to ${where}.`});
        setLines([{key: seq, sku: '', qty: 1}]);
        setSeq((s) => s + 1);
      } else {
        setMsg({ok: false, text: res.error});
      }
    });
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
            <Package className="size-4" /> Add stock
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Each line picks a product and a quantity. On Update, every line is recorded as a receipt in the stock ledger.
          </p>

          <div className="mb-4">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Receive into</span>
            <div className="inline-flex rounded-lg border bg-muted/40 p-1">
              {(['office', 'event'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocation(loc)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    location === loc ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {loc === 'office' ? 'Office' : 'Event'}
                  <span className="ml-1.5 font-mono text-[9px] opacity-70">{loc === 'office' ? 'back-stock' : 'sellable'}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {location === 'office'
                ? 'Lands in Office back-stock. Use Move stock to send units to Event for the POS to sell.'
                : 'Lands directly in Event — immediately sellable at the POS.'}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {lines.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No lines yet — click Add product to start.</p>}
            {lines.map((line) => (
              <LineCard
                key={line.key}
                line={line}
                products={products}
                unavailable={usedSkus(line.key)}
                meta={line.sku ? byId.get(line.sku) : undefined}
                onSku={(sku) => update(line.key, {sku})}
                onQty={(qty) => update(line.key, {qty})}
                onRemove={() => remove(line.key)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addLine}
            className="mt-3 w-full rounded-lg border border-dashed border-primary/60 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            + Add product
          </button>
          {msg && <p className={cn('mt-3 text-xs', msg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>{msg.text}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">🔒 recorded with your account · now</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || validCount === 0}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Updating…' : validCount > 0 ? `Update · ${validCount} item${validCount > 1 ? 's' : ''}` : 'Update'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LineCard({
  line,
  products,
  unavailable,
  meta,
  onSku,
  onQty,
  onRemove,
}: {
  line: Line;
  products: IntakeProduct[];
  unavailable: Set<string>;
  meta: IntakeProduct | undefined;
  onSku: (sku: string) => void;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const qtyValue = draft ?? String(line.qty);
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <select
          value={line.sku}
          onChange={(e) => onSku(e.target.value)}
          aria-label="Select product"
          className={cn(
            'flex-1 rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring',
            !line.sku && 'text-muted-foreground',
          )}
        >
          <option value="">Select product…</option>
          {products
            .filter((p) => p.product_id === line.sku || !unavailable.has(p.product_id))
            .map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.name}
              </option>
            ))}
        </select>
        <button type="button" onClick={onRemove} aria-label="Remove line" className="p-1 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {meta && <div className="mt-2 px-0.5 font-mono text-[10px] text-muted-foreground">{meta.product_id} · {meta.stock} on hand</div>}

      <div className={cn('mt-3 flex flex-wrap items-center gap-1.5', !line.sku && 'pointer-events-none opacity-30')}>
        {DELTAS.slice(0, 4).map((d) => (
          <QtyStep key={d} d={d} onClick={() => onQty(Math.max(0, line.qty + d))} />
        ))}
        <input
          type="text"
          inputMode="numeric"
          value={qtyValue}
          aria-label="Quantity"
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '');
            setDraft(v);
            onQty(v === '' ? 0 : parseInt(v, 10));
          }}
          onBlur={() => {
            if (draft === '') onQty(0);
            setDraft(null);
          }}
          className="mx-1 w-16 rounded-lg border-2 border-primary bg-background px-2 py-1.5 text-center font-mono text-[15px] font-bold tabular-nums text-primary outline-none"
        />
        {DELTAS.slice(4).map((d) => (
          <QtyStep key={d} d={d} onClick={() => onQty(Math.max(0, line.qty + d))} />
        ))}
      </div>
    </div>
  );
}

function QtyStep({d, onClick}: {d: number; onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-[34px] rounded-md border px-2 py-1.5 font-mono text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      {d > 0 ? `+${d}` : d}
    </button>
  );
}
