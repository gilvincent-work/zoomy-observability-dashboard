import {getPosProducts, getPosBundles, usingPosMock} from '@/src/pos-data';
import {getStockConfig} from '@/src/pos-stock-settings';
import {ProductControls} from '@/components/analyst/product-controls';
import {BundleControls} from '@/components/analyst/bundle-controls';
import {StockSettingsForm} from '@/components/analyst/stock-settings-form';
import {AddStockButton} from '@/components/analyst/add-stock-button';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [products, bundles, stockConfig] = await Promise.all([getPosProducts(), getPosBundles(), getStockConfig()]);
  // Stamped fresh on every render; ProductControls' Refresh button triggers
  // router.refresh(), which re-runs this and lands a new fetchedAt + fresh
  // products/bundles on both sections below — no browser reload needed.
  const fetchedAt = new Date().toISOString();
  const intake = products.map((p) => ({product_id: p.product_id, name: p.name, stock: p.stock}));
  return (
    <>
      <ProductControls products={products} usingMock={usingPosMock()} fetchedAt={fetchedAt} />
      <div className="mx-auto flex max-w-6xl items-center justify-end px-6 pt-4 md:px-10">
        <AddStockButton products={intake} />
      </div>
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <StockSettingsForm config={stockConfig} usingMock={usingPosMock()} />
      </div>
      <BundleControls bundles={bundles} />
    </>
  );
}
