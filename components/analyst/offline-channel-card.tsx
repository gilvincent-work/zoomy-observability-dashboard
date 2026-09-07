import Link from 'next/link';
import {ArrowRight, Store} from 'lucide-react';
import type {SalesKpis} from '@/src/pos-sales-types';
import {formatPeso} from '@/src/pos-format';
import {Card, CardContent} from '@/components/ui/card';

/**
 * Standalone "Offline · Bazaar" presence on the Overview. Self-contained on
 * purpose — it reads pos_orders via the sales data layer and does NOT touch the
 * digest-driven channel-compare component (see COOP_INTEGRATION_PLAN.md, Phase 5C
 * go/no-go). Shows the offline channel's own 30-day totals with a link to the
 * full Offline Sales page. A deeper side-by-side against online is a later,
 * coordinated change.
 */
export function OfflineChannelCard({kpis}: {kpis: SalesKpis}) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Store className="size-4" />
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-tight">Offline · Bazaar</div>
              <div className="text-xs text-muted-foreground">POS sales · last 30 days</div>
            </div>
          </div>
          <Link
            href="/offline-sales"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Metric label="Revenue" value={formatPeso(kpis.revenue)} />
          <Metric label="Orders" value={String(kpis.orders)} />
          <Metric label="Units" value={String(kpis.units)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({label, value}: {label: string; value: string}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{label}</span>
      <span className="font-serif text-2xl font-normal tabular-nums text-foreground">{value}</span>
    </div>
  );
}
