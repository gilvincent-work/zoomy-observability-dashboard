import {getPosProducts, getPosBundles, usingPosMock} from '@/src/pos-data';
import {ProductControls} from '@/components/analyst/product-controls';
import {BundleControls} from '@/components/analyst/bundle-controls';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [products, bundles] = await Promise.all([getPosProducts(), getPosBundles()]);
  return (
    <>
      <ProductControls products={products} usingMock={usingPosMock()} />
      <BundleControls bundles={bundles} />
    </>
  );
}
