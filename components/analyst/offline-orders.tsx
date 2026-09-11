'use client';

import {useState, useTransition} from 'react';
import Link from 'next/link';
import {usePathname, useRouter, useSearchParams} from 'next/navigation';
import {ArrowLeft, Ban, ChevronLeft, ChevronRight, PawPrint, Receipt, TriangleAlert} from 'lucide-react';
import type {PosOrder, PosOrdersFilter, PriceBounds} from '@/src/pos-sales-types';
import {isFilterActive, type PageInfo} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodLabel, paymentMethodBadgeClass} from '@/src/pos-format';
import {voidOrderAction} from '@/src/pos-sales-actions';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Eyebrow, MockNote} from './sections';
import {TransactionFilters} from './transaction-filters';
import {RefreshControl} from './refresh-control';

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineOrdersView({
  orders,
  pageInfo,
  filter,
  bounds,
  usingMock,
  fetchedAt,
}: {
  orders: PosOrder[];
  pageInfo: PageInfo;
  filter: PosOrdersFilter;
  bounds: PriceBounds;
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
                      <button
                        type="button"
                        onClick={() => voidOrder(o)}
                        disabled={pending && voidingId === o.client_uuid}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        <Ban className="size-3" />
                        {pending && voidingId === o.client_uuid ? 'Voiding…' : 'Void'}
                      </button>
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
