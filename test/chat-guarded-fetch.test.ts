import {describe, it, expect, vi} from 'vitest';
import {createGuardedFetch} from '../src/chat/read/guarded-fetch';
import {relationsForMode} from '../src/chat/read/relations';

const BASE = 'https://proj.supabase.co';
const SAFE = 'id,total,created_at';

function setup() {
  const underlying = vi.fn(async () => new Response('[]', {status: 200})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const onTrip = vi.fn();
  const g = createGuardedFetch({baseUrl: BASE, relations: relationsForMode('guarded_service').allowed, underlying, onTrip});
  return {...g, underlying, onTrip};
}
const ok = (rel = 'pos_orders', q = `select=${SAFE}`) => `${BASE}/rest/v1/${rel}?${q}`;

describe('guarded fetch', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s throws, counts, and never reaches the network', async (method) => {
    const {fetch: f, stats, underlying, onTrip} = setup();
    await expect(f(ok(), {method})).rejects.toThrow(/chat read guard/);
    expect(stats.attemptedNonRead).toBe(1);
    expect(stats.blocked[0]).toMatchObject({method});
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(underlying).not.toHaveBeenCalled();
  });

  const blockedUrls: Record<string, string> = {
    rpc: `${BASE}/rest/v1/rpc/void_pos_order`,
    'not allowlisted': ok('pos_inventory'),
    'base table in ro mode name': ok('coop_chat_orders'),
    storage: `${BASE}/storage/v1/object/list/x`,
    auth: `${BASE}/auth/v1/admin/users`,
    functions: `${BASE}/functions/v1/send`,
    graphql: `${BASE}/graphql/v1`,
    'other host': `https://evil.example/rest/v1/pos_orders?select=${SAFE}`,
    'userinfo host trick': `https://proj.supabase.co@evil.example/rest/v1/pos_orders?select=${SAFE}`,
    'select=*': ok('pos_orders', 'select=*'),
    'no select': ok('pos_orders', 'limit=5'),
    'forbidden column': ok('pos_orders', 'select=id,customer_handle'),
    'aliased forbidden column': ok('pos_orders', 'select=h:customer_handle'),
    'embed star': ok('pos_orders', 'select=id,pos_order_items(*)'),
    'or on forbidden column': ok('pos_orders', `select=${SAFE}&or=(remarks.ilike.*x*,id.eq.1)`),
    'filter on forbidden column': ok('pos_orders', `select=${SAFE}&customer_handle=eq.x`),
    'order by forbidden column': ok('pos_orders', `select=${SAFE}&order=customer_handle.asc`),
    'trailing path': `${BASE}/rest/v1/pos_orders/extra?select=${SAFE}`,
    'percent-encoded relation': `${BASE}/rest/v1/pos%5forders?select=${SAFE}`,
    'percent-encoded dots': `${BASE}/rest/v1/%2e%2e/rpc/x?select=${SAFE}`,
    'double slash': `${BASE}/rest/v1//pos_orders?select=${SAFE}`,
    'dot dot': `${BASE}/rest/v1/pos_orders/../rpc/x?select=${SAFE}`,
    'dot dot to storage': `${BASE}/rest/v1/../../storage/v1/x?select=${SAFE}`,
    'uppercase relation': `${BASE}/rest/v1/POS_ORDERS?select=${SAFE}`,
  };
  it.each(Object.entries(blockedUrls))('blocks GET: %s', async (_name, url) => {
    const {fetch: f, stats, underlying} = setup();
    await expect(f(url)).rejects.toThrow(/chat read guard/);
    expect(stats.attemptedNonRead).toBe(1);
    expect(stats.allowed).toBe(0);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('passes GET and HEAD on an allowed relation unchanged, and counts them', async () => {
    const {fetch: f, stats, underlying} = setup();
    const init = {headers: {apikey: 'k'}};
    await f(ok(), init);
    await f(ok('pos_order_items', 'select=order_id,qty&order=id.asc&offset=0&limit=1000'), {...init, method: 'HEAD'});
    await f(new URL(ok('pos_products', 'select=product_id,name')));
    expect(stats.allowed).toBe(3);
    expect(stats.attemptedNonRead).toBe(0);
    expect(underlying).toHaveBeenCalledTimes(3);
    expect((underlying as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([ok(), init]);
  });

  it('reads the method from a Request object too', async () => {
    const {fetch: f, underlying} = setup();
    await expect(f(new Request(ok(), {method: 'POST', body: '{}'}))).rejects.toThrow(/POST/);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('allows the relations of the chosen mode only', async () => {
    const ro = createGuardedFetch({baseUrl: BASE, relations: relationsForMode('ro_role').allowed, underlying: vi.fn(async () => new Response('[]')) as never});
    await expect(ro.fetch(ok('pos_orders'))).rejects.toThrow(/not allowlisted/);
    await expect(ro.fetch(ok('coop_chat_orders'))).resolves.toBeInstanceOf(Response);
  });
});
