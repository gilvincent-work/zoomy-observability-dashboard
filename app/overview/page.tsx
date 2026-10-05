import {getDataContext} from '@/src/active-context';
import {getGoldlineAnalytics} from '@/src/goldline-analytics';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const peso = (n: number) => `₱${Math.round(n).toLocaleString()}`;

// Sales overview for the active company, from gl_sales. Server-rendered (read-only).
// Scoped by getDataContext; the nav surfaces it for non-Zoomy companies.
export default async function Page() {
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Pick a company you belong to to see its overview.</p>
      </div>
    );
  }

  const {summary, byStore, bySku} = await getGoldlineAnalytics(ctx.companyId);
  const topStores = byStore.filter((s) => s.gross > 0).slice(0, 5);
  const topSkus = bySku.slice(0, 5);
  const maxStore = topStores[0]?.gross ?? 0;
  const maxSku = topSkus[0]?.gross ?? 0;
  const hasData = summary.gross > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          {hasData
            ? `Sales this period${summary.periodStart && summary.periodEnd ? ` (${summary.periodStart} → ${summary.periodEnd})` : ''}.`
            : 'No sales yet — upload a POS sales CSV to populate this.'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Gross sales" value={peso(summary.gross)} />
        <Stat label="Units" value={summary.units.toLocaleString()} />
        <Stat label="Net of VAT" value={peso(summary.net)} />
        <Stat label="Stores selling" value={`${summary.storeCount} / ${byStore.length}`} />
      </div>

      {hasData && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top stores</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {topStores.map((s) => (
                <BarRow key={s.store_code} label={s.name} value={peso(s.gross)} pct={maxStore ? s.gross / maxStore : 0} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top SKUs</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {topSkus.map((s) => (
                <BarRow key={s.sku_code} label={s.sku_code} mono value={peso(s.gross)} pct={maxSku ? s.gross / maxSku : 0} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-heading text-lg font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}

function BarRow({label, value, pct, mono}: {label: string; value: string; pct: number; mono?: boolean}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={mono ? 'truncate font-mono text-xs' : 'truncate'}>{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`}} />
      </div>
    </div>
  );
}
