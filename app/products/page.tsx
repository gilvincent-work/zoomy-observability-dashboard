import {getPosProducts, getPosBundles, usingPosMock} from '@/src/pos-data';
import {ProductControls} from '@/components/analyst/product-controls';
import {BundleControls} from '@/components/analyst/bundle-controls';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [products, bundles] = await Promise.all([getPosProducts(), getPosBundles()]);
  // Stamped fresh on every render; ProductControls' Refresh button triggers
  // router.refresh(), which re-runs this and lands a new fetchedAt + fresh
  // products/bundles on both sections below — no browser reload needed.
  const fetchedAt = new Date().toISOString();
  return (
    <>
      <ProductControls products={products} usingMock={usingPosMock()} fetchedAt={fetchedAt} />
      <BundleControls bundles={bundles} />
    </>
  );
}
