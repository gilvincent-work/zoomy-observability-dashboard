'use client';

import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {ArrowLeft, ChevronLeft, ChevronRight, Receipt, TriangleAlert} from 'lucide-react';
import type {PosOrder, PosOrdersFilter, PriceBounds} from '@/src/pos-sales-types';
import {isFilterActive, type PageInfo} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodLabel} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Eyebrow, MockNote} from './sections';
import {TransactionFilters} from './transaction-filters';

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});

export function OfflineOrdersView({
  orders,
  pageInfo,
  filter,
  bounds,
  usingMock,
}: {
  orders: PosOrder[];
  pageInfo: PageInfo;
  filter: PosOrdersFilter;
  bounds: PriceBounds;
  usingMock: boolean;
}) {
  const {page, totalPages, pageSize} = pageInfo;
  const firstOnPage = (page - 1) * pageSize;
  const filtered = isFilterActive(filter);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageHref = (p: number) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('page', String(p));
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <Link href="/offline-sales" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Offline Sales
      </Link>
      <div className="mb-4">
        <Eyebrow icon={Receipt}>All transactions</Eyebrow>
        <p className="text-sm text-muted-foreground">Every offline sale synced from the POS, newest first.</p>
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
                <li key={o.id} className="flex items-start gap-4 px-5 py-3.5">
                  <span className="mt-0.5 w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{firstOnPage + i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{timeLabel(o.created_at)}</span>
                      <Badge variant="secondary">{paymentMethodLabel(o.payment_method)}</Badge>
                      {o.oversold && (
                        <Badge variant="destructive">
                          <TriangleAlert /> oversold
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ') || 'No items'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPeso(o.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
