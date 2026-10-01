// The relations Ask Coop may read, per read mode. One allowlist, used by the
// runtime guard (guarded-fetch.ts), the client type and the tests.

export const CHAT_READ_MODES = ['ro_role', 'guarded_service'] as const;
export type ChatReadMode = (typeof CHAT_READ_MODES)[number];

/** Columns that identify a customer. They may never be selected or filtered on. */
export const FORBIDDEN_COLUMNS: readonly string[] = Object.freeze([
  'customer_handle',
  'remarks',
  'phone',
  'email',
  'instagram',
  'customer_name',
  'client_uuid',
  'device_id',
]);

// ro_role: dashboard-owned definer views (created in F2, not yet present).
// guarded_service: base tables with explicit column lists that omit
// customer-level columns (edited_at is fine).
const ORDER_COLS = 'id,subtotal,discount,total,oversold,payment_method,status,created_at,edited_at,event_id,pet_type';
const ITEM_COLS = 'order_id,product_id,bundle_id,bundle_group,qty,unit_price,line_total';

export const CHAT_RELATIONS = Object.freeze({
  ro_role: Object.freeze({
    tables: Object.freeze({
      orders: 'coop_chat_orders',
      items: 'coop_chat_order_items',
      products: 'coop_chat_products',
      bundles: 'coop_chat_bundles',
    }),
    columns: Object.freeze({orders: ORDER_COLS, items: ITEM_COLS, products: 'product_id,name', bundles: 'bundle_id,name'}),
  }),
  guarded_service: Object.freeze({
    tables: Object.freeze({
      orders: 'pos_orders',
      items: 'pos_order_items',
      products: 'pos_products',
      bundles: 'pos_bundles',
    }),
    columns: Object.freeze({orders: ORDER_COLS, items: ITEM_COLS, products: 'product_id,name', bundles: 'bundle_id,name'}),
  }),
});

/** Every relation name any mode may read (the client's `from` type). */
export type ChatRelation =
  | (typeof CHAT_RELATIONS)['ro_role']['tables'][keyof (typeof CHAT_RELATIONS)['ro_role']['tables']]
  | (typeof CHAT_RELATIONS)['guarded_service']['tables'][keyof (typeof CHAT_RELATIONS)['guarded_service']['tables']];

export interface ChatRelationSet {
  tables: {orders: string; items: string; products: string; bundles: string};
  columns: {orders: string; items: string; products: string; bundles: string};
  /** The names the guard allows for this mode. */
  allowed: readonly string[];
}

export function relationsForMode(mode: ChatReadMode): ChatRelationSet {
  const r = CHAT_RELATIONS[mode];
  return {tables: r.tables, columns: r.columns, allowed: Object.freeze(Object.values(r.tables))};
}
