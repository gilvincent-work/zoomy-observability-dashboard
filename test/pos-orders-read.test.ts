import {describe, it, expect} from 'vitest';
import {readPosOrders, type ReadClient} from '../src/pos-orders-read';
import {readChatOrders} from '../src/chat/read/pos-orders';
import {relationsForMode, FORBIDDEN_COLUMNS} from '../src/chat/read/relations';
import type {PosOrder} from '../src/pos-sales-types';

type Row = Record<string, unknown>;
interface Call {relation: string; columns: string}

/** Fake paged client: honors .range(), caps each response at 1000 like PostgREST. */
function fakeClient(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const client: ReadClient = {
    from(relation) {
      return {
        select(columns) {
          calls.push({relation, columns});
          const rows = tables[relation] ?? [];
          let from = 0;
          let to = 999;
          const builder = {
            order: () => builder,
            range: (f: number, t: number) => {
              from = f;
              to = t;
              return builder;
            },
            then: <R1, R2>(ok?: (v: {data: Row[]; error: null}) => R1, no?: (e: unknown) => R2) =>
              Promise.resolve({data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null}).then(ok, no),
          };
          return builder as never;
        },
      };
    },
  };
  return {client, calls};
}

const fixture = {
  pos_orders: [
    {id: 'o1', client_uuid: 'u1', subtotal: '300', discount: '30', total: '270', oversold: false, device_id: 'd1', payment_method: 'gcash', customer_handle: '@bean', status: 'completed', remarks: 'note', created_at: '2026-09-20T10:00:00Z', edited_at: null, event_id: 'ev1', pet_type: 'dog'},
    {id: 'o2', client_uuid: 'u2', subtotal: 100, discount: null, total: 100, oversold: true, device_id: null, payment_method: null, customer_handle: null, status: 'voided', remarks: null, created_at: '2026-09-19T10:00:00Z', edited_at: '2026-09-19T11:00:00Z', event_id: null, pet_type: 'weird'},
    {id: 'o3', client_uuid: 'u3', subtotal: 50, discount: 0, total: 50, oversold: false, device_id: 'd1', payment_method: 'cash', customer_handle: null, status: 'completed', remarks: null, created_at: '2026-09-18T10:00:00Z', edited_at: null, event_id: null, pet_type: 'both'},
  ],
  pos_order_items: [
    {order_id: 'o1', product_id: 'SKU1', bundle_id: null, bundle_group: null, qty: 2, unit_price: '100', line_total: '200'},
    {order_id: 'o1', product_id: null, bundle_id: 'B1', bundle_group: 'g1', qty: 1, unit_price: '100', line_total: '100'},
    {order_id: 'o1', product_id: 'SKU2', bundle_id: null, bundle_group: 'g1', qty: 1, unit_price: 0, line_total: 0},
    {order_id: 'o2', product_id: 'SKUX', bundle_id: null, bundle_group: null, qty: null, unit_price: null, line_total: null},
  ],
  pos_products: [{product_id: 'SKU1', name: 'Salmon Bites'}, {product_id: 'SKU2', name: 'Tuna Chews'}],
  pos_bundles: [{bundle_id: 'B1', name: 'Starter Box'}],
};

// Literal output of the previous inline posOrdersCached implementation
// (git show HEAD:src/pos-sales.ts) on `fixture`.
const expected: PosOrder[] = [
  {
    id: 'o1', client_uuid: 'u1', subtotal: 300, discount: 30, total: 270, oversold: false, device_id: 'd1',
    payment_method: 'gcash', customer_handle: '@bean', status: 'completed', remarks: 'note',
    created_at: '2026-09-20T10:00:00Z', edited_at: null, event_id: 'ev1', pet_type: 'dog',
    items: [
      {product_id: 'SKU1', bundle_id: null, bundle_group: null, name: 'Salmon Bites', qty: 2, unit_price: 100, line_total: 200},
      {product_id: null, bundle_id: 'B1', bundle_group: 'g1', name: 'Starter Box', qty: 1, unit_price: 100, line_total: 100},
      {product_id: 'SKU2', bundle_id: null, bundle_group: 'g1', name: 'Tuna Chews', qty: 1, unit_price: 0, line_total: 0},
    ],
  },
  {
    id: 'o2', client_uuid: 'u2', subtotal: 100, discount: null, total: 100, oversold: true, device_id: null,
    payment_method: null, customer_handle: null, status: 'voided', remarks: null,
    created_at: '2026-09-19T10:00:00Z', edited_at: '2026-09-19T11:00:00Z', event_id: null, pet_type: null,
    items: [{product_id: 'SKUX', bundle_id: null, bundle_group: null, name: 'SKUX', qty: 0, unit_price: 0, line_total: 0}],
  },
  {
    id: 'o3', client_uuid: 'u3', subtotal: 50, discount: 0, total: 50, oversold: false, device_id: 'd1',
    payment_method: 'cash', customer_handle: null, status: 'completed', remarks: null,
    created_at: '2026-09-18T10:00:00Z', edited_at: null, event_id: null, pet_type: 'both', items: [],
  },
];

describe('readPosOrders', () => {
  it('default options reproduce the previous inline mapping exactly', async () => {
    const {client, calls} = fakeClient(fixture);
    expect(await readPosOrders(client)).toEqual(expected);
    expect(calls.map((c) => c.relation).sort()).toEqual(['pos_bundles', 'pos_order_items', 'pos_orders', 'pos_products']);
    expect(calls.find((c) => c.relation === 'pos_orders')?.columns).toBe(
      'id,client_uuid,subtotal,discount,total,oversold,device_id,payment_method,customer_handle,status,remarks,created_at,edited_at,event_id,pet_type',
    );
  });

  it('includes every item row across two pages (no 1000-row truncation)', async () => {
    const items = Array.from({length: 1352}, (_, i) => ({order_id: 'o1', product_id: 'SKU1', bundle_id: null, bundle_group: null, qty: 1, unit_price: 1, line_total: 1, n: i}));
    const {client} = fakeClient({...fixture, pos_order_items: items});
    const out = await readPosOrders(client);
    expect(out.find((o) => o.id === 'o1')?.items).toHaveLength(1352);
  });

  it('chat options never request customer-level columns', async () => {
    for (const mode of ['guarded_service', 'ro_role'] as const) {
      const rel = relationsForMode(mode);
      const tables = {
        [rel.tables.orders]: fixture.pos_orders.map(({customer_handle, remarks, client_uuid, device_id, ...rest}) => (void customer_handle, void remarks, void client_uuid, void device_id, rest)),
        [rel.tables.items]: fixture.pos_order_items,
        [rel.tables.products]: fixture.pos_products,
        [rel.tables.bundles]: fixture.pos_bundles,
      };
      const {client, calls} = fakeClient(tables);
      const out = await readChatOrders(client, mode);
      expect(calls.map((c) => c.relation).sort()).toEqual([rel.tables.orders, rel.tables.items, rel.tables.products, rel.tables.bundles].sort());
      for (const c of calls) {
        for (const col of FORBIDDEN_COLUMNS) expect(c.columns.split(',')).not.toContain(col);
      }
      expect(out).toHaveLength(3);
      expect(out[0]).toMatchObject({client_uuid: '', customer_handle: null, remarks: null, device_id: null});
      expect(out[0].items).toHaveLength(3);
    }
  });
});
