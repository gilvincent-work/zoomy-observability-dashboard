'use client';

import {useState, useTransition} from 'react';
import Link from 'next/link';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {ArrowLeft, Ban, ChevronLeft, ChevronRight, PawPrint, Pencil, Plus, Receipt, RotateCcw, TriangleAlert, X} from 'lucide-react';
import type {PosOrder, PosOrdersFilter, PriceBounds, PosCatalogItem, PosBundleDef, EditEntry} from '@/src/pos-sales-types';
import {isFilterActive, orderToEntries, type PageInfo} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodLabel, paymentMethodBadgeClass} from '@/src/pos-format';
import {voidOrderAction, unvoidOrderAction, editOrderAction} from '@/src/pos-sales-actions';
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
  bundles,
  usingMock,
  fetchedAt,
}: {
  orders: PosOrder[];
  pageInfo: PageInfo;
  filter: PosOrdersFilter;
  bounds: PriceBounds;
  catalog: PosCatalogItem[];
  bundles: PosBundleDef[];
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

  // Voiding restocks the sale; unvoiding re-applies it. Both confirm first, then
  // re-fetch the server data so the row + totals update. actingId tracks whichever
  // order is mid-flight so only its button shows a spinner.
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const voidOrder = (o: PosOrder) => {
    if (o.status === 'voided') return;
    const ok = window.confirm(
      `Void this ₱${o.total.toLocaleString()} sale?\n\nIts items will be added back to stock. You can unvoid it later.`,
    );
    if (!ok) return;
    setActionError(null);
    setActingId(o.client_uuid);
    startTransition(async () => {
      const res = await voidOrderAction(o.client_uuid);
      setActingId(null);
      if (!res.ok) setActionError(res.error);
      else router.refresh();
    });
  };

  // Unvoid restores a voided sale (re-applies its inventory + revenue).
  const unvoidOrder = (o: PosOrder) => {
    if (o.status !== 'voided') return;
    const ok = window.confirm(
      `Unvoid this ₱${o.total.toLocaleString()} sale?\n\nIt will be restored and its items taken back out of stock.`,
    );
    if (!ok) return;
    setActionError(null);
    setActingId(o.client_uuid);
    startTransition(async () => {
      const res = await unvoidOrderAction(o.client_uuid);
      setActingId(null);
      if (!res.ok) setActionError(res.error);
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
                    {o.status !== 'voided' ? (
                      <div className="flex items-center gap-1.5">
                        {/* Every non-voided order is editable now, bundles included:
                            the editor rebuilds bundle groups from the order and the
                            RPC re-derives the total + enforces each bundle's rules. */}
                        <button
                          type="button"
                          onClick={() => setEditing(o)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                        >
                          <Pencil className="size-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => voidOrder(o)}
                          disabled={pending && actingId === o.client_uuid}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                        >
                          <Ban className="size-3" />
                          {pending && actingId === o.client_uuid ? 'Voiding…' : 'Void'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => unvoidOrder(o)}
                        disabled={pending && actingId === o.client_uuid}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-emerald-500 hover:text-emerald-500 disabled:opacity-50"
                      >
                        <RotateCcw className="size-3" />
                        {pending && actingId === o.client_uuid ? 'Unvoiding…' : 'Unvoid'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Couldn’t update order: {actionError}
        </div>
      )}

      {editing && (
        <EditOrderModal
          order={editing}
          catalog={catalog}
          bundles={bundles}
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

type DraftItem = {kind: 'item'; product_id: string; qty: string; unit_price: string};
type DraftPick = {product_id: string; qty: string};
type DraftBundle = {kind: 'bundle'; bundle_id: string; price: string; picks: DraftPick[]};
type DraftEntry = DraftItem | DraftBundle;

/** Edit an order end-to-end: payment method, IG handle, individual items, and
 *  bundle groups. Bundles keep their rules, a "pick N" bundle enforces exactly N
 *  picks from its eligible categories; a fixed bundle shows its components; both
 *  let you edit the bundle price. You can freely add items or bundles to any
 *  order. Saving calls edit_pos_order, which re-derives stock + total and
 *  re-checks every bundle rule server-side. */
function EditOrderModal({
  order,
  catalog,
  bundles,
  onClose,
  onSaved,
}: {
  order: PosOrder;
  catalog: PosCatalogItem[];
  bundles: PosBundleDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Options = the catalog PLUS any SKU already on this order that's since been
  // unlisted, so an existing line always shows its product instead of blank.
  const catalogSkus = new Set(catalog.map((c) => c.product_id));
  const extraOptions: PosCatalogItem[] = order.items
    .filter((it) => it.product_id && !catalogSkus.has(it.product_id))
    .map((it) => ({product_id: it.product_id as string, name: `${it.name} (unlisted)`, price: it.unit_price, category: null}));
  const options: PosCatalogItem[] = [...extraOptions, ...catalog];
  const priceBySku = new Map(options.map((c) => [c.product_id, c.price ?? 0]));
  const bundleById = new Map(bundles.map((b) => [b.bundle_id, b]));

  const [method, setMethod] = useState(order.payment_method ?? 'cash');
  const [handle, setHandle] = useState(order.customer_handle ?? '');
  const [entries, setEntries] = useState<DraftEntry[]>(() =>
    orderToEntries(order, bundles.map((b) => ({bundle_id: b.bundle_id, bundle_type: b.bundle_type, pick_count: b.pick_count}))).map((e): DraftEntry =>
      e.kind === 'item'
        ? {kind: 'item', product_id: e.product_id, qty: String(e.qty), unit_price: String(e.unit_price)}
        : {kind: 'bundle', bundle_id: e.bundle_id, price: String(e.price), picks: e.picks.map((p) => ({product_id: p.product_id, qty: String(p.qty)}))},
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligibleOptions = (b: PosBundleDef | undefined) => {
    if (!b || !b.line_categories || b.line_categories.length === 0) return options;
    return options.filter((c) => c.category != null && b.line_categories!.includes(c.category));
  };
  const picksTotal = (picks: DraftPick[]) => picks.reduce((s, p) => s + (Number(p.qty) || 0), 0);

  const entryTotal = (e: DraftEntry) =>
    e.kind === 'item' ? (Number(e.qty) || 0) * (Number(e.unit_price) || 0) : Number(e.price) || 0;
  const total = entries.reduce((sum, e) => sum + entryTotal(e), 0);

  // A pick bundle must be linked and have exactly its pick_count picks.
  const bundleProblem = (e: DraftBundle): string | null => {
    if (!e.bundle_id) return 'pick which bundle this is';
    const def = bundleById.get(e.bundle_id);
    if (!def || def.bundle_type !== 'pick' || def.pick_count == null) return null;
    if (e.picks.some((p) => !p.product_id)) return 'choose a product for every pick';
    const n = picksTotal(e.picks);
    if (n !== def.pick_count) return `needs exactly ${def.pick_count} (has ${n})`;
    return null;
  };
  const canSave =
    entries.length > 0 &&
    entries.every((e) => (e.kind === 'item' ? !!e.product_id && Number(e.qty) > 0 : !bundleProblem(e)));

  const patchEntry = (i: number, next: DraftEntry) => setEntries((es) => es.map((e, idx) => (idx === i ? next : e)));
  const removeEntry = (i: number) => setEntries((es) => es.filter((_, idx) => idx !== i));
  const addItem = () => setEntries((es) => [...es, {kind: 'item', product_id: '', qty: '1', unit_price: '0'}]);
  const addBundle = (id: string) => {
    const def = bundleById.get(id);
    if (!def) return;
    const picks =
      def.bundle_type === 'pick' && def.pick_count
        ? Array.from({length: def.pick_count}, () => ({product_id: '', qty: '1'}))
        : [];
    setEntries((es) => [...es, {kind: 'bundle', bundle_id: id, price: String(def.price), picks}]);
  };

  function save() {
    setError(null);
    const payload: EditEntry[] = entries.map((e) =>
      e.kind === 'item'
        ? {kind: 'item', product_id: e.product_id, qty: Number(e.qty) || 0, unit_price: Number(e.unit_price) || 0}
        : {kind: 'bundle', bundle_id: e.bundle_id, price: Number(e.price) || 0, picks: e.picks.map((p) => ({product_id: p.product_id, qty: Number(p.qty) || 0}))},
    );
    startTransition(async () => {
      const res = await editOrderAction(order.client_uuid, {payment_method: method, customer_handle: handle.trim()}, payload);
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

          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Items &amp; bundles</span>
          <div className="mt-1.5 flex flex-col gap-2">
            {entries.map((e, i) =>
              e.kind === 'item' ? (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={e.product_id}
                    onChange={(ev) => patchEntry(i, {...e, product_id: ev.target.value, unit_price: String(priceBySku.get(ev.target.value) ?? e.unit_price)})}
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
                  >
                    <option value="">Select product…</option>
                    {options.map((c) => (
                      <option key={c.product_id} value={c.product_id}>{c.name}</option>
                    ))}
                  </select>
                  <input
                    type="number" inputMode="numeric" aria-label="Quantity" value={e.qty}
                    onChange={(ev) => patchEntry(i, {...e, qty: ev.target.value})}
                    className="h-8 w-12 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
                  />
                  <div className="relative w-20">
                    <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">₱</span>
                    <input
                      type="number" inputMode="decimal" aria-label="Unit price" value={e.unit_price}
                      onChange={(ev) => patchEntry(i, {...e, unit_price: ev.target.value})}
                      className="h-8 w-full rounded-md border bg-background pr-2 pl-5 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-muted-foreground" aria-label="Line subtotal">
                    {formatPeso(entryTotal(e))}
                  </span>
                  <button type="button" onClick={() => removeEntry(i)} aria-label="Remove item" className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <BundleEntryCard
                  key={i}
                  entry={e}
                  def={bundleById.get(e.bundle_id)}
                  bundles={bundles}
                  eligible={eligibleOptions(bundleById.get(e.bundle_id))}
                  problem={bundleProblem(e)}
                  onPatch={(next) => patchEntry(i, next)}
                  onRemove={() => removeEntry(i)}
                />
              ),
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80">
              <Plus className="size-3.5" /> Add item
            </button>
            {bundles.length > 0 && (
              <label className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                <Plus className="size-3.5" />
                <select
                  aria-label="Add bundle"
                  value=""
                  onChange={(ev) => {
                    if (ev.target.value) addBundle(ev.target.value);
                    ev.currentTarget.value = '';
                  }}
                  className="h-7 rounded-md border border-transparent bg-transparent px-1 text-xs font-medium text-primary outline-none hover:opacity-80 focus-visible:border-ring"
                >
                  <option value="">Add bundle…</option>
                  {bundles.map((b) => (
                    <option key={b.bundle_id} value={b.bundle_id}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

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
            <Button size="sm" onClick={save} disabled={pending || !canSave}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One bundle group inside the edit modal: name + rule, an editable price, and
 *  either pick slots (Buy Any N, restricted to eligible categories, enforced to
 *  exactly N) or the fixed components (read-only). */
function BundleEntryCard({
  entry,
  def,
  bundles,
  eligible,
  problem,
  onPatch,
  onRemove,
}: {
  entry: DraftBundle;
  def: PosBundleDef | undefined;
  bundles: PosBundleDef[];
  eligible: PosCatalogItem[];
  problem: string | null;
  onPatch: (next: DraftBundle) => void;
  onRemove: () => void;
}) {
  const isPick = def?.bundle_type === 'pick';
  // Link/relink this group to a bundle (keeps the current picks so a folded legacy
  // bundle doesn't lose them; the pick counter guides any adjustment). Fills an
  // empty price from the chosen bundle's default.
  const relink = (bundle_id: string) => {
    const nd = bundles.find((b) => b.bundle_id === bundle_id);
    onPatch({...entry, bundle_id, price: entry.price && entry.price !== '0' ? entry.price : String(nd?.price ?? 0)});
  };
  const setPick = (j: number, patch: Partial<DraftPick>) =>
    onPatch({...entry, picks: entry.picks.map((p, idx) => (idx === j ? {...p, ...patch} : p))});
  const addPick = () => onPatch({...entry, picks: [...entry.picks, {product_id: '', qty: '1'}]});
  const removePick = (j: number) => onPatch({...entry, picks: entry.picks.filter((_, idx) => idx !== j)});
  const picked = entry.picks.reduce((s, p) => s + (Number(p.qty) || 0), 0);

  return (
    <div className="rounded-lg border border-border bg-background/40 p-2.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Bundle</span>
        <select
          aria-label="Bundle"
          value={entry.bundle_id}
          onChange={(e) => relink(e.target.value)}
          className={cn('h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-medium outline-none focus-visible:border-ring', !entry.bundle_id && 'border-destructive text-muted-foreground')}
        >
          <option value="">Select bundle…</option>
          {bundles.map((b) => (
            <option key={b.bundle_id} value={b.bundle_id}>{b.name}</option>
          ))}
        </select>
        <div className="relative w-24">
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-muted-foreground">₱</span>
          <input
            type="number" inputMode="decimal" aria-label="Bundle price" value={entry.price}
            onChange={(e) => onPatch({...entry, price: e.target.value})}
            className="h-8 w-full rounded-md border bg-background pr-2 pl-5 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
          />
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove bundle" className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive">
          <X className="size-4" />
        </button>
      </div>

      {isPick ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Picks</span>
            <span className={cn('tabular-nums', problem ? 'text-destructive' : 'text-emerald-500')}>
              {picked} / {def?.pick_count ?? '—'}
            </span>
          </div>
          {entry.picks.map((p, j) => (
            <div key={j} className="flex items-center gap-2">
              <select
                value={p.product_id}
                onChange={(e) => setPick(j, {product_id: e.target.value})}
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
              >
                <option value="">Select pick…</option>
                {eligible.map((c) => (
                  <option key={c.product_id} value={c.product_id}>{c.name}</option>
                ))}
              </select>
              <input
                type="number" inputMode="numeric" aria-label="Pick quantity" value={p.qty}
                onChange={(e) => setPick(j, {qty: e.target.value})}
                className="h-8 w-12 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring"
              />
              <button type="button" onClick={() => removePick(j)} aria-label="Remove pick" className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addPick} className="mt-0.5 inline-flex items-center gap-1 self-start text-[11px] font-medium text-primary transition-opacity hover:opacity-80">
            <Plus className="size-3" /> Add pick
          </button>
        </div>
      ) : def ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {def.items.length > 0 ? def.items.map((it) => `${it.name} ×${it.qty}`).join(', ') : 'Fixed bundle'}
        </p>
      ) : null}

      {problem && <p className="mt-1.5 text-[11px] text-destructive">This bundle {problem}.</p>}
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
