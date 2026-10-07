'use client';

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowRight, FileText, Search, Star, Upload} from 'lucide-react';
import {LOW_STOCK_AT, periodParam, type InventoryItem, type StockStatus} from '@/src/goldline-inventory';
import type {InventoryPageData} from '@/src/goldline-inventory-data';
import {Metric} from '@/components/analyst/metric';
import {SegmentedControl} from '@/components/analyst/segmented-control';
import {Pagination} from '@/components/analyst/pagination';
import {Card, CardContent} from '@/components/ui/card';
import {buttonVariants} from '@/components/ui/button';
import {NativeSelect} from '@/components/ui/native-select';
import {cn} from '@/lib/utils';
import {InventoryTabs} from '@/components/analyst/goldline-ops-shared';

// Goldline Inventory (plan §07f): the semi-monthly handwritten form, digitized. One
// store × form period at a time — the three physical counts straight from the form,
// on hand + value computed, status derived. It's fed by Uploads: each committed scan
// is listed as a source (by form page), missing pages are called out, and scans still
// waiting for review are one click away.

const PAGE_SIZE = 25;
type Filter = 'all' | 'low' | 'out' | 'uncounted';

const compact = (v: number) => new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 1}).format(v);
const peso = (v: number) => `₱${v.toLocaleString('en-US', {maximumFractionDigits: 0})}`;
const num = (v: number | null) => (v == null ? '' : v.toLocaleString('en-US'));

function fmtPeriod(start: string, end: string): string {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const md = (s: string) => d(s).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const tail = sameMonth ? String(d(end).getUTCDate()) : md(end);
  return `${md(start)}–${tail}, ${d(end).getUTCFullYear()}`;
}
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'Asia/Manila'}) : null;

const STATUS: Record<StockStatus, {label: string; color?: string}> = {
  ok: {label: 'OK', color: 'var(--status-good)'},
  low: {label: 'Low', color: 'var(--status-warn)'},
  out: {label: 'Out', color: 'var(--status-crit)'},
  uncounted: {label: 'Not counted'},
};

function StatusChip({status}: {status: StockStatus}) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap',
        !s.color && 'bg-muted text-muted-foreground',
      )}
      style={s.color ? {color: s.color, background: `color-mix(in oklab, ${s.color} 14%, transparent)`} : undefined}
    >
      {s.label}
    </span>
  );
}

export function GoldlineInventoryView({data, canEdit}: {data: InventoryPageData; canEdit: boolean}) {
  const router = useRouter();
  const {snapshots, selected, summary, storeNames, sources, coverage, pendingReview} = data;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const storeLabel = (code: string) => (storeNames[code] ? `${code} · ${storeNames[code]}` : `Store ${code}`);
  const storeCodes = useMemo(
    () => [...new Set(snapshots.map((s) => s.store_code))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true})),
    [snapshots],
  );
  const periodsForStore = useMemo(
    () => (selected ? snapshots.filter((s) => s.store_code === selected.store_code) : []),
    [snapshots, selected],
  );

  const go = (store: string, period?: string) =>
    router.push(`/stock?store=${encodeURIComponent(store)}${period ? `&period=${encodeURIComponent(period)}` : ''}`);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (summary?.items ?? []).filter(
      (i) =>
        (filter === 'all' || i.status === filter) &&
        (!q || i.item_code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.productLine ?? '').toLowerCase().includes(q)),
    );
  }, [summary, filter, query]);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const reviewBanner =
    pendingReview > 0 ? (
      <Link
        href="/uploads?status=needs_review"
        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted"
        style={{borderColor: 'color-mix(in oklab, var(--status-warn) 40%, transparent)'}}
      >
        <span>
          <span className="font-medium" style={{color: 'var(--status-warn)'}}>
            {pendingReview} {pendingReview === 1 ? 'scan is' : 'scans are'} waiting for review.
          </span>{' '}
          <span className="text-muted-foreground">Counts show up here once they&apos;re committed.</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium">
          Review <ArrowRight className="size-3.5" />
        </span>
      </Link>
    ) : null;

  // ── Empty: nothing committed yet ────────────────────────────────────────────
  if (!selected || !summary) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">Stock on hand per store, from the semi-monthly inventory form.</p>
        </header>
        {reviewBanner}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <FileText className="size-5" aria-hidden />
            </span>
            <div className="flex max-w-md flex-col gap-1">
              <h2 className="font-heading text-base font-semibold">No inventory yet</h2>
              <p className="text-sm text-muted-foreground">
                Upload a scan of a store&apos;s inventory form (pages 1–5), check the reading, and commit it. Each store and period then
                appears here with its counts, stock on hand, and what&apos;s running low.
              </p>
            </div>
            {canEdit &&
              (pendingReview > 0 ? (
                <Link href="/uploads?status=needs_review" className={cn(buttonVariants({size: 'sm'}), 'mt-1')}>
                  Review {pendingReview} {pendingReview === 1 ? 'scan' : 'scans'}
                </Link>
              ) : (
                <Link href="/uploads" className={cn(buttonVariants({size: 'sm'}), 'mt-1')}>
                  <Upload className="size-4" /> Upload a scan
                </Link>
              ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const committed = fmtDate(selected.last_committed_at);
  const flagged = summary.low + summary.out;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">Inventory</h1>
              <InventoryTabs store={selected.store_code} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect aria-label="Store" value={selected.store_code} onChange={(e) => go(e.target.value)}>
                {storeCodes.map((c) => (
                  <option key={c} value={c}>
                    {storeLabel(c)}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Form period" value={periodParam(selected)} onChange={(e) => go(selected.store_code, e.target.value)}>
                {periodsForStore.map((s) => (
                  <option key={periodParam(s)} value={periodParam(s)}>
                    {fmtPeriod(s.period_start, s.period_end)}
                  </option>
                ))}
              </NativeSelect>
              <span className="font-mono text-xs text-muted-foreground">
                {[selected.consultant && `counted by ${selected.consultant}`, committed && `committed ${committed}`].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <span
            className="inline-flex items-center rounded-full px-3 py-1 font-mono text-xs font-medium tabular-nums"
            style={
              flagged
                ? {color: 'var(--status-warn)', background: 'color-mix(in oklab, var(--status-warn) 14%, transparent)'}
                : {color: 'var(--status-good)', background: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}
            }
          >
            {flagged ? `${summary.low} low · ${summary.out} out` : 'Nothing low or out'}
          </span>
        </div>
        <div className="h-0.5 w-24 rounded-full bg-gradient-to-r from-primary to-transparent" aria-hidden />
      </header>

      {reviewBanner}

      <section aria-label="Stock summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric
          label="Ending value"
          value={summary.pricedCounted ? `₱${compact(summary.value)}` : '—'}
          sub={
            summary.unpricedCounted
              ? `${summary.pricedCounted} priced · ${summary.unpricedCounted} without a price`
              : 'on hand, at catalog price'
          }
        />
        <Metric label="Items tracked" value={summary.tracked.toLocaleString()} sub={`${summary.counted} counted this period`} />
        <Metric
          label="Low stock"
          value={String(summary.low)}
          sub={`fewer than ${LOW_STOCK_AT} · reorder soon`}
          valueClassName={summary.low ? 'text-[var(--status-warn)]' : undefined}
        />
        <Metric
          label="Out of stock"
          value={String(summary.out)}
          sub="needs delivery"
          valueClassName={summary.out ? 'text-[var(--status-crit)]' : undefined}
        />
      </section>

      {/* Where these numbers came from: the committed scans, by form page. */}
      <section aria-label="Source scans" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-muted-foreground">
          From {sources.length} scanned {sources.length === 1 ? 'page' : 'pages'}:
        </span>
        {sources.map((s) => (
          <Link
            key={s.uploadId}
            href={`/uploads/${s.uploadId}`}
            className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 transition-colors hover:border-foreground/30 hover:bg-muted"
            title={s.filename}
          >
            <FileText className="size-3 text-muted-foreground" aria-hidden />
            {s.page ? `Page ${s.page}` : 'Scan'}
            <span className="max-w-[10rem] truncate text-muted-foreground">{s.filename}</span>
          </Link>
        ))}
        {coverage.missing.length > 0 && coverage.missing.length < 5 && (
          <span className="text-muted-foreground">
            Not in yet: page {coverage.missing.join(', ')}
            {canEdit && (
              <>
                {' · '}
                <Link href="/uploads" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Upload
                </Link>
              </>
            )}
          </span>
        )}
      </section>

      <Card className="py-0">
        <CardContent className="flex flex-col gap-3 px-0 pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-2 px-4">
            <SegmentedControl<Filter>
              ariaLabel="Filter by stock status"
              value={filter}
              onChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
              options={[
                {value: 'all', label: `All ${summary.tracked}`},
                {value: 'low', label: `Low ${summary.low}`},
                {value: 'out', label: `Out ${summary.out}`},
                {value: 'uncounted', label: `Not counted ${summary.uncounted}`},
              ]}
            />
            <div className="relative ml-auto min-w-[12rem]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search item or product…"
                aria-label="Search items"
                className="h-8 w-full rounded-md border border-border bg-background pr-2.5 pl-8 text-sm outline-none transition-colors hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>
          </div>

          {pageItems.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No items match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/40 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <th className="py-2 pr-3 pl-4 font-medium">Item</th>
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 text-right font-medium" title="Stockroom / steel cabinet">Stk</th>
                    <th className="py-2 pr-3 text-right font-medium" title="Drawer / module">Drw</th>
                    <th className="py-2 pr-3 text-right font-medium" title="Selling area">Sell</th>
                    <th className="py-2 pr-3 text-right font-medium">On hand</th>
                    <th className="py-2 pr-3 text-right font-medium">Value</th>
                    <th className="py-2 pr-4 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((i) => (
                    <Row key={i.item_code} i={i} store={selected.store_code} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} className="px-4" />
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Stk / Drw / Sell come straight from the form. On hand is the form&apos;s Ending column when it&apos;s filled in, otherwise
        stockroom + drawer + selling area. A blank row is &ldquo;Not counted&rdquo;, never zero. Low means fewer than {LOW_STOCK_AT}{' '}
        on hand. Value uses the catalog price; items without one show no value. <Star className="inline size-3 align-[-1px]" aria-label="Star" />{' '}
        marks a bestseller.
      </p>
    </div>
  );
}

function Row({i, store}: {i: InventoryItem; store: string}) {
  return (
    <tr className="relative border-b border-border/60 transition-colors duration-150 last:border-b-0 hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40">
      <td className="py-2 pr-3 pl-4 font-mono text-xs whitespace-nowrap text-muted-foreground">{i.item_code}</td>
      <td className="max-w-[18rem] py-2 pr-3">
        <span className="flex items-center gap-1.5">
          <Link href={`/stock/${encodeURIComponent(i.item_code)}?store=${encodeURIComponent(store)}`} className="truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset">
            {i.name}
          </Link>
          {i.bestseller && <Star aria-label="Bestseller" className="size-3.5 shrink-0 fill-current" style={{color: 'var(--status-warn)'}} />}
        </span>
        {i.productLine && <span className="block truncate text-xs text-muted-foreground">{i.productLine}</span>}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{num(i.stockroom)}</td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{num(i.drawer)}</td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{num(i.selling_area)}</td>
      <td className="py-2 pr-3 text-right font-mono text-xs font-semibold tabular-nums" title={i.onHandSource === 'ending' ? 'From the form’s Ending column' : i.onHandSource === 'counted' ? 'Stockroom + drawer + selling area' : undefined}>
        {i.onHand == null ? '—' : num(i.onHand)}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">{i.value == null ? '—' : peso(i.value)}</td>
      <td className="py-2 pr-4 text-right">
        <StatusChip status={i.status} />
      </td>
    </tr>
  );
}
