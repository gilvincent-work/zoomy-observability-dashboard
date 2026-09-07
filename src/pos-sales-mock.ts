import type {PosOrder, PosSyncEntry} from './pos-sales-types';

// Mock offline sales for local dashboard work when the Supabase pos_* env is
// absent (mirrors src/pos-mock.ts). Dates are relative to "now" so the range
// filter has something to show in every bucket.
function iso(daysAgo: number, hour = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const MOCK_POS_ORDERS: PosOrder[] = [
  {
    id: 'mock-1', subtotal: 540, discount: null, total: 540, oversold: false, device_id: 'pos', created_at: iso(0, 9),
    items: [
      {product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 2, unit_price: 200, line_total: 400},
      {product_id: 'ZMYFDFDRSLMCUB01', name: 'Freeze-Dried Salmon Cubes', qty: 1, unit_price: 140, line_total: 140},
    ],
  },
  {
    id: 'mock-2', subtotal: 300, discount: null, total: 300, oversold: true, device_id: 'pos', created_at: iso(0, 14),
    items: [{product_id: 'ZMYFDJRKCHKWHL01', name: 'Tasty Treats Chicken Jerky', qty: 1, unit_price: 300, line_total: 300}],
  },
  {
    id: 'mock-3', subtotal: 340, discount: null, total: 340, oversold: false, device_id: 'pos', created_at: iso(3),
    items: [{product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', qty: 2, unit_price: 170, line_total: 340}],
  },
  {
    id: 'mock-4', subtotal: 200, discount: null, total: 200, oversold: false, device_id: 'pos', created_at: iso(12),
    items: [{product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 1, unit_price: 200, line_total: 200}],
  },
  {
    id: 'mock-5', subtotal: 510, discount: null, total: 510, oversold: false, device_id: 'pos', created_at: iso(25),
    items: [
      {product_id: 'ZMYFDMEATSLMWHL01', name: 'Meaty Treats Salmon', qty: 1, unit_price: 200, line_total: 200},
      {product_id: 'ZMYFDJRKDCKWHL01', name: 'Tasty Treats Duck Jerky', qty: 1, unit_price: 310, line_total: 310},
    ],
  },
];

export const MOCK_POS_SYNC_LOG: PosSyncEntry[] = [
  {synced_at: iso(0, 9), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
  {synced_at: iso(0, 8), direction: 'pull', entity: 'catalog', summary: {count: 26}, device_id: 'pos'},
  {synced_at: iso(3), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
];
