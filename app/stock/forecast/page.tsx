import {getDataContext} from '@/src/active-context';
import {canEditData} from '@/src/company';
import {getOpsData} from '@/src/goldline-ops-data';
import {GoldlineForecastView} from '@/components/analyst/goldline-forecast-view';

export const dynamic = 'force-dynamic';

// Goldline stock forecast (plan §07g), a tab of Inventory. One store at a time
// (?store=); defaults to the first store with a count. Company + store-scope fenced.
export default async function Page(props: {searchParams: Promise<{store?: string}>}) {
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Pick a company you belong to to see its forecast.</p>
      </div>
    );
  }
  const {store: requested} = await props.searchParams;
  const ops = await getOpsData(ctx.companyId, ctx.storeScope ?? null);
  const withCounts = ops.stores.filter((s) => s.movement.latest);
  const pick = withCounts.find((s) => s.storeCode === requested) ?? withCounts[0] ?? null;
  return (
    <GoldlineForecastView
      canEdit={canEditData(ctx.role)}
      data={{
        stores: withCounts.map((s) => ({code: s.storeCode, name: s.storeName})),
        store: pick?.storeCode ?? null,
        period: pick?.movement.latest ? {start: pick.movement.latest.period_start, end: pick.movement.latest.period_end} : null,
        countsUsed: pick?.movement.counts ?? 0,
        cycleDays: pick?.movement.cycleDays ?? null,
        items: pick?.movement.items ?? [],
        catalog: ops.catalog,
      }}
    />
  );
}
