'use client';

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {Info, Star, Upload} from 'lucide-react';
import type {ItemMovement} from '@/src/goldline-movement';
import {REORDER_UNDER_DAYS} from '@/src/goldline-movement';
import {Metric} from '@/components/analyst/metric';
import {SegmentedControl} from '@/components/analyst/segmented-control';
import {Pagination} from '@/components/analyst/pagination';
import {Card, CardContent} from '@/components/ui/card';
import {buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {fmtDay, fmtRange, InventoryTabs, StorePicker, ToneChip} from '@/components/analyst/goldline-ops-shared';

// Stock forecast (plan §07g): on hand from the latest count ÷ movement estimated from
// the previous counts → days of cover, stock-out date and a suggested order. Movement
// is estimated from the semi-monthly counts (no per-item POS feed is mapped yet), and
// the page says so.

type Status = ItemMovement['status'];
const STATUS: Record<Status, {label: string; tone: string | null; rank: number}> = {
  out: {label: 'Out', tone: 'var(--status-crit)', rank: 0},
  reorder: {label: 'Reorder', tone: 'var(--status-warn)', rank: 1},
  watch: {label: 'Within a cycle', tone: 'var(--status-warn)', rank: 2},
  healthy: {label: 'Healthy', tone: 'var(--status-good)', rank: 3},
  no_history: {label: 'Needs 2 counts', tone: null, rank: 4},
  not_counted: {label: 'Not counted', tone: null, rank: 5},
};
const PAGE_SIZE = 25;
// Sort key for cover: known days first (ascending), then "no sales" (∞), then unknown.
const coverRank = (d: number | null) => (d == null ? Number.MAX_VALUE : Number.isFinite(d) ? d : Number.MAX_VALUE / 2);

export type ForecastData = {
  stores: Array<{code: string; name: string | null}>;
  store: string | null;
  period: {start: string; end: string} | null;
  countsUsed: number;
  cycleDays: number | null;
  items: ItemMovement[];
  catalog: Record<string, {name: string; productLine: string | null; price: number | null; bestseller: boolean}>;
};

export function GoldlineForecastView({data, canEdit}: {data: ForecastData; canEdit: boolean}) {
  const {stores, store, period, countsUsed, items, catalog} = data;
  const [filter, setFilter] = useState<'action' | 'all'>('action');
  const [page, setPage] = useState(1);

  const counted = items.filter((i) => i.status !== 'not_counted');
  const n = (s: Status) => items.filter((i) => i.status === s).length;
  const hasHistory = counted.some((i) => i.velocity != null);
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          STATUS[a.status].rank - STATUS[b.status].rank ||
          coverRank(a.coverDays) - coverRank(b.coverDays) ||
          a.item_code.localeCompare(b.item_code),
      ),
    [items],
  );
  const shown = sorted.filter((i) => filter === 'all' || ['out', 'reorder', 'watch'].includes(i.status));
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const toReorder = n('out') + n('reorder');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">Stock forecast</h1>
              <InventoryTabs store={store} />
            </div>
            {stores.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <StorePicker stores={stores} value={store} />
                <span className="font-mono text-xs text-muted-foreground">
                  {period ? `latest count ${fmtRange(period.start, period.end)}` : 'no count yet'}
                  {countsUsed > 1 ? ` · movement from the last ${countsUsed - 1} ${countsUsed - 1 === 1 ? 'cycle' : 'cycles'}` : ''}
                </span>
              </div>
            )}
          </div>
          {hasHistory && <ToneChip tone={toReorder ? 'var(--status-warn)' : 'var(--status-good)'}>{toReorder ? `${toReorder} to reorder` : 'Nothing to reorder'}</ToneChip>}
        </div>
        <div className="h-0.5 w-24 rounded-full bg-gradient-to-r from-primary to-transparent" aria-hidden />
      </header>

      {!store ? (
        <Empty canEdit={canEdit} />
      ) : (
        <>
          {!hasHistory && (
            <p className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="font-medium">Forecasts need two counts of this store.</span>{' '}
                <span className="text-muted-foreground">
                  Movement is worked out from one count to the next, so days of cover and reorder suggestions appear after the next cycle&apos;s
                  form is committed. On hand is shown below in the meantime.
                </span>
              </span>
            </p>
          )}

          <section aria-label="Forecast summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Reorder now" value={hasHistory ? String(toReorder) : '—'} sub={`out or under ${REORDER_UNDER_DAYS} days of cover`} valueClassName={toReorder ? 'text-[var(--status-warn)]' : undefined} />
            <Metric label="Out of stock" value={String(n('out'))} sub="deliver first" valueClassName={n('out') ? 'text-[var(--status-crit)]' : undefined} />
            <Metric label="Runs out within a cycle" value={hasHistory ? String(n('watch')) : '—'} sub="before the next count" />
            <Metric label="Healthy" value={hasHistory ? String(n('healthy')) : '—'} sub="covered past the next count" />
          </section>

          <Card className="py-0">
            <CardContent className="flex flex-col gap-3 px-0 pt-4 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4">
                <SegmentedControl<'action' | 'all'>
                  ariaLabel="Which items"
                  value={filter}
                  onChange={(v) => {
                    setFilter(v);
                    setPage(1);
                  }}
                  options={[
                    {value: 'action', label: `Needs action ${n('out') + n('reorder') + n('watch')}`},
                    {value: 'all', label: `All ${items.length}`},
                  ]}
                />
                <span className="text-xs text-muted-foreground">Sorted by urgency</span>
              </div>
              {pageItems.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {filter === 'action' ? 'Nothing needs action. Switch to “All” to see every item.' : 'No items counted.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-y border-border bg-muted/40 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        <th className="py-2 pr-3 pl-4 font-medium">Product</th>
                        <th className="py-2 pr-3 text-right font-medium">On hand</th>
                        <th className="py-2 pr-3 text-right font-medium" title="Estimated units sold per cycle (from counts)">Sold / cycle</th>
                        <th className="py-2 pr-3 text-right font-medium">Cover</th>
                        <th className="py-2 pr-3 text-right font-medium">Runs out</th>
                        <th className="py-2 pr-3 text-right font-medium" title={`Order to reach two cycles of cover`}>Order</th>
                        <th className="py-2 pr-4 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((i) => {
                        const c = catalog[i.item_code];
                        const s = STATUS[i.status];
                        return (
                          <tr key={i.item_code} className="border-b border-border/60 last:border-b-0 hover:bg-muted/30">
                            <td className="max-w-[20rem] py-2 pr-3 pl-4">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate font-medium">{c?.name ?? i.item_code}</span>
                                {c?.bestseller && <Star aria-label="Bestseller" className="size-3.5 shrink-0 fill-current" style={{color: 'var(--status-warn)'}} />}
                              </span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                {i.item_code}
                                {c?.productLine ? ` · ${c.productLine}` : ''}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-xs font-semibold tabular-nums">{i.onHand ?? '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{i.velocity == null ? '—' : Math.round(i.velocity)}</td>
                            <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                              {i.coverDays == null ? '—' : Number.isFinite(i.coverDays) ? `${Math.floor(i.coverDays)}d` : 'no sales'}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">
                              {i.status === 'out' ? 'now' : fmtDay(i.stockOutDate)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-xs font-semibold tabular-nums">{i.suggestedOrder || '—'}</td>
                            <td className="py-2 pr-4 text-right">
                              <ToneChip tone={s.tone}>{s.label}</ToneChip>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination page={safePage} pageCount={pageCount} onPage={setPage} className="px-4" />
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Movement is <span className="font-medium text-foreground">estimated from the counts</span>: last count&apos;s on hand + this
            cycle&apos;s delivery − this count&apos;s on hand, averaged over up to three cycles. Cover = on hand ÷ that daily rate; the
            suggested order tops up to two cycles of cover. Reorder = out or under {REORDER_UNDER_DAYS} days. It becomes exact once the POS
            sales export is mapped to these item codes.
          </p>
        </>
      )}
    </div>
  );
}

function Empty({canEdit}: {canEdit: boolean}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h2 className="font-heading text-base font-semibold">No counts yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          The forecast works from committed inventory counts. Upload and commit a store&apos;s form to start; after its second count, cover
          and reorder suggestions appear here.
        </p>
        {canEdit && (
          <Link href="/uploads" className={cn(buttonVariants({size: 'sm'}), 'mt-1')}>
            <Upload className="size-4" /> Upload a scan
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
