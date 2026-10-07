import {notFound} from 'next/navigation';
import {getDataContext} from '@/src/active-context';
import {getProductData} from '@/src/goldline-product-data';
import {productView} from '@/src/goldline-product';
import {GoldlineProductView} from '@/components/analyst/goldline-product-view';

export const dynamic = 'force-dynamic';

// Goldline product page: one item's sales and stock, month by month — one store
// (?store=) or all of the caller's stores added up (no ?store=). Company + store-scope
// fenced in getProductData; an item with no catalog row and no counts is a 404.
export default async function Page(props: {params: Promise<{item: string}>; searchParams: Promise<{store?: string}>}) {
  const ctx = await getDataContext();
  if (!ctx || !ctx.companyId) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No company in view</h1>
        <p className="text-sm text-muted-foreground">Pick a company you belong to to see its products.</p>
      </div>
    );
  }
  const {item: raw} = await props.params;
  const itemCode = decodeURIComponent(raw).trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(itemCode)) notFound();
  const {store: requested} = await props.searchParams;

  const data = await getProductData(ctx.companyId, itemCode, ctx.storeScope ?? null);
  if (!data) notFound();

  const view = productView(data.item, data.stores, requested);
  return <GoldlineProductView data={view} />;
}
