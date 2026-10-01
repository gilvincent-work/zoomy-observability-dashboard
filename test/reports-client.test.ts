import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {assertLocalIfRequired, createReportsGuardedFetch, isMissingTable, reportsReadClient, reportsWriteClient, usingReportsMock, type GuardMode} from '../src/reports-client';

const BASE = 'https://proj.example.test';
const ENV = {SUPABASE_URL_ARCHIVE: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'fake-key-not-real'};
const ok = () => new Response('[]', {status: 200, headers: {'content-type': 'application/json'}});

function guard(mode: GuardMode) {
  const underlying = vi.fn(async () => ok());
  const onTrip = vi.fn();
  const g = createReportsGuardedFetch({baseUrl: BASE, mode, underlying: underlying as unknown as typeof fetch, onTrip});
  return {...g, underlying, onTrip};
}
const patch = (body: unknown = {title: 'New title'}): RequestInit => ({method: 'PATCH', body: JSON.stringify(body)});

describe('guard: the read client', () => {
  it('allows GET and HEAD on the two tables (select=* is fine: no PII here)', async () => {
    const {fetch: f, underlying, stats} = guard('read');
    await f(`${BASE}/rest/v1/coop_reports?select=*&deleted_at=is.null`);
    await f(`${BASE}/rest/v1/coop_report_versions?select=version&report_id=eq.1`, {method: 'GET'});
    await f(`${BASE}/rest/v1/coop_reports?select=id`, {method: 'HEAD'});
    expect(underlying).toHaveBeenCalledTimes(3);
    expect(stats).toMatchObject({allowed: 3, blocked: []});
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('%s throws without reaching the network', async (method) => {
    const {fetch: f, underlying, stats} = guard('read');
    await expect(f(`${BASE}/rest/v1/coop_reports?id=eq.1`, {method, body: '{}'})).rejects.toThrow(/reports guard/);
    expect(underlying).not.toHaveBeenCalled();
    expect(stats.blocked).toHaveLength(1);
  });
});

describe('Slice 4 #13: the write client refuses everything but its two tables, GET, POST and PATCH', () => {
  it('allows GET, POST (insert) and PATCH with an id filter on the report tables', async () => {
    const {fetch: f, underlying, stats} = guard('write');
    await f(`${BASE}/rest/v1/coop_reports?select=*&id=eq.1`);
    await f(`${BASE}/rest/v1/coop_reports`, {method: 'POST', body: '{"owner_email":"a@x.test","title":"t"}', headers: {Prefer: 'return=representation'}});
    await f(`${BASE}/rest/v1/coop_report_versions`, {method: 'POST', body: '{}', headers: new Headers({prefer: 'return=representation'})});
    await f(`${BASE}/rest/v1/coop_reports?id=eq.7&current_version=eq.2&deleted_at=is.null&select=id`, patch({current_version: 3, updated_at: 'now', title: 'x'}));
    expect(underlying).toHaveBeenCalledTimes(4);
    expect(stats.blocked).toEqual([]);
  });

  it.each([
    ['another table (pos_orders)', `${BASE}/rest/v1/pos_orders?select=id`, {}],
    ['another table written (pos_settings)', `${BASE}/rest/v1/pos_settings`, {method: 'POST', body: '{}'}],
    ['a chat view', `${BASE}/rest/v1/coop_chat_orders?select=id`, {}],
    ['DELETE on a report table', `${BASE}/rest/v1/coop_reports?id=eq.1`, {method: 'DELETE'}],
    ['DELETE on versions', `${BASE}/rest/v1/coop_report_versions?report_id=eq.1`, {method: 'DELETE'}],
    ['PUT', `${BASE}/rest/v1/coop_reports?id=eq.1`, {method: 'PUT', body: '{}'}],
    ['an rpc call', `${BASE}/rest/v1/rpc/reprice_product`, {method: 'POST', body: '{}'}],
    ['an rpc call, upper case', `${BASE}/REST/V1/RPC/x`, {method: 'POST', body: '{}'}],
    ['storage', `${BASE}/storage/v1/object/list/x`, {}],
    ['auth admin', `${BASE}/auth/v1/admin/users`, {}],
    ['functions', `${BASE}/functions/v1/send`, {method: 'POST', body: '{}'}],
    ['graphql', `${BASE}/graphql/v1`, {method: 'POST', body: '{}'}],
    ['another host', `https://evil.example.test/rest/v1/coop_reports?select=id`, {}],
    ['another port', `https://proj.example.test:8443/rest/v1/coop_reports?select=id`, {}],
    ['path traversal', `${BASE}/rest/v1/coop_reports/../pos_orders?select=id`, {}],
    ['encoded traversal', `${BASE}/rest/v1/coop_reports/%2e%2e/pos_orders`, {}],
    ['a backslash path', `${BASE}/rest/v1/coop_reports\\..\\pos_orders`, {}],
    ['a trailing slash', `${BASE}/rest/v1/coop_reports/`, {}],
    ['the REST root', `${BASE}/rest/v1/`, {}],
    ['a fragment', `${BASE}/rest/v1/coop_reports?select=id#x`, {}],
    ['garbage', 'not a url', {}],
  ] as [string, string, RequestInit][])('throws for %s', async (_name, url, init) => {
    const {fetch: f, underlying, onTrip, stats} = guard('write');
    await expect(f(url, init)).rejects.toThrow(/reports guard/);
    expect(underlying).not.toHaveBeenCalled();
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(stats.blocked).toHaveLength(1);
    expect(stats.allowed).toBe(0);
  });

  it('counts every blocked attempt and keeps the method and path (no host, no query secrets beyond the path)', async () => {
    const {fetch: f, stats} = guard('write');
    for (const m of ['DELETE', 'PUT']) await f(`${BASE}/rest/v1/coop_reports`, {method: m}).catch(() => undefined);
    expect(stats.blocked.map((b) => `${b.method} ${b.path}`)).toEqual(['DELETE /rest/v1/coop_reports', 'PUT /rest/v1/coop_reports']);
  });

  describe('PATCH is narrow', () => {
    it.each([
      ['no filter at all (a bulk update of the table)', `${BASE}/rest/v1/coop_reports`, patch()],
      ['only a non-id filter', `${BASE}/rest/v1/coop_reports?pinned=eq.true`, patch()],
      ['an empty id filter', `${BASE}/rest/v1/coop_reports?id=eq.`, patch()],
      ['an id that is not an eq filter', `${BASE}/rest/v1/coop_reports?id=neq.1`, patch()],
      ['an in filter (many rows)', `${BASE}/rest/v1/coop_reports?id=in.(1,2)`, patch()],
      ['the immutable versions table', `${BASE}/rest/v1/coop_report_versions?report_id=eq.1&version=eq.1`, patch({source_prompt: 'x'})],
      ['a body that sets owner_email', `${BASE}/rest/v1/coop_reports?id=eq.1`, patch({owner_email: 'me@x.test'})],
      ['a body that sets id', `${BASE}/rest/v1/coop_reports?id=eq.1`, patch({id: '2'})],
      ['a body that is not JSON', `${BASE}/rest/v1/coop_reports?id=eq.1`, {method: 'PATCH', body: 'title=x'}],
      ['a body that is an array', `${BASE}/rest/v1/coop_reports?id=eq.1`, {method: 'PATCH', body: '[{"title":"x"}]'}],
      ['no body', `${BASE}/rest/v1/coop_reports?id=eq.1`, {method: 'PATCH'}],
    ] as [string, string, RequestInit][])('refuses %s', async (_n, url, init) => {
      const {fetch: f, underlying} = guard('write');
      await expect(f(url, init)).rejects.toThrow(/reports guard/);
      expect(underlying).not.toHaveBeenCalled();
    });
  });

  describe('POST cannot become an upsert (versions are immutable)', () => {
    it('refuses on_conflict and Prefer: resolution=', async () => {
      const {fetch: f, underlying} = guard('write');
      await expect(f(`${BASE}/rest/v1/coop_report_versions?on_conflict=report_id,version`, {method: 'POST', body: '{}'})).rejects.toThrow(/upsert/);
      await expect(f(`${BASE}/rest/v1/coop_report_versions`, {method: 'POST', body: '{}', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'}})).rejects.toThrow(/upsert/);
      expect(underlying).not.toHaveBeenCalled();
    });
  });
});

describe('the clients (real supabase-js behind the guard, fake network)', () => {
  const make = () => {
    const underlying = vi.fn(async (_u: unknown, _i?: RequestInit) => ok());
    const onTrip = vi.fn();
    return {underlying, onTrip, opts: {env: ENV, underlying: underlying as unknown as typeof fetch, onTrip}};
  };
  const urlOf = (u: unknown) => String(u);

  it('the write client sends a filtered PATCH, an insert and a read as the guard allows', async () => {
    const {underlying, opts} = make();
    const {client, stats} = reportsWriteClient(opts);
    await client.from('coop_reports').update({title: 'x', updated_at: 'now'}).eq('id', '1').eq('current_version', 2).is('deleted_at', null).select('id');
    await client.from('coop_report_versions').insert({report_id: '1', version: 3}).select('version');
    await client.from('coop_reports').select('id,title').eq('id', '1').maybeSingle();
    const calls = underlying.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${urlOf(u).replace(ENV.SUPABASE_URL_ARCHIVE, '')}`);
    expect(calls[0]).toMatch(/^PATCH \/rest\/v1\/coop_reports\?id=eq\.1&current_version=eq\.2&deleted_at=is\.null/);
    expect(calls[1]).toBe('POST /rest/v1/coop_report_versions?select=version');
    expect(calls[2]).toMatch(/^GET \/rest\/v1\/coop_reports\?select=id%2Ctitle&id=eq\.1/);
    expect(stats.blocked).toEqual([]);
  });

  it('Slice 4 #13: another table throws at from(), and delete / upsert / rpc do not exist on the client (TypeError)', () => {
    const {underlying, opts} = make();
    const {client} = reportsWriteClient(opts);
    const loose = client as unknown as {from(t: string): Record<string, unknown>; rpc?: unknown};
    expect(() => loose.from('pos_orders')).toThrow(/not a reports table/);
    expect(() => loose.from('coop_chat_orders')).toThrow(/not a reports table/);
    const builder = loose.from('coop_reports') as {delete?: () => unknown; upsert?: () => unknown};
    expect(() => (builder.delete as () => unknown)()).toThrow(TypeError);
    expect(() => (builder.upsert as () => unknown)()).toThrow(TypeError);
    expect(() => (loose.rpc as () => unknown)()).toThrow(TypeError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('a request the guard refuses THROWS out of the client (supabase-js would have swallowed it) and counts a trip', async () => {
    const {underlying, onTrip, opts} = make();
    const {client, stats} = reportsWriteClient(opts);
    // A bulk PATCH: types allow update(), the guard does not allow it without an id filter.
    await expect(client.from('coop_reports').update({pinned: true}).select('id')).rejects.toThrow(/reports guard: PATCH needs an id=eq/);
    await expect(client.from('coop_reports').update({owner_email: 'me@x.test'}).eq('id', '1').select('id')).rejects.toThrow(/owner_email/);
    expect(underlying).not.toHaveBeenCalled();
    expect(onTrip).toHaveBeenCalledTimes(2);
    expect(stats.blocked).toHaveLength(2);
  });

  it('the read client has no write methods at all and refuses a write the guard would also refuse', () => {
    const {underlying, opts} = make();
    const {client} = reportsReadClient(opts);
    const builder = client.from('coop_reports') as unknown as {insert?: () => unknown; update?: () => unknown};
    expect(builder.insert).toBeUndefined();
    expect(builder.update).toBeUndefined();
    expect(() => (builder.insert as () => unknown)()).toThrow(TypeError);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('read results pass through untouched', async () => {
    const underlying = vi.fn(async () => new Response(JSON.stringify([{id: '1', title: 'T'}]), {status: 200, headers: {'content-type': 'application/json'}}));
    const {client} = reportsReadClient({env: ENV, underlying: underlying as unknown as typeof fetch});
    const res = await client.from('coop_reports').select('id,title').eq('id', '1');
    expect(res.error).toBeNull();
    expect(res.data).toEqual([{id: '1', title: 'T'}]);
  });
});

describe('COOP_REQUIRE_LOCAL_DB: both clients refuse a non-local database at creation', () => {
  const env = (url: string, flag?: string) => ({SUPABASE_URL_ARCHIVE: url, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'fake-key-not-real', COOP_REQUIRE_LOCAL_DB: flag});

  it.each([
    'https://abcdefghijklmnop.supabase.co',
    'https://abcdefghijklmnop.supabase.co/',
    'https://127.0.0.1.evil.example.com',
    'https://localhost.evil.example.com',
    'https://user@evil.example.com/localhost',
    'http://10.0.0.5:54321',
    'http://[::1]:54321',
    'not a url',
  ])('throws for %s when the flag is 1 (read and write)', (url) => {
    expect(() => reportsReadClient({env: env(url, '1')})).toThrow(/COOP_REQUIRE_LOCAL_DB/);
    expect(() => reportsWriteClient({env: env(url, '1')})).toThrow(/COOP_REQUIRE_LOCAL_DB/);
    expect(() => assertLocalIfRequired(url, env(url, '1'))).toThrow(/COOP_REQUIRE_LOCAL_DB/);
  });

  it.each(['http://127.0.0.1:54321', 'http://localhost:54321', 'http://127.0.0.1:8000/'])('allows %s with the flag on', (url) => {
    expect(() => reportsReadClient({env: env(url, '1')})).not.toThrow();
    expect(() => reportsWriteClient({env: env(url, '1')})).not.toThrow();
  });

  it('only the exact value 1 turns it on (flag off or unset leaves hosted URLs alone: the dev launcher sets it)', () => {
    for (const flag of [undefined, '', '0', 'true']) expect(() => reportsWriteClient({env: env('https://abcdefghijklmnop.supabase.co', flag)})).not.toThrow();
  });

  it('a thrown check makes no network call', () => {
    const underlying = vi.fn();
    expect(() => reportsWriteClient({env: env('https://abcdefghijklmnop.supabase.co', '1'), underlying: underlying as unknown as typeof fetch})).toThrow();
    expect(underlying).not.toHaveBeenCalled();
  });
});

describe('env and error helpers', () => {
  it('usingReportsMock is true when either Supabase variable is missing', () => {
    expect(usingReportsMock({})).toBe(true);
    expect(usingReportsMock({SUPABASE_URL_ARCHIVE: 'x'})).toBe(true);
    expect(usingReportsMock({SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'x'})).toBe(true);
    expect(usingReportsMock(ENV)).toBe(false);
  });
  it('creating a client with no env throws', () => {
    expect(() => reportsWriteClient({env: {}})).toThrow(/not configured/);
  });
  it('isMissingTable recognises the PostgREST and Postgres missing-table errors only', () => {
    expect(isMissingTable({code: 'PGRST205', message: "Could not find the table 'public.coop_reports' in the schema cache"})).toBe(true);
    expect(isMissingTable({code: '42P01', message: 'relation "coop_reports" does not exist'})).toBe(true);
    expect(isMissingTable({message: 'Could not find the table public.coop_reports'})).toBe(true);
    expect(isMissingTable({code: '42703', message: 'column "x" does not exist'})).toBe(false);
    expect(isMissingTable({message: 'boom'})).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
