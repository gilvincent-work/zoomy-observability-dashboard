import {notFound} from 'next/navigation';
import {getProductDetail} from '@/src/pos-product-detail';
import {ProductDetailView} from '@/components/analyst/product-detail';

export const dynamic = 'force-dynamic';

export default async function Page(props: {params: Promise<{sku: string}>}) {
  const params = await props.params;
  const detail = await getProductDetail(decodeURIComponent(params.sku));
  if (!detail) notFound();
  return <ProductDetailView detail={detail} />;
}
