'use client';

// The merged "All products" table: catalog + stock + sell-through in one, with
// sortable columns (default Category order), Line/Status/search filters, an
// editable Price, and a per-row ⋯ menu carrying the catalog edits (rename,
// reprice, list/unlist) via the existing server actions. Read-first by design;
// editing opens a small popover so the wide table stays scannable.

import {useMemo, useState, useTransition, useEffect, useRef} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {createPortal} from 'react-dom';
import {MoreHorizontal, Pencil, X} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {POS_CATEGORIES, POS_SUBCATEGORIES, SUBCATEGORY_CATEGORY, formatPeso} from '@/src/pos-format';
import {compareByCategory} from '@/src/pos-inventory-compute';
import {renameProductAction, repriceProductAction, setListingAction} from '@/src/pos-actions';
import {addStockAction, voidLastAddAction} from '@/src/pos-stock-intake-actions';
import {Pagination} from './pagination';
import type {InventoryRow} from '@/src/pos-inventory-data';
import type {ForecastStatus} from '@/src/pos-forecast-compute';

type SortKey = 'category' | 'name' | 'status' | 'price' | 'thisMonth' | 'lastMonth' | 'threeMo' | 'stock' | 'cover' | 'reorder';

const PAGE_SIZE = 12; // rows per page on the merged product table

const STATUS: Record<ForecastStatus, {label: string; dot: string; text: string; bg: string}> = {
  healthy: {label: 'Healthy', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10'},
  low: {label: 'Low', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10'},
  out: {label: 'Out', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10'},
};
const STATUS_RANK: Record<ForecastStatus, number> = {out: 0, low: 1, healthy: 2};
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export function InventoryTable({rows: initialRows, usingMock}: {rows: InventoryRow[]; usingMock: boolean}) {
  const [rows, setRows] = useState(initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);

  const [line, setLine] = useState('');
  const [sub, setSub] = useState('');
  const [status, setStatus] = useState<'' | ForecastStatus | 'unlisted'>('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{key: SortKey; dir: 1 | -1}>({key: 'category', dir: 1});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{row: InventoryRow; field: 'name' | 'price'} | null>(null);
  const [addStockRow, setAddStockRow] = useState<InventoryRow | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (line && (r.category ?? '') !== line) return false;
      if (line === SUBCATEGORY_CATEGORY && sub && (r.subcategory ?? '') !== sub) return false;
      if (status === 'unlisted' && r.active) return false;
      if (status && status !== 'unlisted' && r.status !== status) return false;
      if (q && !(r.name.toLowerCase().includes(q) || r.product_id.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, line, sub, status, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort.key === 'category') return arr.sort(compareByCategory);
    const val = (r: InventoryRow): number | string => {
      switch (sort.key) {
        case 'name': return r.name.toLowerCase();
        case 'status': return STATUS_RANK[r.status];
        case 'price': return r.price ?? -1;
        case 'thisMonth': return r.monthly.thisMonth;
        case 'lastMonth': return r.monthly.lastMonth;
        case 'threeMo': return r.monthly.threeMonthTotal;
        case 'stock': return r.stock;
        case 'cover': return r.coverEventDays ?? Number.POSITIVE_INFINITY;
        case 'reorder': return r.reorderQty ?? -1;
        default: return 0;
      }
    };
    return arr.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return -1 * sort.dir;
      if (av > bv) return 1 * sort.dir;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, sort]);

  // Paginate the filtered+sorted rows client-side. Snap back to page 1 whenever the
  // result set changes (filter/search/sort), and clamp so a shrunk set never leaves
  // us stranded past the last page.
  useEffect(() => setPage(1), [line, sub, status, search, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const from = (safePage - 1) * PAGE_SIZE;
  const paged = sorted.slice(from, from + PAGE_SIZE);

  // Numeric/severity columns default high-to-low (dir -1); name/category low-to-high.
  function toggleSort(key: SortKey) {
    setSort((s) => {
      if (s.key !== key) return {key, dir: key === 'name' || key === 'category' ? 1 : -1};
      return {key, dir: (s.dir * -1) as 1 | -1};
    });
  }
  const caret = (key: SortKey) => (sort.key !== key ? '↕' : sort.dir === 1 ? '↑' : '↓');

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-col gap-2">
        <PillRow label="Line" items={[{v: '', l: 'All'}, ...POS_CATEGORIES.map((c) => ({v: c as string, l: c}))]} active={line}
          onSelect={(v) => {setLine(v); if (v !== SUBCATEGORY_CATEGORY) setSub('');}} />
        {line === SUBCATEGORY_CATEGORY && (
          <PillRow label="Type" items={[{v: '', l: 'All'}, ...POS_SUBCATEGORIES.map((s) => ({v: s as string, l: s}))]} active={sub} onSelect={setSub} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PillRow label="Status" items={[{v: '', l: 'All'}, {v: 'out', l: 'Out'}, {v: 'low', l: 'Low'}, {v: 'healthy', l: 'Healthy'}, {v: 'unlisted', l: 'Unlisted'}]} active={status} onSelect={(v) => setStatus(v as typeof status)} />
          <div className="ml-auto flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <span className="text-xs text-muted-foreground">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or SKU…" aria-label="Search products"
              className="w-40 bg-transparent text-xs outline-none" />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No products match this filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Th onClick={() => toggleSort('name')} active={sort.key === 'name' || sort.key === 'category'}>Product <Sc>{sort.key === 'category' ? '▲cat' : caret('name')}</Sc></Th>
                    <Th onClick={() => toggleSort('status')} active={sort.key === 'status'}>Status <Sc>{caret('status')}</Sc></Th>
                    <Th className="text-right" onClick={() => toggleSort('price')} active={sort.key === 'price'}>Price <Sc>{caret('price')}</Sc></Th>
                    <th className="px-4 py-3 text-left">Trend</th>
                    <Th className="text-right" onClick={() => toggleSort('thisMonth')} active={sort.key === 'thisMonth'}>This mo <Sc>{caret('thisMonth')}</Sc></Th>
                    <Th className="text-right" onClick={() => toggleSort('lastMonth')} active={sort.key === 'lastMonth'}>Last mo <Sc>{caret('lastMonth')}</Sc></Th>
                    <Th className="text-right" onClick={() => toggleSort('threeMo')} active={sort.key === 'threeMo'}>3mo <Sc>{caret('threeMo')}</Sc></Th>
                    <Th className="text-right" onClick={() => toggleSort('stock')} active={sort.key === 'stock'}>Stock Qty <Sc>{caret('stock')}</Sc></Th>
                    <Th onClick={() => toggleSort('cover')} active={sort.key === 'cover'}>Lasts <Sc>{caret('cover')}</Sc></Th>
                    <Th className="text-right" onClick={() => toggleSort('reorder')} active={sort.key === 'reorder'}>Suggested <Sc>{caret('reorder')}</Sc></Th>
                    <th className="px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <Row key={r.product_id} r={r} menuOpen={menuFor === r.product_id}
                      onMenu={() => setMenuFor((m) => (m === r.product_id ? null : r.product_id))}
                      onClose={() => setMenuFor(null)}
                      onEdit={(field) => {setMenuFor(null); setEditing({row: r, field});}}
                      onAddStock={() => {setMenuFor(null); setAddStockRow(r);}} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {sorted.length > 0 && (
        <div className="mt-4 flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {from + 1}–{Math.min(from + PAGE_SIZE, sorted.length)} of {sorted.length}
          </p>
          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} label="Products pagination" />
        </div>
      )}

      {editing && (
        <EditDialog row={editing.row} field={editing.field} usingMock={usingMock}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {setRows((rs) => rs.map((r) => (r.product_id === editing.row.product_id ? {...r, ...patch} : r))); setEditing(null);}} />
      )}
      {addStockRow && (
        <AddStockDialog row={addStockRow} usingMock={usingMock}
          onClose={() => setAddStockRow(null)}
          onDone={(added) => {setRows((rs) => rs.map((r) => (r.product_id === addStockRow.product_id ? {...r, stock: r.stock + added} : r))); setAddStockRow(null);}} />
      )}
    </div>
  );
}

function Row({r, menuOpen, onMenu, onClose, onEdit, onAddStock}: {
  r: InventoryRow; menuOpen: boolean; onMenu: () => void; onClose: () => void; onEdit: (f: 'name' | 'price') => void; onAddStock: () => void;
}) {
  const s = STATUS[r.status];
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function toggleListing() {
    startTransition(async () => {
      await setListingAction(r.product_id, !r.active);
      onClose();
      router.refresh();
    });
  }
  function undoLastAdd() {
    startTransition(async () => {
      await voidLastAddAction(r.product_id);
      onClose();
      router.refresh();
    });
  }
  const max = Math.max(1, ...r.monthly.trend);
  // The whole row navigates to the product detail; inner controls (name link, price
  // edit, the ⋯ menu) stopPropagation so they keep their own behavior.
  return (
    <tr onClick={() => router.push(`/inventory/${r.product_id}`)}
      className={cn('cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50', !r.active && 'opacity-55')}>
      <td className="px-4 py-3">
        <Link href={`/inventory/${r.product_id}`} onClick={(e) => e.stopPropagation()} className="font-medium transition-colors hover:text-primary">{r.name}</Link>
        <div className="font-mono text-[10px] text-muted-foreground">{r.product_id}{!r.active && ' · unlisted'}</div>
      </td>
      <td className="px-4 py-3">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', s.bg, s.text)}>
          <span className={cn('size-1.5 rounded-full', s.dot)} />{s.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button onClick={(e) => {e.stopPropagation(); onEdit('price');}} className="inline-flex items-center gap-1.5 tabular-nums transition-colors hover:text-primary" title="Change price">
          {formatPeso(r.price)} <Pencil className="size-3 text-muted-foreground" />
        </button>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex h-5 items-end gap-[3px]">
          {r.monthly.trend.map((v, i) => (
            <span key={i} className={cn('w-[5px] rounded-sm', r.monthly.threeMonthTotal > 0 ? 'bg-emerald-500' : 'bg-muted')}
              style={{height: `${Math.max(12, (v / max) * 100)}%`}} />
          ))}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span>{r.monthly.thisMonth}</span>
        <YoyDelta yoy={r.yoy} thisMonth={r.monthly.thisMonth} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.monthly.lastMonth}</td>
      <td className="px-4 py-3 text-right tabular-nums">{r.monthly.threeMonthTotal}</td>
      <td className="px-4 py-3 text-right tabular-nums font-medium">{r.stock}</td>
      <td className="whitespace-nowrap px-4 py-3">
        <LastsBadge row={r} />
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{r.reorderQty != null ? r.reorderQty : <span className="text-muted-foreground">—</span>}</td>
      <td className="relative px-2 py-3 text-right">
        <button onClick={(e) => {e.stopPropagation(); onMenu();}} aria-label="Row actions" className="rounded p-1 text-muted-foreground hover:text-foreground"><MoreHorizontal className="size-4" /></button>
        {menuOpen && (
          <RowMenu sku={r.product_id} active={r.active} pending={pending}
            onRename={() => onEdit('name')} onReprice={() => onEdit('price')} onToggleListing={toggleListing}
            onAddStock={onAddStock} onUndo={undoLastAdd} onClose={onClose} />
        )}
      </td>
    </tr>
  );
}

// Small year-over-year indicator under the "This month" number: ▲/▼ vs the same
// month last year. Only shown when there is a real baseline (yoy set); before 12
// months of history exists there is nothing to compare, so it renders nothing.
function YoyDelta({yoy, thisMonth}: {yoy: InventoryRow['yoy']; thisMonth: number}) {
  if (!yoy || yoy.deltaPct == null) return null;
  const up = yoy.deltaPct > 0, flat = yoy.deltaPct === 0;
  const cls = flat ? 'text-muted-foreground' : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={cn('mt-0.5 block text-[10px] font-medium tabular-nums', cls)}
      title={`vs ${yoy.monthLabel}: ${yoy.lastYearSold} (this month ${thisMonth})`}>
      {flat ? '±' : up ? '▲' : '▼'}{Math.abs(yoy.deltaPct)}% YoY
    </span>
  );
}
function LastsBadge({row}: {row: InventoryRow}) {
  const {status, coverEventDays, monthly, runsOutLabel} = row;
  if (status === 'out') return <Badge tone="crit">runs out</Badge>;
  if (monthly.threeMonthTotal === 0 && coverEventDays == null) return <Badge tone="warn">not selling</Badge>;
  if (coverEventDays == null) return <span className="text-xs text-muted-foreground">{runsOutLabel}</span>;
  const tone = coverEventDays <= 2 ? 'crit' : 'ok';
  return <Badge tone={tone}>~{fmt1(coverEventDays)} selling days</Badge>;
}
function Badge({tone, children}: {tone: 'crit' | 'warn' | 'ok'; children: React.ReactNode}) {
  const cls = tone === 'crit' ? 'bg-red-500/10 text-red-600 dark:text-red-400'
    : tone === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  return <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', cls)}>{children}</span>;
}

function RowMenu({sku, active, pending, onRename, onReprice, onToggleListing, onAddStock, onUndo, onClose}: {
  sku: string; active: boolean; pending: boolean; onRename: () => void; onReprice: () => void; onToggleListing: () => void; onAddStock: () => void; onUndo: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {if (ref.current && !ref.current.contains(e.target as Node)) onClose();};
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} className="absolute right-2 top-9 z-20 w-48 overflow-hidden rounded-xl border bg-popover text-left shadow-lg">
      <MenuItem href={`/inventory/${sku}`}>View detail</MenuItem>
      <MenuItem onClick={onAddStock}>Add stock</MenuItem>
      <MenuItem onClick={onUndo} disabled={pending}>Undo last add</MenuItem>
      <MenuItem onClick={onRename}>Rename</MenuItem>
      <MenuItem onClick={onReprice}>Change price</MenuItem>
      <MenuItem onClick={onToggleListing} disabled={pending}>{active ? 'Unlist' : 'List'}</MenuItem>
    </div>
  );
}
function MenuItem({children, onClick, href, disabled}: {children: React.ReactNode; onClick?: () => void; href?: string; disabled?: boolean}) {
  const cls = 'block w-full border-b px-4 py-2.5 text-left text-sm font-medium last:border-0 hover:bg-muted disabled:opacity-50';
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} className={cls}>{children}</button>;
}

function EditDialog({row, field, usingMock, onClose, onSaved}: {
  row: InventoryRow; field: 'name' | 'price'; usingMock: boolean; onClose: () => void; onSaved: (patch: Partial<InventoryRow>) => void;
}) {
  const [value, setValue] = useState(field === 'name' ? row.name : String(row.price ?? ''));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {if (e.key === 'Escape') onClose();};
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = field === 'name' ? await renameProductAction(row.product_id, value.trim()) : await repriceProductAction(row.product_id, value.trim());
      if (res.ok) {
        onSaved(field === 'name' ? {name: value.trim()} : {price: Number(value)});
        router.refresh();
      } else setError(res.error);
    });
  }
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-sm rounded-xl border bg-popover p-5 shadow-lg">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{field === 'name' ? 'Rename product' : 'Change price'}</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">{row.product_id}</p>
        {field === 'price' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">₱</span>
            <input type="text" inputMode="decimal" value={value} autoFocus
              onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
              className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus-visible:border-ring" />
          </div>
        ) : (
          <input type="text" value={value} autoFocus onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring" />
        )}
        {field === 'price' && (
          <p className="mt-2 text-[11px] text-muted-foreground">Logged to the price history. Past sales keep the price they were rung up at.</p>
        )}
        {usingMock && <p className="mt-2 text-xs text-muted-foreground">Demo mode — set the Supabase pos_* env to save.</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={pending || usingMock} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{pending ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AddStockDialog({row, usingMock, onClose, onDone}: {
  row: InventoryRow; usingMock: boolean; onClose: () => void; onDone: (added: number) => void;
}) {
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {if (e.key === 'Escape') onClose();};
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function save() {
    setError(null);
    const qty = Math.round(Number(value));
    if (!Number.isFinite(qty) || qty <= 0) {setError('Enter a quantity greater than zero.'); return;}
    startTransition(async () => {
      const res = await addStockAction([{sku: row.product_id, qty}]);
      if (res.ok) {
        onDone(qty);
        router.refresh();
      } else setError(res.error);
    });
  }
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-[1px]" />
      <div className="relative w-full max-w-sm rounded-xl border bg-popover p-5 shadow-lg">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add stock</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">{row.name} · {row.product_id} · {row.stock} on hand</p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">+</span>
          <input type="text" inputMode="numeric" value={value} autoFocus
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {if (e.key === 'Enter') save();}}
            className="w-32 rounded-md border bg-background px-2 py-1.5 text-sm tabular-nums outline-none focus-visible:border-ring" />
          <span className="text-xs text-muted-foreground">units</span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Logged to the stock ledger. Undo the last add from the row menu.</p>
        {usingMock && <p className="mt-2 text-xs text-muted-foreground">Demo mode — set the Supabase pos_* env to add stock.</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={save} disabled={pending || usingMock} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{pending ? 'Adding…' : 'Add stock'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Th({children, className, onClick, active}: {children: React.ReactNode; className?: string; onClick?: () => void; active?: boolean}) {
  return (
    <th onClick={onClick} className={cn('cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left transition-colors hover:text-foreground', active && 'text-primary', className)}>
      {children}
    </th>
  );
}
function Sc({children}: {children: React.ReactNode}) {
  return <span className="ml-0.5 text-[9px] opacity-60">{children}</span>;
}
function PillRow({label, items, active, onSelect}: {label: string; items: {v: string; l: string}[]; active: string; onSelect: (v: string) => void}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {items.map((it) => (
        <button key={it.v || 'all'} type="button" onClick={() => onSelect(it.v)}
          className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', active === it.v ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {it.l}
        </button>
      ))}
    </div>
  );
}
