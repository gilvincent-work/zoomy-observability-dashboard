'use client';

import {useState, useTransition} from 'react';
import Link from 'next/link';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {ArrowLeft, Ban, ChevronLeft, ChevronRight, PawPrint, Pencil, Plus, Receipt, TriangleAlert, X} from 'lucide-react';
import type {PosOrder, PosOrdersFilter, PriceBounds, PosCatalogItem} from '@/src/pos-sales-types';
import {isFilterActive, type PageInfo} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodLabel, paymentMethodBadgeClass} from '@/src/pos-format';
import {voidOrderAction, editOrderAction} from '@/src/pos-sales-actions';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Eyebrow, MockNote} from './sections';
import {TransactionFilters} from './transaction-filters';
import {RefreshControl} from './refresh-control';

// Methods offered in the edit form's payment-method picker.
const EDIT_METHODS = ['cash', 'qrph', 'gcash', 'maya', 'card'];

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineOrdersView({
  orders,
  pageInfo,
  filter,
  bounds,
  catalog,
  usingMock,
  fetchedAt,
}: {
  orders: PosOrder[];
  pageInfo: PageInfo;
  filter: PosOrdersFilter;
  bounds: PriceBounds;
  catalog: PosCatalogItem[];
  usingMock: boolean;
  fetchedAt: string;
}) {
  const {page, totalPages, pageSize} = pageInfo;
  const firstOnPage = (page - 1) * pageSize;
  const filtered = isFilterActive(filter);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pageHref = (p: number) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('page', String(p));
    return `${pathname}?${params.toString()}`;
  };

  // Voiding is destructive (it restocks the sale), so it confirms first, then
  // re-fetches the server data so the row shows voided + totals update.
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const voidOrder = (o: PosOrder) => {
    if (o.status === 'voided') return;
    const ok = window.confirm(
      `Void this ₱${o.total.toLocaleString()} sale?\n\nIts items will be added back to stock. This can't be undone.`,
    );
    if (!ok) return;
    setVoidError(null);
    setVoidingId(o.client_uuid);
    startTransition(async () => {
      const res = await voidOrderAction(o.client_uuid);
      setVoidingId(null);
      if (!res.ok) setVoidError(res.error);
      else router.refresh();
    });
  };

  // The order currently open in the edit modal (null = closed).
  const [editing, setEditing] = useState<PosOrder | null>(null);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <Link href="/offline-sales" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Offline Sales
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow icon={Receipt}>All transactions</Eyebrow>
          <p className="text-sm text-muted-foreground">Every offline sale synced from the POS, newest first.</p>
        </div>
        <RefreshControl fetchedAt={fetchedAt} />
      </div>

      {usingMock && (
        <MockNote>
          Mock sales. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
          Staging project to load real <code>pos_orders</code>.
        </MockNote>
      )}

      <TransactionFilters filter={filter} bounds={bounds} />

      <Card>
        <CardContent className="p-0">
          {orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {filtered ? 'No transactions match these filters.' : 'No transactions yet.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {orders.map((o, i) => (
                <li key={o.id} className={cn('flex items-start gap-4 px-5 py-3.5', o.status === 'voided' && 'opacity-60')}>
                  <span className="mt-0.5 w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{firstOnPage + i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('text-sm font-medium', o.status === 'voided' && 'line-through')}>{timeLabel(o.created_at)}</span>
                      <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', paymentMethodBadgeClass(o.payment_method))}>
                        {paymentMethodLabel(o.payment_method)}
                      </span>
                      {o.customer_handle && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <PawPrint className="size-3" /> {o.customer_handle}
                        </span>
                      )}
                      {o.status === 'voided' && <Badge variant="destructive">voided</Badge>}
                      {o.edited_at && o.status !== 'voided' && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <Pencil className="size-3" /> edited
                        </span>
                      )}
                      {o.oversold && (
                        <Badge variant="destructive">
                          <TriangleAlert /> oversold
                        </Badge>
                      )}
                    </div>
                    <p className={cn('mt-0.5 text-xs leading-relaxed text-muted-foreground', o.status === 'voided' && 'line-through')}>
                      {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ') || 'No items'}
                    </p>
                    {o.remarks && (
                      <p className="mt-1 text-xs italic text-muted-foreground/80">“{o.remarks}”</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={cn('text-sm font-semibold tabular-nums', o.status === 'voided' && 'text-muted-foreground line-through')}>{formatPeso(o.total)}</span>
                    {o.status !== 'voided' && (
                      <div className="flex items-center gap-1.5">
                        {/* Bundle orders (a line with no product_id) aren't editable:
                            the bundle's price lives on that line, not the products,
                            so re-applying product lines would zero the revenue. */}
                        {!o.items.some((it) => it.product_id === null) && (
                          <button
                            type="button"
                            onClick={() => setEditing(o)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            <Pencil className="size-3" /> Edit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => voidOrder(o)}
                          disabled={pending && voidingId === o.client_uuid}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                        >
                          <Ban className="size-3" />
                          {pending && voidingId === o.client_uuid ? 'Voiding…' : 'Void'}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {voidError && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn’t void: {voidError}
        </div>
      )}

      {editing && (
        <EditOrderModal
          order={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Transactions pagination">
          <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
            <ChevronLeft className="size-3.5" /> Previous
          </PageLink>
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {page} of {totalPages}
          </span>
          <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>
            Next <ChevronRight className="size-3.5" />
          </PageLink>
        </nav>
      )}
    </div>
  );
}

type DraftLine = {product_id: string; qty: string; unit_price: string};

/** Edit an order: payment method, IG handle, and the product lines (add/remove,
 *  qty, unit price). Saving calls edit_pos_order, which reconciles stock + total
 *  server-side. Bundle lines aren't editable here; an order made purely of
 *  component products (the POS's normal shape) edits fully. */
function EditOrderModal({
  order,
  catalog,
  onClose,
  onSaved,
}: {
  order: PosOrder;
  catalog: PosCatalogItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Options include the catalog PLUS any SKU already on this order that's no
  // longer in the active catalog (unlisted since the sale), labeled from the
  // order item, so an existing line always shows its product instead of blank.
  const catalogSkus = new Set(catalog.map((c) => c.product_id));
  const extraOptions = order.items
    .filter((it) => it.product_id && !catalogSkus.has(it.product_id))
    .map((it) => ({product_id: it.product_id as string, name: `${it.name} (unlisted)`, price: it.unit_price}));
  const options: PosCatalogItem[] = [...extraOptions, ...catalog];
  const priceBySku = new Map(options.map((c) => [c.product_id, c.price ?? 0]));
  const [method, setMethod] = useState(order.payment_method ?? 'cash');
  const [handle, setHandle] = useState(order.customer_handle ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    order.items
      .filter((it) => it.product_id)
      .map((it) => ({product_id: it.product_id as string, qty: String(it.qty), unit_price: String(it.unit_price)})),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
  const hasValidLine = lines.some((l) => l.product_id && Number(l.qty) > 0);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? {...l, ...patch} : l)));
  }
  function pickProduct(i: number, sku: string) {
    // Auto-fill unit price from the catalog on pick; stays editable after.
    setLine(i, {product_id: sku, unit_price: String(priceBySku.get(sku) ?? 0)});
  }
  function addLine() {
    setLines((ls) => [...ls, {product_id: '', qty: '1', unit_price: '0'}]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    const payloadLines = lines
      .filter((l) => l.product_id && Number(l.qty) > 0)
      .map((l) => ({product_id: l.product_id, qty: Number(l.qty), unit_price: Number(l.unit_price) || 0}));
    if (payloadLines.length === 0) {
      setError('An order needs at least one item.');
      return;
    }
    startTransition(async () => {
      const res = await editOrderAction(order.client_uuid, {payment_method: method, customer_handle: handle.trim()}, payloadLines);
      if (!res.ok) setError(res.error);
      else onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">Edit sale · {timeLabel(order.created_at)}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
              >
                {EDIT_METHODS.map((m) => (
                  <option key={m} value={m}>{paymentMethodLabel(m)}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Furbaby / IG handle</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@username or name"
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
              />
            </label>
          </div>

          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Items</span>
          <div className="mt-1.5 flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.product_id}
                  onChange={(e) => pickProduct(i, e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
                >
                  <option value="">Select product…</option>
                  {options.map((c) => (
                    <option key={c.product_id} value={c.product_id}>{c.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Quantity"
                  value={l.qty}
                  onChange={(e) => setLine(i, {qty: e.target.value})}
                  className="h-8 w-14 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
                />
                <div className="relative w-24">
                  <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">₱</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    aria-label="Unit price"
                    value={l.unit_price}
                    onChange={(e) => setLine(i, {unit_price: e.target.value})}
                    className="h-8 w-full rounded-md border bg-background pr-2 pl-5 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  aria-label="Remove item"
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
          >
            <Plus className="size-3.5" /> Add item
          </button>

          {error && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-5 py-3">
          <span className="text-sm font-semibold tabular-nums">Total {formatPeso(total)}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={pending || !hasValidLine}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageLink({href, disabled, children}: {href: string; disabled: boolean; children: React.ReactNode}) {
  const cls = 'inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium';
  if (disabled) {
    return <span className={`${cls} cursor-not-allowed border-border/60 text-muted-foreground/40`}>{children}</span>;
  }
  return (
    <Link href={href} scroll={false} className={`${cls} border-border text-foreground hover:border-primary hover:text-primary`}>
      {children}
    </Link>
  );
}
