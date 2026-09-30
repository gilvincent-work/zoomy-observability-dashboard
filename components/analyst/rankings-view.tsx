'use client';

// Offline Sales → "Product rankings" — the "View all" destination for the
// overview's Top products / Top bundles cards. One page, two tabs (Products /
// Bundles), each a sortable, searchable, paginated table. The overview cards stay
// capped at 5; here the FULL ranked lists arrive from the server and are
// filtered → sorted → paginated client-side. Per-tab state is independent and
// lifted into this component, so switching tabs preserves each tab's sort,
// search, and page. Only `?tab=` lives in the URL (so the two "View all" links
// can deep-link a tab); the rest is client state.

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {ArrowLeft, ArrowUpDown, ChevronDown, ChevronUp, Package2, Search, Trophy, X} from 'lucide-react';
import type {TopBundle, TopProduct} from '@/src/pos-sales-types';
import {paginate} from '@/src/pos-sales-compute';
import {
  filterByName,
  RANKINGS_DEFAULT_PAGE_SIZE,
  RANKINGS_PAGE_SIZES,
  sortRows,
  type SortDir,
} from '@/src/pos-rankings';
import {formatPeso} from '@/src/pos-format';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Eyebrow, MockNote} from './sections';
import {SegmentedControl} from './segmented-control';
import {RefreshControl} from './refresh-control';
import {Pagination} from './pagination';

type Tab = 'products' | 'bundles';
type ProductKey = 'name' | 'units' | 'bundledUnits' | 'revenue';
type BundleKey = 'name' | 'orders' | 'revenue';

// Per-tab view state. `key`/`dir` drive the sort (and mirror the header arrows);
// `q` is the name filter; `size`/`page` drive pagination.
type Cfg<K extends string> = {key: K; dir: SortDir; q: string; size: number; page: number};

const PRODUCT_DEFAULT: Cfg<ProductKey> = {key: 'revenue', dir: 'top', q: '', size: RANKINGS_DEFAULT_PAGE_SIZE, page: 1};
const BUNDLE_DEFAULT: Cfg<BundleKey> = {key: 'revenue', dir: 'top', q: '', size: RANKINGS_DEFAULT_PAGE_SIZE, page: 1};

// Metric toggles reuse the overview's SegmentedControl. Values are typed as the
// sort key so sorting by a header-only column (Name / Bundled) simply leaves both
// buttons unpressed — the active column always shows via its header arrow.
const PRODUCT_METRIC_OPTIONS: readonly {value: ProductKey; label: string}[] = [
  {value: 'revenue', label: 'Revenue'},
  {value: 'units', label: 'Units'},
];
const BUNDLE_METRIC_OPTIONS: readonly {value: BundleKey; label: string}[] = [
  {value: 'revenue', label: 'Revenue'},
  {value: 'orders', label: 'Orders'},
];
const DIRECTION_OPTIONS = [
  {value: 'top', label: 'Top'},
  {value: 'bottom', label: 'Bottom'},
] as const;

type Column<T> = {
  key: keyof T & string;
  label: string;
  align: 'left' | 'right';
  render: (row: T) => React.ReactNode;
};

export function RankingsView({
  products,
  bundles,
  liveProductIds,
  usingMock,
  fetchedAt,
}: {
  products: TopProduct[];
  bundles: TopBundle[];
  liveProductIds: string[]; // product_ids still in the catalog → row links to detail
  usingMock: boolean;
  fetchedAt: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams?.get('tab') === 'bundles' ? 'bundles' : 'products';

  // Independent, lifted per-tab state — preserved across tab switches.
  const [productCfg, setProductCfg] = useState<Cfg<ProductKey>>(PRODUCT_DEFAULT);
  const [bundleCfg, setBundleCfg] = useState<Cfg<BundleKey>>(BUNDLE_DEFAULT);

  const liveIds = useMemo(() => new Set(liveProductIds), [liveProductIds]);

  const productColumns: Column<TopProduct>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Product',
        align: 'left',
        render: (r) =>
          liveIds.has(r.product_id) ? (
            <Link
              href={`/inventory/${encodeURIComponent(r.product_id)}`}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {r.name}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{r.name}</span>
          ),
      },
      {key: 'units', label: 'Units', align: 'right', render: (r) => <span className="tabular-nums">{r.units}</span>},
      {
        key: 'bundledUnits',
        label: 'Bundled',
        align: 'right',
        render: (r) => (
          <span className={cn('tabular-nums', r.bundledUnits === 0 && 'text-muted-foreground/50')}>
            {r.bundledUnits === 0 ? '—' : r.bundledUnits}
          </span>
        ),
      },
      {key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="tabular-nums">{formatPeso(r.revenue)}</span>},
    ],
    [liveIds],
  );

  const bundleColumns: Column<TopBundle>[] = useMemo(
    () => [
      {key: 'name', label: 'Bundle', align: 'left', render: (r) => <span className="font-medium text-foreground">{r.name}</span>},
      {key: 'orders', label: 'Orders', align: 'right', render: (r) => <span className="tabular-nums">{r.orders}</span>},
      {key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="tabular-nums">{formatPeso(r.revenue)}</span>},
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10 max-md:px-4 max-md:py-6">
      <Link href="/offline-sales" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Offline Sales
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow icon={Trophy}>Product rankings</Eyebrow>
          <p className="text-sm text-muted-foreground">Every product and bundle sold, ranked. Sort a column, search a name, page through.</p>
        </div>
        <RefreshControl fetchedAt={fetchedAt} />
      </div>

      {usingMock && (
        <div className="mb-4">
          <MockNote>
            Mock sales. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the Staging project to load
            real <code>pos_orders</code>.
          </MockNote>
        </div>
      )}

      {/* Tabs — soft-navigate `?tab=`; lifted state keeps each tab's view. */}
      <div className="mb-5 flex items-center gap-1 border-b border-border" role="tablist" aria-label="Rankings">
        <TabLink href={pathname} active={tab === 'products'} icon={Trophy} label="Products" count={products.length} />
        <TabLink href={`${pathname}?tab=bundles`} active={tab === 'bundles'} icon={Package2} label="Bundles" count={bundles.length} />
      </div>

      {tab === 'products' ? (
        <RankingPanel
          rows={products}
          columns={productColumns}
          metricOptions={PRODUCT_METRIC_OPTIONS}
          cfg={productCfg}
          setCfg={setProductCfg}
          searchPlaceholder="Search products…"
          noun="product"
        />
      ) : (
        <RankingPanel
          rows={bundles}
          columns={bundleColumns}
          metricOptions={BUNDLE_METRIC_OPTIONS}
          cfg={bundleCfg}
          setCfg={setBundleCfg}
          searchPlaceholder="Search bundles…"
          noun="bundle"
        />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{className?: string}>;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      role="tab"
      aria-selected={active}
      className={cn(
        '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
      <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums', active ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground')}>
        {count}
      </span>
    </Link>
  );
}

// One tab's controls + table + pager. Generic over the row type so Products and
// Bundles share the exact same layout, filtering, sorting, and pagination.
function RankingPanel<T extends {name: string}, K extends keyof T & string>({
  rows,
  columns,
  metricOptions,
  cfg,
  setCfg,
  searchPlaceholder,
  noun,
}: {
  rows: T[];
  columns: Column<T>[];
  metricOptions: readonly {value: K; label: string}[];
  cfg: Cfg<K>;
  setCfg: React.Dispatch<React.SetStateAction<Cfg<K>>>;
  searchPlaceholder: string;
  noun: string;
}) {
  // Any change to the result set (sort/search/size) returns to page 1; only the
  // pager moves `page` on its own.
  const patch = (p: Partial<Cfg<K>>, keepPage = false) => setCfg((c) => ({...c, ...p, page: keepPage ? (p.page ?? c.page) : 1}));

  const onSort = (key: K) =>
    setCfg((c) => (c.key === key ? {...c, dir: c.dir === 'top' ? 'bottom' : 'top', page: 1} : {...c, key, dir: 'top', page: 1}));

  const {pageRows, info, filteredCount} = useMemo(() => {
    const filtered = filterByName(rows, cfg.q);
    const sorted = sortRows(filtered, cfg.key, cfg.dir);
    const pageInfo = paginate(sorted.length, cfg.page, cfg.size);
    return {pageRows: sorted.slice(pageInfo.from, pageInfo.to + 1), info: pageInfo, filteredCount: sorted.length};
  }, [rows, cfg]);

  const empty = filteredCount === 0;
  const searching = cfg.q.trim().length > 0;

  return (
    <Card>
      <CardContent className="py-4">
        {/* Controls: metric + direction toggles (left), search + page size (right). */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-1.5">
            <SegmentedControl ariaLabel="Rank by" options={metricOptions} value={cfg.key} onChange={(key) => patch({key})} />
            <SegmentedControl ariaLabel="Show best or lowest" options={DIRECTION_OPTIONS} value={cfg.dir} onChange={(dir) => patch({dir})} />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={cfg.q}
                onChange={(e) => patch({q: e.target.value})}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 w-44 rounded-md border bg-background pl-8 pr-7 text-sm outline-none transition-colors focus-visible:border-ring max-md:w-36"
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => patch({q: ''})}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="max-md:sr-only">Per page</span>
              <select
                value={cfg.size}
                onChange={(e) => patch({size: Number(e.target.value)})}
                aria-label="Rows per page"
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
              >
                {RANKINGS_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {searching ? `No ${noun}s match “${cfg.q.trim()}”.` : `No sales yet.`}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="w-10 py-2 pr-2 text-right font-medium">
                      #
                    </th>
                    {columns.map((col) => {
                      const activeSort = cfg.key === col.key;
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          aria-sort={activeSort ? (cfg.dir === 'top' ? 'descending' : 'ascending') : 'none'}
                          className={cn('py-2 font-medium', col.align === 'right' ? 'text-right' : 'text-left')}
                        >
                          <button
                            type="button"
                            onClick={() => onSort(col.key as K)}
                            className={cn(
                              'inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground',
                              col.align === 'right' && 'flex-row-reverse',
                              activeSort && 'text-foreground',
                            )}
                          >
                            {col.label}
                            <SortArrow active={activeSort} dir={cfg.dir} />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr key={(row as {product_id?: string; bundle_id?: string}).product_id ?? (row as {bundle_id?: string}).bundle_id ?? i} className="border-b last:border-0">
                      <td className="py-2.5 pr-2 text-right text-xs tabular-nums text-muted-foreground">{info.from + i + 1}</td>
                      {columns.map((col) => (
                        <td key={col.key} className={cn('py-2.5', col.align === 'right' ? 'pl-3 text-right' : 'pr-3')}>
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground tabular-nums">
                {info.from + 1}–{Math.min(info.to + 1, filteredCount)} of {filteredCount}
                {searching && ` matching`}
              </p>
              <Pagination page={info.page} pageCount={info.totalPages} onPage={(p) => patch({page: p}, true)} label={`${noun} rankings pagination`} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SortArrow({active, dir}: {active: boolean; dir: SortDir}) {
  if (!active) return <ArrowUpDown className="size-3 text-muted-foreground/50" aria-hidden />;
  return dir === 'top' ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />;
}
