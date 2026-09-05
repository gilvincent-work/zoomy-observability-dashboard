import {getPosProducts, usingPosMock} from '@/src/pos-data';
import {ProductControls} from '@/components/analyst/product-controls';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const products = await getPosProducts();
  return <ProductControls products={products} usingMock={usingPosMock()} />;
}
