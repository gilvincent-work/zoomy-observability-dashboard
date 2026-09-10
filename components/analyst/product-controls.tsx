'use client';

import {useEffect, useId, useRef, useState, useTransition} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle, Boxes, Check, Pencil, Plus, Undo2, X} from 'lucide-react';
import type {PosProductRow} from '@/src/pos-types';
import {formatPeso, lineLabel, POS_CATEGORIES, POS_SUBCATEGORIES, PRODUCT_LINES, SUBCATEGORY_CATEGORY, stockLabel} from '@/src/pos-format';
import {
  createProductAction,
  renameProductAction,
  repriceProductAction,
  setCategoryAction,
  setEmojiAction,
  setLineAction,
  setListingAction,
  setStockAction,
  type ActionResult,
} from '@/src/pos-actions';
import {EmojiPicker} from './emoji-picker';
import {ProductFilters} from './product-filters';
import {RefreshControl} from './refresh-control';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';
import {Eyebrow, MockNote} from './sections';
import {DEFAULT_PRODUCT_FILTER, filterProductRows, productStockMax, type ProductFilter} from '@/src/pos-product-filter';

type EditField = 'name' | 'price' | 'stock' | null;

function StockBadge({stock}: {stock: number}) {
  const label = stockLabel(stock);
  if (label === 'out') return <Badge variant="destructive">Out</Badge>;
  if (label === 'low') return <Badge variant="secondary">{stock} left</Badge>;
  return <span className="tabular-nums text-sm text-muted-foreground">{stock}</span>;
}

export function ProductControls({
  products,
  usingMock,
  fetchedAt,
}: {
  products: PosProductRow[];
  usingMock: boolean;
  fetchedAt: string;
}) {
  // Mirror the server data locally so edits can apply optimistically (instant),
  // then reconcile. revalidatePath in each action re-renders this tree with fresh
  // props; this effect re-syncs to whatever the server confirmed. The Refresh
  // button (RefreshControl) triggers a plain router.refresh(), which lands here
  // as a new `products` prop — same path, no separate refetch logic needed.
  const [rows, setRows] = useState(products);
  useEffect(() => setRows(products), [products]);

  const [filter, setFilter] = useState<ProductFilter>(DEFAULT_PRODUCT_FILTER);
  const filteredRows = filterProductRows(rows, filter);
  const stockMax = productStockMax(rows);

  // `error` now covers only product creation (which has no row to anchor to).
  // Per-row edit results live in `status`, keyed by product_id, so a failure is
  // shown under the row that caused it and a success flashes a "Saved" chip.
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, {saved?: boolean; error?: string}>>({});
  const [toast, setToast] = useState<{message: string; onUndo: () => void} | null>(null);
  const [creating, setCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      Object.values(savedTimers.current).forEach(clearTimeout);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  function clearStatus(id: string) {
    setStatus((s) => {
      if (!s[id]) return s;
      const next = {...s};
      delete next[id];
      return next;
    });
  }

  // A transient "Saved" chip on the row, cleared after a couple of seconds.
  function flashSaved(id: string) {
    setStatus((s) => ({...s, [id]: {saved: true}}));
    clearTimeout(savedTimers.current[id]);
    savedTimers.current[id] = setTimeout(() => clearStatus(id), 2200);
  }

  // One undo toast at a time; auto-dismisses so it never blocks the table.
  function showToast(message: string, onUndo: () => void) {
    setToast({message, onUndo});
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }
  function dismissToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }

  // Apply a patch to one row immediately; run the server action; on failure,
  // roll the whole list back and anchor the error to the row; on success,
  // flash a "Saved" chip and run any follow-up (e.g. the unlist undo toast).
  function mutate(
    id: string,
    patch: Partial<PosProductRow>,
    action: () => Promise<ActionResult>,
    opts?: {onOk?: () => void},
  ) {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.product_id === id ? {...r, ...patch} : r)));
    clearStatus(id);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setRows(prev);
        setStatus((s) => ({...s, [id]: {error: res.error}}));
      } else {
        flashSaved(id);
        opts?.onOk?.();
      }
    });
  }

  // Listing changes route through here so unlisting (destructive) earns an undo
  // toast. Listing again is safe and silent beyond the "Saved" chip.
  function setListing(row: PosProductRow, next: boolean) {
    mutate(
      row.product_id,
      {active: next},
      () => setListingAction(row.product_id, next),
      next ? undefined : {onOk: () => showToast(`“${row.name}” unlisted`, () => setListing(row, true))},
    );
  }

  function create(
    input: {
      product_id: string;
      name: string;
      product_line?: string;
      category?: string;
      subcategory?: string;
      price?: string;
      stock?: string;
    },
    onOk: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await createProductAction(input);
      if (res.ok) {
        setCreating(false);
        onOk();
      } else {
        setError(res.error);
      }
    });
  }

  const listed = rows.filter((r) => r.active).length;
  const showingFiltered = filteredRows.length !== rows.length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Eyebrow icon={Boxes}>Product Controls</Eyebrow>
          <p className="text-sm text-muted-foreground">
            {showingFiltered ? (
              <>
                {filteredRows.length} of {rows.length} products
              </>
            ) : (
              <>
                {rows.length} products · {listed} listed
              </>
            )}
            . Create products, rename, reprice, and list/unlist. Edits sync to the POS in-database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshControl fetchedAt={fetchedAt} />
          <Button size="sm" onClick={() => setCreating((c) => !c)}>
            {creating ? <X /> : <Plus />}
            {creating ? 'Cancel' : 'New product'}
          </Button>
        </div>
      </div>

      {usingMock && (
        <MockNote>
          Mock catalog — set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to
          the Staging project to load and edit real <code>pos_*</code> data.
        </MockNote>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {creating && <NewProductForm pending={isPending} onSubmit={create} />}

      <ProductFilters filter={filter} onChange={setFilter} stockMax={stockMax} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 text-center font-medium">Emoji</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Line</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-4 py-2.5 text-right font-medium">Listed</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      No products match these filters.
                    </td>
                  </tr>
                )}
                {filteredRows.map((row) => {
                  const st = status[row.product_id];
                  return (
                    <ProductRow
                      key={row.product_id}
                      row={row}
                      saved={st?.saved}
                      error={st?.error}
                      onDismissError={() => clearStatus(row.product_id)}
                      onRename={(name) =>
                        mutate(row.product_id, {name}, () => renameProductAction(row.product_id, name))
                      }
                      onReprice={(price) => {
                        const n = Number(price);
                        const patch = Number.isFinite(n) && n > 0 ? {price: n} : {};
                        mutate(row.product_id, patch, () => repriceProductAction(row.product_id, price));
                      }}
                      onSetListing={(next) => setListing(row, next)}
                      onSetStock={(qty) => {
                        const n = Number(qty);
                        const patch = Number.isInteger(n) && n >= 0 ? {stock: n} : {};
                        mutate(row.product_id, patch, () => setStockAction(row.product_id, qty));
                      }}
                      onSetCategory={(category, subcategory) =>
                        mutate(
                          row.product_id,
                          {category: category || null, subcategory: subcategory || null},
                          () => setCategoryAction(row.product_id, category, subcategory),
                        )
                      }
                      onSetLine={(line) =>
                        mutate(row.product_id, {product_line: line || null}, () =>
                          setLineAction(row.product_id, line),
                        )
                      }
                      onSetEmoji={(emoji) => {
                        // The picker already returns a clamped value; skip empty
                        // (the picker never commits empty, but guard anyway).
                        if (!emoji) return;
                        mutate(row.product_id, {emoji}, () => setEmojiAction(row.product_id, emoji));
                      }}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" role="status" aria-live="polite">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-popover px-4 py-2.5 text-sm shadow-lg">
            <span className="text-foreground">{toast.message}</span>
            <button
              type="button"
              onClick={() => {
                toast.onUndo();
                dismissToast();
              }}
              className="inline-flex items-center gap-1.5 font-medium text-primary transition-opacity hover:opacity-80"
            >
              <Undo2 className="size-3.5" /> Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  row,
  saved,
  error,
  onDismissError,
  onRename,
  onReprice,
  onSetListing,
  onSetStock,
  onSetLine,
  onSetCategory,
  onSetEmoji,
}: {
  row: PosProductRow;
  saved?: boolean;
  error?: string;
  onDismissError: () => void;
  onRename: (name: string) => void;
  onReprice: (price: string) => void;
  onSetListing: (next: boolean) => void;
  onSetStock: (qty: string) => void;
  onSetLine: (line: string) => void;
  onSetCategory: (category: string, subcategory: string) => void;
  onSetEmoji: (emoji: string) => void;
}) {
  const [editing, setEditing] = useState<EditField>(null);
  const [draft, setDraft] = useState('');
  // Unlisting hides a product from the POS, so it asks first — inline, not a
  // modal. Listing again is non-destructive and applies immediately.
  const [confirmUnlist, setConfirmUnlist] = useState(false);

  function begin(field: EditField, current: string) {
    setEditing(field);
    setDraft(current);
  }

  // Close the editor immediately and let the parent apply the change
  // optimistically — no waiting on the server round-trip.
  function save() {
    const value = draft.trim();
    if (editing === 'name' && value) onRename(value);
    else if (editing === 'price' && value) onReprice(value);
    else if (editing === 'stock' && value !== '') onSetStock(value);
    setEditing(null);
  }

  return (
    <>
      <tr className={cn('border-b', error ? 'border-transparent' : 'last:border-0', !row.active && 'opacity-55')}>
        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.product_id}</td>
        <td className="px-4 py-2.5 text-center">
          <EmojiPicker
            value={row.emoji ?? ''}
            onCommit={(next) => onSetEmoji(next)}
            ariaLabel={`Edit emoji for ${row.name}`}
          />
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {editing === 'name' ? (
              <EditCell value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(null)} />
            ) : (
              <button
                type="button"
                className="group flex items-center gap-1.5 text-left hover:text-primary"
                onClick={() => begin('name', row.name)}
              >
                <span>{row.name}</span>
                <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
              </button>
            )}
            {saved && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                <Check className="size-3" /> Saved
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <LineSelect value={row.product_line ?? ''} onChange={onSetLine} />
        </td>
        <td className="px-4 py-2.5">
          <CategorySelect
            category={row.category ?? ''}
            subcategory={row.subcategory ?? ''}
            onChange={onSetCategory}
          />
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums">
          {editing === 'price' ? (
            <EditCell value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(null)} numeric />
          ) : (
            <button
              type="button"
              className="group inline-flex items-center gap-1.5 hover:text-primary"
              onClick={() => begin('price', row.price != null ? String(row.price) : '')}
            >
              <span>{formatPeso(row.price)}</span>
              <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          )}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums">
          {editing === 'stock' ? (
            <EditCell value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(null)} numeric />
          ) : (
            <button
              type="button"
              className="group inline-flex items-center gap-1.5 hover:text-primary"
              onClick={() => begin('stock', String(row.stock))}
            >
              <StockBadge stock={row.stock} />
              <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          )}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex justify-end">
            {/* Listing again is safe and immediate; unlisting hides the product
                from the POS, so it opens a confirm dialog (centered, no layout
                shift — the inline version pushed the row past the viewport). */}
            <button
              type="button"
              role="switch"
              aria-checked={row.active}
              aria-label={row.active ? `Unlist ${row.name}` : `List ${row.name}`}
              onClick={() => (row.active ? setConfirmUnlist(true) : onSetListing(true))}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
                row.active ? 'border-primary bg-primary' : 'border-border bg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left]',
                  row.active ? 'left-[calc(100%-1.125rem)]' : 'left-0.5',
                )}
              />
            </button>
          </div>
          {confirmUnlist && (
            <ConfirmDialog
              title={`Unlist “${row.name}”?`}
              body="Customers won’t see it in the POS until you list it again."
              confirmLabel="Unlist"
              onConfirm={() => {
                setConfirmUnlist(false);
                onSetListing(false);
              }}
              onCancel={() => setConfirmUnlist(false)}
            />
          )}
        </td>
      </tr>
      {error && (
        <tr className="border-b last:border-0">
          <td colSpan={7} className="px-4 pb-2.5">
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={onDismissError}
                aria-label="Dismiss error"
                className="shrink-0 transition-opacity hover:opacity-70"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * A small centered confirmation dialog for destructive actions (unlisting).
 * Portaled to <body> so it can't be clipped by the table's horizontal scroll,
 * dismissable by Escape or backdrop, with focus landing on the confirm button.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Cancel" onClick={onCancel} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-popover p-5 shadow-lg">
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EditCell({
  value,
  onChange,
  onSave,
  onCancel,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  numeric?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        className={cn(
          'h-7 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring',
          numeric ? 'w-24 text-right' : 'w-48',
        )}
      />
      {/* Prevent the input's onBlur from firing before the click registers. */}
      <Button size="icon-sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={onSave} aria-label="Save">
        <Check />
      </Button>
      <Button size="icon-sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} aria-label="Cancel">
        <X />
      </Button>
    </span>
  );
}

/** Inline Line picker — a native select of the static product lines. */
function LineSelect({value, onChange}: {value: string; onChange: (line: string) => void}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Product line"
      className="h-7 rounded-md border bg-background px-1.5 text-sm text-muted-foreground outline-none focus-visible:border-ring"
    >
      <option value="">—</option>
      {PRODUCT_LINES.map((l) => (
        <option key={l} value={l}>
          {lineLabel(l)}
        </option>
      ))}
    </select>
  );
}

/**
 * Inline Category picker — the POS tab, plus a subcategory select that only
 * appears for Freeze Dried (the sole category with subcategories). Changing the
 * category away from Freeze Dried clears the subcategory.
 */
function CategorySelect({
  category,
  subcategory,
  onChange,
}: {
  category: string;
  subcategory: string;
  onChange: (category: string, subcategory: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={category}
        onChange={(e) => onChange(e.target.value, e.target.value === SUBCATEGORY_CATEGORY ? subcategory : '')}
        aria-label="POS category"
        className="h-7 rounded-md border bg-background px-1.5 text-sm outline-none focus-visible:border-ring"
      >
        <option value="">Uncategorized</option>
        {POS_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {category === SUBCATEGORY_CATEGORY && (
        <select
          value={subcategory}
          onChange={(e) => onChange(category, e.target.value)}
          aria-label="POS subcategory"
          className="h-7 rounded-md border bg-background px-1.5 text-sm text-muted-foreground outline-none focus-visible:border-ring"
        >
          <option value="">— sub —</option>
          {POS_SUBCATEGORIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function NewProductForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (
    input: {
      product_id: string;
      name: string;
      product_line?: string;
      category?: string;
      subcategory?: string;
      emoji?: string;
      price?: string;
      stock?: string;
    },
    done: () => void,
  ) => void;
}) {
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [emoji, setEmoji] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');

  function reset() {
    setProductId('');
    setName('');
    setLine('');
    setCategory('');
    setSubcategory('');
    setEmoji('');
    setPrice('');
    setStock('');
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-end gap-3 py-4">
        <Field label="SKU Code">
          <input
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="ZMY…"
            className="h-8 w-44 rounded-md border bg-background px-2 font-mono text-sm outline-none focus-visible:border-ring"
          />
        </Field>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Product name"
            className="h-8 w-56 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
          />
        </Field>
        <Field label="Line">
          <select
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="h-8 w-32 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
          >
            <option value="">Select…</option>
            {PRODUCT_LINES.map((l) => (
              <option key={l} value={l}>
                {lineLabel(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              if (e.target.value !== SUBCATEGORY_CATEGORY) setSubcategory('');
            }}
            className="h-8 w-36 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
          >
            <option value="">Select…</option>
            {POS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {category === SUBCATEGORY_CATEGORY && (
          <Field label="Subcategory">
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="h-8 w-40 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
            >
              <option value="">Select…</option>
              {POS_SUBCATEGORIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Emoji">
          <EmojiPicker value={emoji} onChange={setEmoji} ariaLabel="Choose product emoji" />
        </Field>
        <Field label="Price">
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="₱"
            className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm outline-none focus-visible:border-ring"
          />
        </Field>
        <Field label="Stock">
          <input
            type="number"
            inputMode="numeric"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="0"
            className="h-8 w-20 rounded-md border bg-background px-2 text-right text-sm outline-none focus-visible:border-ring"
          />
        </Field>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            onSubmit(
              {
                product_id: productId,
                name,
                product_line: line || undefined,
                category: category || undefined,
                subcategory: subcategory || undefined,
                emoji: emoji || undefined,
                price: price || undefined,
                stock: stock || undefined,
              },
              reset,
            )
          }
        >
          <Plus />
          Create
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
