import 'server-only';
import {cache} from 'react';
import {unstable_cache} from 'next/cache';
import {posClient, usingPosMock} from './pos-data';
import {POS_TAGS, POS_CACHE_REVALIDATE} from './pos-cache';
import {fetchAllRows} from './pos-fetch-paginate';

// SERVER-ONLY. Per-location on-hand (Office vs Event) from the pos_inventory_by_location
// view, so the inventory surfaces can show where a product's stock physically sits
// and the transfer / intake modals can guardrail against over-moving. React-cached
// and tagged with the catalog so a stock write revalidates it alongside pos_inventory.

export interface LocationStockRow {
  product_id: string;
  office: number;
  event: number;
}

export const getLocationStock = cache((): Promise<LocationStockRow[]> =>
  usingPosMock() ? Promise.resolve([]) : locationStockCached(),
);

const locationStockCached = unstable_cache(async (): Promise<LocationStockRow[]> => {
  // pos_inventory_by_location is a VIEW grouped by (product_id, location); page by
  // that composite unique key via fetchAllRows so a bare .select() can't be capped
  // at db.max_rows (1000) and drop a location's on-hand.
  const data = await fetchAllRows('pos_inventory_by_location', (from, to) =>
    posClient()
      .from('pos_inventory_by_location')
      .select('product_id,location,stock')
      .order('product_id', {ascending: true})
      .order('location', {ascending: true})
      .range(from, to));

  const byId = new Map<string, {office: number; event: number}>();
  for (const r of data) {
    const id = r.product_id as string;
    const cur = byId.get(id) ?? {office: 0, event: 0};
    if (r.location === 'office') cur.office = Number(r.stock ?? 0);
    else if (r.location === 'event') cur.event = Number(r.stock ?? 0);
    byId.set(id, cur);
  }
  return [...byId.entries()].map(([product_id, v]) => ({product_id, ...v}));
}, ['pos-location-stock'], {tags: [POS_TAGS.catalog], revalidate: POS_CACHE_REVALIDATE});
