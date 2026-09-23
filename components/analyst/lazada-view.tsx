'use client';

// Lazada marketplace customers, rebuilt from the storefront admin page.
//
// The export is one row per ORDER ITEM, so ~600 spreadsheet rows are ~270
// orders from ~230 buyers; the rollup by phone happens at read time
// (src/lazada-export.ts) and this renders it. Upload → parse in the browser →
// upsert on order_item_id, which is what makes re-uploading an overlapping
// export window idempotent.
import {useCallback, useMemo, useRef, useState, useTransition} from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Lock,
  Package,
  ShoppingBag,
  Upload,
  Users,
} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {Metric} from './metric';
import {Eyebrow} from './sections';
import {Pagination} from './pagination';
import {RefreshControl} from './refresh-control';
import {
  dataFreshness,
  itemsToCustomers,
  productDisplayName,
  productRanking,
  summarize,
} from '@/src/lazada-export';
import {uploadLazadaItems} from '@/src/lazada-actions';
import type {LazadaCustomer, LazadaOrderItem, LazadaUpload} from '@/src/lazada-types';

const peso = (n: number | null | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₱${v.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
};

/** Compact form for tiles, where ₱1,234,567.00 would not fit. */
const pesoShort = (n: number | null | undefined) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `₱${Math.round(v / 1000)}k`;
  return `₱${Math.round(v).toLocaleString('en-PH')}`;
};

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

type SortKey = 'name' | 'city' | 'phone' | 'last' | 'days' | 'spent' | 'avg' | 'pay' | 'orders';
type Sort = {key: SortKey; dir: 'asc' | 'desc'};

const CUSTOMER_COLS: Array<{key: SortKey; label: string; num?: boolean; get: (c: LazadaCustomer) => string | number}> = [
  {key: 'name', label: 'Name', get: (c) => c.name ?? ''},
  {key: 'city', label: 'City', get: (c) => c.city ?? ''},
  {key: 'phone', label: 'Phone', get: (c) => c.phone},
  {key: 'last', label: 'Last order', get: (c) => c.lastOrderAt},
  {key: 'days', label: 'Days since', num: true, get: (c) => c.daysSince},
  {key: 'spent', label: 'Total spent', num: true, get: (c) => c.totalSpent},
  {key: 'avg', label: 'Avg order', num: true, get: (c) => c.avgOrder},
  {key: 'pay', label: 'Payment', get: (c) => c.payMethod ?? ''},
  {key: 'orders', label: 'Orders', num: true, get: (c) => c.orderCount},
];

function SortHeader({
  col,
  sort,
  setSort,
}: {
  col: (typeof CUSTOMER_COLS)[number];
  sort: Sort;
  setSort: (s: Sort) => void;
}) {
  const active = sort.key === col.key;
  return (
    <th className={cn('px-4 py-2.5 font-medium', col.num && 'text-right')}>
      <button
        type="button"
        onClick={() =>
          setSort({key: col.key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc'})
        }
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {col.label}
        {active &&
          (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
}

function csvCell(v: unknown): string {
  const raw = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function LazadaView({
  items,
  lastUpload,
  missingTable,
  configured,
  fetchedAt,
}: {
  items: LazadaOrderItem[];
  lastUpload: LazadaUpload | null;
  missingTable: boolean;
  configured: boolean;
  fetchedAt: string;
}) {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('all');
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>({key: 'days', dir: 'desc'});
  const [uploadMsg, setUploadMsg] = useState<{tone: 'ok' | 'error'; text: string} | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Date maths on the server would differ from the browser and trip hydration,
  // so the rollup is computed here with a single `now` per render.
  const customers = useMemo(() => itemsToCustomers(items), [items]);
  const totals = useMemo(() => summarize(customers), [customers]);
  const products = useMemo(() => productRanking(items), [items]);
  const cities = useMemo(
    () => [...new Set(customers.map((c) => c.city).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [customers],
  );
  const freshness = useMemo(() => dataFreshness(totals.newestOrderAt), [totals.newestOrderAt]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = customers.filter(
      (c) =>
        (city === 'all' || c.city === city) &&
        (!needle ||
          [c.name, c.phone, c.city, c.lastProduct].some((v) =>
            String(v ?? '').toLowerCase().includes(needle),
          )),
    );
    const col = CUSTOMER_COLS.find((x) => x.key === sort.key) ?? CUSTOMER_COLS[4];
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const va = col.get(a);
      const vb = col.get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [customers, q, city, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(page, pageCount);
  const shown = rows.slice((safePage - 1) * perPage, safePage * perPage);

  const onExport = () => {
    const csv = [
      ['Name', 'City', 'Phone', 'Last order', 'Days since', 'Total spent', 'Avg order', 'Payment', 'Orders'],
      ...rows.map((c) => [
        c.name ?? '',
        c.city ?? '',
        c.phone,
        fmtDate(c.lastOrderAt),
        c.daysSince,
        c.totalSpent,
        c.avgOrder,
        c.payMethod ?? '',
        c.orderCount,
      ]),
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `lazada-customers (${rows.length}).csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = useCallback(async (file: File) => {
    setUploadMsg(null);
    // Imported here, not at module scope: ExcelJS is ~900KB and only matters
    // once someone actually drops a file.
    const {parseLazadaWorkbook} = await import('@/src/lazada-export-client');
    const parsed = await parseLazadaWorkbook(await file.arrayBuffer());
    if (parsed.error) {
      setUploadMsg({tone: 'error', text: parsed.error});
      return;
    }
    startTransition(async () => {
      const res = await uploadLazadaItems(
        parsed.items,
        {total: parsed.total, skipped: parsed.skipped, exclusions: parsed.exclusions},
        file.name,
      );
      setUploadMsg(
        res.ok
          ? {
              tone: 'ok',
              text: `Saved ${res.saved.toLocaleString()} order item${res.saved === 1 ? '' : 's'} from ${parsed.total.toLocaleString()} rows — ${parsed.buyers.toLocaleString()} buyers.`,
            }
          : {tone: 'error', text: res.error},
      );
    });
  }, []);

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight">Lazada</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Marketplace customers from the Seller-Center export, deduplicated by phone number.
            Upload an export to add to it — re-uploading the same window is safe.
          </p>
        </div>
        <div className="pt-1.5">
          <RefreshControl fetchedAt={fetchedAt} />
        </div>
      </header>

      {!configured && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs leading-snug text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Supabase is not configured in this environment, so this page has nothing to read.</span>
        </div>
      )}

      {missingTable && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs leading-snug">
          <span aria-hidden>🛠</span>
          <span>
            <b>One setup step left.</b> The <code>lazada_orders</code> table does not exist in this
            project yet. Run <code>supabase/lazada_orders.sql</code> (and{' '}
            <code>lazada_uploads.sql</code>) in the Supabase SQL editor, then reload — no redeploy
            needed.
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <b>Real customer data.</b> Names, phone numbers and cities are stored service-role only and
          shown on this signed-in page. Access control is not consent — confirm the Lazada terms and
          customer-consent sign-off before uploading live exports.
        </span>
      </div>

      <section>
        <Eyebrow icon={Upload}>Import</Eyebrow>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            'rounded-xl border border-dashed px-5 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <p className="text-sm text-muted-foreground">
            Drop the Seller-Center <code>.xlsx</code> export here, or{' '}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              choose a file
            </button>
            . The spreadsheet is read in your browser; only normalised rows are sent.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          {pending && <p className="mt-2 text-xs text-muted-foreground">Saving…</p>}
          {uploadMsg && (
            <p
              className={cn(
                'mt-2 text-xs font-medium',
                uploadMsg.tone === 'ok' ? 'text-emerald-600' : 'text-destructive',
              )}
              role="status"
            >
              {uploadMsg.text}
            </p>
          )}
        </div>
      </section>

      <section>
        <Eyebrow icon={ShoppingBag}>Overview</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Metric icon={Users} label="Customers" value={totals.customers.toLocaleString()} sub="Unique phone numbers" />
          <Metric label="Orders" value={totals.orders.toLocaleString()} />
          <Metric
            label="Repeat customers"
            value={totals.repeatCustomers.toLocaleString()}
            sub={totals.customers ? `${Math.round((totals.repeatCustomers / totals.customers) * 100)}% of buyers` : undefined}
          />
          <Metric label="Revenue" value={pesoShort(totals.revenue)} sub="Buyer outlay, incl. shipping" />
          <Metric label="Cities" value={totals.cities.toLocaleString()} />
          <Metric
            label="Orders span"
            value={totals.oldestOrderAt ? fmtDate(totals.oldestOrderAt) : '—'}
            sub={totals.newestOrderAt ? `to ${fmtDate(totals.newestOrderAt)}` : undefined}
          />
        </div>
        {(freshness || lastUpload) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {freshness && (
              <>
                Newest order is {freshness.ageDays} day{freshness.ageDays === 1 ? '' : 's'} old
                {freshness.tone !== 'fresh' && ' — worth uploading a newer export'}.
              </>
            )}
            {lastUpload && (
              <>
                {' '}
                Last import {fmtDate(lastUpload.uploaded_at)}: {lastUpload.items_saved.toLocaleString()} items,{' '}
                {lastUpload.buyers.toLocaleString()} buyers
                {lastUpload.excluded_buyers
                  ? `, ${lastUpload.excluded_buyers.toLocaleString()} buyers excluded (canceled/returned only)`
                  : ''}
                .
              </>
            )}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Eyebrow icon={Users}>Customers {rows.length ? `· ${rows.length}` : ''}</Eyebrow>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, phone or city"
              aria-label="Search Lazada customers"
              className="h-9 w-56 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-primary"
            />
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by city"
              className="h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:border-primary"
            >
              <option value="all">All cities</option>
              {cities.map((c) => (
                <option value={c} key={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={perPage}
              onChange={(e) => {
                setPerPage(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:border-primary"
            >
              {[10, 25, 50, 100].map((n) => (
                <option value={n} key={n}>
                  {n} rows
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onExport}
              disabled={!rows.length}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {items.length
                  ? 'No customers match that search.'
                  : 'No Lazada orders yet — upload a Seller-Center export above.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {CUSTOMER_COLS.map((col) => (
                        <SortHeader col={col} sort={sort} setSort={setSort} key={col.key} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.phone} className="border-b last:border-0">
                        <td className="px-4 py-2.5">{c.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{c.city ?? '—'}</td>
                        <td className="px-4 py-2.5 tabular-nums">{c.phone}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(c.lastOrderAt)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.daysSince}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{peso(c.totalSpent)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{peso(c.avgOrder)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.payMethod ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.orderCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {rows.length ? (safePage - 1) * perPage + 1 : 0}–
            {Math.min(safePage * perPage, rows.length)} of {rows.length} · most overdue first by
            default
          </p>
          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} label="Customer pagination" />
        </div>
      </section>

      {products.length > 0 && (
        <section>
          <Eyebrow icon={Package}>Orders by product</Eyebrow>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">#</th>
                      <th className="px-4 py-2.5 font-medium">Product</th>
                      <th className="px-4 py-2.5 font-medium">Flavour / variant</th>
                      <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                      <th className="px-4 py-2.5 text-right font-medium">Buyers</th>
                      <th className="px-4 py-2.5 text-right font-medium">Items</th>
                      <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={`${p.product}-${p.variant}-${i}`} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">{productDisplayName(p.product)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{p.variant || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{p.orders}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{p.buyers}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{p.items}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{peso(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
