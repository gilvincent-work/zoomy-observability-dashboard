import {describe, it, expect} from 'vitest';
import type {ChatReadClient} from '../src/chat/read/client';
import {readChatOrders} from '../src/chat/read/pos-orders';

// Type-level tests: `npx tsc --noEmit` (tsconfig includes test/**) fails if any
// expect-error line below stops being an error. client.ts imports 'server-only',
// so only types are imported from it.
declare const c: ChatReadClient;

describe('ChatReadClient type', () => {
  it('exposes only from(allowed).select(...)', () => {
    const typeChecks = () => {
      c.from('pos_orders').select('id').order('id').range(0, 9).eq('status', 'completed').in('id', ['a']).gte('total', 1).lte('total', 2).limit(1).or('id.eq.1');
      c.from('coop_chat_orders').select('id');
      void readChatOrders(c, 'guarded_service'); // narrowed client satisfies the shared read type

      // @ts-expect-error no insert
      c.from('pos_orders').insert({});
      // @ts-expect-error no update
      c.from('pos_orders').update({});
      // @ts-expect-error no upsert
      c.from('pos_orders').upsert({});
      // @ts-expect-error no delete
      c.from('pos_orders').delete();
      // @ts-expect-error no rpc
      c.rpc('void_pos_order');
      // @ts-expect-error no storage
      c.storage;
      // @ts-expect-error no auth
      c.auth;
      // @ts-expect-error relation not allowed
      c.from('not_allowed');
      // @ts-expect-error no insert on the select builder either
      c.from('pos_orders').select('id').insert({});
    };
    expect(typeof typeChecks).toBe('function');
  });
});
