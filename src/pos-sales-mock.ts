import type {PosEvent, PosOrder, PosSyncEntry} from './pos-sales-types';

// Mock offline sales for local dashboard work when the Supabase pos_* env is
// absent (mirrors src/pos-mock.ts). Dates are relative to "now" so the range
// filter has something to show in every bucket.
function iso(daysAgo: number, hour = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** A YYYY-MM-DD calendar date, `daysAgo` before today (UTC). */
function day(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const MOCK_EVENT_ID = 'mock-event-pet-expo';

export const MOCK_POS_ORDERS: PosOrder[] = [
  {
    id: 'mock-1', client_uuid: 'mock-1-uuid', subtotal: 540, discount: null, total: 540, oversold: false, device_id: 'pos', payment_method: 'cash', customer_handle: '@daisy_the_pug', created_at: iso(0, 9), status: 'completed', remarks: null, edited_at: null, event_id: MOCK_EVENT_ID, pet_type: 'dog',
    items: [
      {product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 2, unit_price: 200, line_total: 400},
      {product_id: 'ZMYFDFDRSLMCUB01', name: 'Freeze-Dried Salmon Cubes', qty: 1, unit_price: 140, line_total: 140},
    ],
  },
  {
    id: 'mock-2', client_uuid: 'mock-2-uuid', subtotal: 300, discount: null, total: 300, oversold: true, device_id: 'pos', payment_method: 'gcash', customer_handle: null, created_at: iso(0, 14), status: 'voided', remarks: null, edited_at: null, event_id: MOCK_EVENT_ID, pet_type: 'cat',
    items: [{product_id: 'ZMYFDJRKCHKWHL01', name: 'Tasty Treats Chicken Jerky', qty: 1, unit_price: 300, line_total: 300}],
  },
  {
    id: 'mock-3', client_uuid: 'mock-3-uuid', subtotal: 340, discount: null, total: 340, oversold: false, device_id: 'pos', payment_method: 'card', customer_handle: 'Milo', created_at: iso(3), status: 'completed', remarks: 'Customer paid via bank transfer', edited_at: iso(2), event_id: null, pet_type: 'both',
    items: [{product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', qty: 2, unit_price: 170, line_total: 340}],
  },
  {
    id: 'mock-4', client_uuid: 'mock-4-uuid', subtotal: 200, discount: null, total: 200, oversold: false, device_id: 'pos', payment_method: 'gcash', customer_handle: null, created_at: iso(12), status: 'completed', remarks: null, edited_at: null, event_id: null, pet_type: null,
    items: [{product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', qty: 1, unit_price: 200, line_total: 200}],
  },
  {
    id: 'mock-5', client_uuid: 'mock-5-uuid', subtotal: 510, discount: null, total: 510, oversold: false, device_id: 'pos', payment_method: 'cash', customer_handle: 'Coco (@coco.corgi)', created_at: iso(25), status: 'completed', remarks: null, edited_at: null, event_id: null, pet_type: 'dog',
    items: [
      {product_id: 'ZMYFDMEATSLMWHL01', name: 'Meaty Treats Salmon', qty: 1, unit_price: 200, line_total: 200},
      {product_id: 'ZMYFDJRKDCKWHL01', name: 'Tasty Treats Duck Jerky', qty: 1, unit_price: 310, line_total: 310},
    ],
  },
  {
    // A "Buy Any 4" bundle sale recorded the new way: one bundle line carries the
    // ₱570 (revenue -> Top bundles), the 4 picks ride along at ₱0 (for inventory).
    id: 'mock-6', client_uuid: 'mock-6-uuid', subtotal: 570, discount: null, total: 570, oversold: false, device_id: 'pos', payment_method: 'qrph', customer_handle: 'Nala', created_at: iso(1, 11), status: 'completed', remarks: null, edited_at: null, event_id: MOCK_EVENT_ID, pet_type: 'cat',
    items: [
      {product_id: null, bundle_id: 'offline-event-buy-any-4', name: 'Buy Any 4', qty: 1, unit_price: 570, line_total: 570},
      {product_id: 'ZMYFDFDRBEFLVR01', name: 'Freeze-Dried Beef Liver Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRCGRCUB01', name: 'Freeze-Dried Cat Grass Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRDCKBRT01', name: 'Freeze-Dried Duck Breast Cubes', qty: 1, unit_price: 0, line_total: 0},
      {product_id: 'ZMYFDFDRCHKBRT01', name: 'Freeze-Dried Chicken Breast Cubes', qty: 1, unit_price: 0, line_total: 0},
    ],
  },
];

export const MOCK_POS_EVENTS: PosEvent[] = [
  {
    // Active event: three mock sales carry this event_id (mock-1, voided mock-2,
    // mock-6), so its rollup shows cash + non-cash revenue and an expected till.
    event_id: MOCK_EVENT_ID,
    name: 'Pet Expo Manila',
    venue: 'World Trade Center',
    city: 'Pasay',
    organizer: 'Zoomy for Pets',
    starts_on: day(1),
    ends_on: day(0),
    opening_cash: 2000,
    cash_note: 'Float: 20x100.',
    closing_cash: null,
    status: 'active',
    created_by: 'pos',
    created_at: iso(2, 8),
    updated_at: iso(0, 9),
  },
  {
    // A closed event with no mock sales tied to it — exercises the zeroed rollup
    // and a counted closing_cash against its opening float.
    event_id: 'mock-event-makati-market',
    name: 'Makati Weekend Market',
    venue: 'Legazpi Sunday Market',
    city: 'Makati',
    organizer: 'Legazpi Active Neighborhood Assoc.',
    starts_on: day(40),
    ends_on: day(40),
    opening_cash: 1500,
    cash_note: null,
    closing_cash: 1500,
    status: 'closed',
    created_by: 'pos',
    created_at: iso(41, 8),
    updated_at: iso(40, 18),
  },
];

export const MOCK_POS_SYNC_LOG: PosSyncEntry[] = [
  {synced_at: iso(0, 9), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
  {synced_at: iso(0, 8), direction: 'pull', entity: 'catalog', summary: {count: 26}, device_id: 'pos'},
  {synced_at: iso(3), direction: 'push', entity: 'order', summary: {count: 1}, device_id: 'pos'},
];
