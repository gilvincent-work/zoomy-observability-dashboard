import {getDataContext} from '@/src/active-context';
import {canEditData} from '@/src/company';
import {getInventoryPage} from '@/src/goldline-inventory-data';
import {GoldlineInventoryView} from '@/components/analyst/goldline-inventory-view';

export const dynamic = 'force-dynamic';

// Goldline Inventory (non-Zoomy companies). Lives at /stock because /inventory is
// Zoomy's own page behind the Zoomy data guard. Scoped to the active company via
// getDataContext; ?store= and ?period=YYYY-MM-DD_YYYY-MM-DD pick the snapshot.
export default async function Page(props: {searchParams: Promise<{store?: string; period?: string}>}) {
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Pick a company you belong to to see its inventory.</p>
      </div>
    );
  }
  const sp = await props.searchParams;
  const data = await getInventoryPage(ctx.companyId, sp.store ?? null, sp.period ?? null, ctx.storeScope ?? null);
  return <GoldlineInventoryView data={data} canEdit={canEditData(ctx.role)} />;
}
