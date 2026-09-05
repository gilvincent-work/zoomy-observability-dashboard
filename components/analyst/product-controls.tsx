'use client';

import {useState, useTransition} from 'react';
import {Boxes, Check, Pencil, Plus, X} from 'lucide-react';
import type {PosProductRow} from '@/src/pos-types';
import {formatPeso, lineLabel, stockLabel} from '@/src/pos-format';
import {
  createProductAction,
  renameProductAction,
  repriceProductAction,
  setListingAction,
  type ActionResult,
} from '@/src/pos-actions';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {cn} from '@/lib/utils';
import {Eyebrow, MockNote} from './sections';

type EditField = 'name' | 'price' | null;

function StockBadge({stock}: {stock: number}) {
  const label = stockLabel(stock);
  if (label === 'out') return <Badge variant="destructive">Out</Badge>;
  if (label === 'low') return <Badge variant="secondary">{stock} left</Badge>;
  return <span className="tabular-nums text-sm text-muted-foreground">{stock}</span>;
}

export function ProductControls({products, usingMock}: {products: PosProductRow[]; usingMock: boolean}) {
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Render straight from props: each action calls revalidatePath('/products'),
  // so a successful edit re-renders this server-rendered tree with fresh data.
  function run(action: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) onOk?.();
      else setError(res.error);
    });
  }

  const listed = products.filter((r) => r.active).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Eyebrow icon={Boxes}>Product Controls</Eyebrow>
          <p className="text-sm text-muted-foreground">
            {products.length} products · {listed} listed. Create products, rename, reprice, and list/unlist.
            Edits sync to the POS in-database.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((c) => !c)}>
          {creating ? <X /> : <Plus />}
          {creating ? 'Cancel' : 'New product'}
        </Button>
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

      {creating && (
        <NewProductForm
          pending={isPending}
          onSubmit={(input, done) =>
            run(
              () => createProductAction(input),
              () => {
                setCreating(false);
                done();
              },
            )
          }
        />
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">SKU</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Line</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-4 py-2.5 text-right font-medium">Listed</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <ProductRow
                    key={row.product_id}
                    row={row}
                    pending={isPending}
                    onRename={(name, done) => run(() => renameProductAction(row.product_id, name), done)}
                    onReprice={(price, done) => run(() => repriceProductAction(row.product_id, price), done)}
                    onToggle={() => run(() => setListingAction(row.product_id, !row.active))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductRow({
  row,
  pending,
  onRename,
  onReprice,
  onToggle,
}: {
  row: PosProductRow;
  pending: boolean;
  onRename: (name: string, done: () => void) => void;
  onReprice: (price: string, done: () => void) => void;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState<EditField>(null);
  const [draft, setDraft] = useState('');

  function begin(field: EditField, current: string) {
    setEditing(field);
    setDraft(current);
  }

  function save() {
    if (editing === 'name') onRename(draft, () => setEditing(null));
    else if (editing === 'price') onReprice(draft, () => setEditing(null));
  }

  return (
    <tr className={cn('border-b last:border-0', !row.active && 'opacity-55')}>
      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.product_id}</td>
      <td className="px-4 py-2.5">
        {editing === 'name' ? (
          <EditCell
            value={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setEditing(null)}
            pending={pending}
          />
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
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{lineLabel(row.product_line ?? '')}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {editing === 'price' ? (
          <EditCell
            value={draft}
            onChange={setDraft}
            onSave={save}
            onCancel={() => setEditing(null)}
            pending={pending}
            numeric
          />
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
      <td className="px-4 py-2.5 text-right">
        <StockBadge stock={row.stock} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          role="switch"
          aria-checked={row.active}
          aria-label={row.active ? `Unlist ${row.name}` : `List ${row.name}`}
          disabled={pending}
          onClick={onToggle}
          className={cn(
            'relative inline-block h-5 w-9 rounded-full transition-colors disabled:opacity-50',
            row.active ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform',
              row.active ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </td>
    </tr>
  );
}

function EditCell({
  value,
  onChange,
  onSave,
  onCancel,
  pending,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  numeric?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'decimal' : 'text'}
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave();
          if (e.key === 'Escape') onCancel();
        }}
        className={cn(
          'h-7 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring',
          numeric ? 'w-24 text-right' : 'w-48',
        )}
      />
      <Button size="icon-sm" variant="ghost" onClick={onSave} disabled={pending} aria-label="Save">
        <Check />
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={onCancel} disabled={pending} aria-label="Cancel">
        <X />
      </Button>
    </span>
  );
}

function NewProductForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (
    input: {product_id: string; name: string; product_line?: string; price?: string},
    done: () => void,
  ) => void;
}) {
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [price, setPrice] = useState('');

  function reset() {
    setProductId('');
    setName('');
    setLine('');
    setPrice('');
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
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="FDR / JRK / MEAT"
            className="h-8 w-32 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
          />
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
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            onSubmit(
              {product_id: productId, name, product_line: line || undefined, price: price || undefined},
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
