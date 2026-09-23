import {getLastLazadaUpload, getLazadaItems} from '@/src/lazada-data';
import {LazadaView} from '@/components/analyst/lazada-view';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [{items, missingTable, configured}, lastUpload] = await Promise.all([
    getLazadaItems(),
    getLastLazadaUpload(),
  ]);
  return (
    <LazadaView
      items={items}
      lastUpload={lastUpload}
      missingTable={missingTable}
      configured={configured}
      fetchedAt={new Date().toISOString()}
    />
  );
}
