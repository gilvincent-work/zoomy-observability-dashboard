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
    id: 'mock-1', client_uuid: 'mock-1-uuid', subtotal: 540, discount: null, total: 540, oversold: false, device_id: 'pos', payment_method: 'cash', customer_handle: '@daisy_the_pug', created_at: iso(0, 9), status: 'completed', remarks: null,
    items: [
      {product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 2, unit_price: 200, line_total: 400},
      {product_id: 'ZMYFDFDRSLMCUB01', name: 'Freeze-Dried Salmon Cubes', qty: 1, unit_price: 140, line_total: 140},
    ],
  },
  {
    id: 'mock-2', client_uuid: 'mock-2-uuid', subtotal: 300, discount: null, total: 300, oversold: true, device_id: 'pos', payment_method: 'gcash', customer_handle: null, created_at: iso(0, 14), status: 'voided', remarks: null,
    items: [{product_id: 'ZMYFDJRKCHKWHL01', name: 'Tasty Treats Chicken Jerky', qty: 1, unit_price: 300, line_total: 300}],
  },
  {
    id: 'mock-3', client_uuid: 'mock-3-uuid', subtotal: 340, discount: null, total: 340, oversold: false, device_id: 'pos', payment_method: 'card', customer_handle: 'Milo', created_at: iso(3), status: 'completed', remarks: 'Customer paid via bank transfer',
    items: [{product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', qty: 2, unit_price: 170, line_total: 340}],
  },
  {
    id: 'mock-4', client_uuid: 'mock-4-uuid', subtotal: 200, discount: null, total: 200, oversold: false, device_id: 'pos', payment_method: 'gcash', customer_handle: null, created_at: iso(12), status: 'completed', remarks: null,
    items: [{product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 1, unit_price: 200, line_total: 200}],
  },
  {
    id: 'mock-5', client_uuid: 'mock-5-uuid', subtotal: 510, discount: null, total: 510, oversold: false, device_id: 'pos', payment_method: 'cash', customer_handle: 'Coco (@coco.corgi)', created_at: iso(25), status: 'completed', remarks: null,
    items: [
      {product_id: 'ZMYFDMEATSLMWHL01', name: 'Meaty Treats Salmon', qty: 1, unit_price: 200, line_total: 200},
      {product_id: 'ZMYFDJRKDCKWHL01', name: 'Tasty Treats Duck Jerky', qty: 1, unit_price: 310, line_total: 310},
    ],
  },
  {
    // A "Buy Any 4" bundle sale recorded the new way: one bundle line carries the
    // ₱570 (revenue -> Top bundles), the 4 picks ride along at ₱0 (for inventory).
    id: 'mock-6', client_uuid: 'mock-6-uuid', subtotal: 570, discount: null, total: 570, oversold: false, device_id: 'pos', payment_method: 'qrph', customer_handle: 'Nala', created_at: iso(1, 11), status: 'completed', remarks: null,
    items: [
      {product_id: null, bundle_id: 'offline-event-buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
      {product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRCGRCUB01', name: 'Freeze-Dried Cat Grass Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRDCKBRT01', name: 'Freeze-Dried Duck Breast Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRCHKBRT01', name: 'Freeze-Dried Chicken Breast Cubes', qty: 1, unit_price: 0, line_total: 0},
    ],
  },
];

export const MOCK_POS_SYNC_LOG: PosSyncEntry[] = [
  {synced_at: iso(0, 9), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
  {synced_at: iso(0, 8), direction: 'pull', entity: 'catalog', summary: {count: 26}, device_id: 'pos'},
  {synced_at: iso(3), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
];
