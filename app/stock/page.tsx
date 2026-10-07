import {getDataContext} from '@/src/active-context';
import {canEditData} from '@/src/company';
import {getBoardData} from '@/src/goldline-board-data';
import {getInventoryPage} from '@/src/goldline-inventory-data';
import {boardSummary, buildBoard} from '@/src/goldline-supply';
import {GoldlineInventoryBoard} from '@/components/analyst/goldline-inventory-board';

export const dynamic = 'force-dynamic';

// Goldline Inventory (non-Zoomy companies) — counts and forecast in one board, with
// the warehouse side (need, ship by, produce by). Lives at /stock because /inventory is
// Zoomy's page behind the Zoomy data guard. ?store= picks a store; no ?store= = all of
// the caller's stores added up. Company + store-scope fenced in the loaders.
export default async function Page(props: {searchParams: Promise<{store?: string}>}) {
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Pick a company you belong to to see its inventory.</p>
      </div>
    );
  }
  const {store: requested} = await props.searchParams;
  const scope = ctx.storeScope ?? null;
  const board = await getBoardData(ctx.companyId, scope);
  // One store when asked for (and visible) or when it's the only one; else all stores.
  const store = board.storeList.some((s) => s.code === requested) ? (requested as string) : board.storeList.length === 1 ? board.storeList[0].code : null;
  const counts = await getInventoryPage(ctx.companyId, store, null, scope);

  const rows = buildBoard({
    stores: board.stores,
    catalog: board.catalog,
    warehouse: board.warehouse,
    config: board.config,
    shipments: board.shipments,
    currentMonth: board.currentMonth,
    today: board.today,
    store,
  });
  const latestOf = new Map(board.stores.map((s) => [s.storeCode, s.latestEnd]));
  const inView = (code: string) => !store || code === store;

  return (
    <GoldlineInventoryBoard
      data={{
        company: ctx.companyId,
        canEdit: canEditData(ctx.role),
        storeScoped: Boolean(scope),
        stores: board.storeList,
        store,
        rows,
        summary: boardSummary(rows, board.today),
        config: board.config,
        productLines: board.productLines,
        warehouse: board.warehouse,
        // Still on the way: arrival after that store's latest count.
        shipments: board.shipments.filter((s) => inView(s.storeCode) && (latestOf.get(s.storeCode) == null || s.arrivesOn > (latestOf.get(s.storeCode) as string))),
        today: board.today,
        currentMonth: board.currentMonth,
        count:
          store && counts.selected?.store_code === store
            ? {
                latestEnd: counts.selected.period_end,
                consultant: counts.selected.consultant,
                committedAt: counts.selected.last_committed_at,
                sources: counts.sources.map((s) => ({uploadId: s.uploadId, filename: s.filename, page: s.page})),
                missingPages: counts.coverage.missing,
              }
            : null,
        pendingReview: counts.pendingReview,
      }}
    />
  );
}
