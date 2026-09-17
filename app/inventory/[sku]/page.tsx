import {notFound} from 'next/navigation';
import {getProductDetail} from '@/src/pos-product-detail';
import {ProductDetailView} from '@/components/analyst/product-detail';

export const dynamic = 'force-dynamic';

export default async function Page({params}: {params: {sku: string}}) {
  const detail = await getProductDetail(decodeURIComponent(params.sku));
  if (!detail) notFound();
  return <ProductDetailView detail={detail} />;
}
