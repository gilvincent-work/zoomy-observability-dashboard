import {describe, expect, it} from 'vitest';
import type {RawQueryResult} from '../src/chat/explore/result';
import {createLiveValidator, createSchemaTools, LIST_TABLES_SQL, SCHEMA_CALLS_PER_QUESTION} from '../src/chat/explore/schema-tools';

const res = (rows: unknown[][]): RawQueryResult => ({columns: [], rows, fetched: rows.length, ms: 1});
const LIVE = [
  ['pos_orders', 'BASE TABLE'], ['marketplace_tokens', 'BASE TABLE'], ['gl_sales', 'BASE TABLE'], ['coop_explore_stock_event', 'VIEW'],
  ['brand_new_table', 'BASE TABLE'], ['explore_fixture_qxml_view', 'VIEW'], ['coop_explore_drift_log', 'BASE TABLE'],
];
const fake = (seen: string[]) => async (sent: string): Promise<RawQueryResult> => {
  seen.push(sent);
  if (sent.includes(LIST_TABLES_SQL)) return res(LIVE);
  if (sent.includes("c.table_name = 'explore_fixture_mixed'")) return res([['id', 'integer', 'NO', 'BASE TABLE'], ['label', 'text', 'YES', 'BASE TABLE'], ['api_key', 'text', 'YES', 'BASE TABLE']]);
  if (sent.includes("c.table_name = 'pos_orders'")) return res([['id', 'bigint', 'NO', 'BASE TABLE'], ['total', 'numeric', 'YES', 'BASE TABLE']]);
  if (sent.includes("c.table_name = 'explore_fixture_qxml_view'")) return res([['x', 'xml', 'YES', 'VIEW']]);
  return res([]);
};
type Listed = {tables: {table: string; domain: string | null; kind: string; about?: string}[]};

describe('2.3 list_tables and describe_table', () => {
  it('list_tables: live granted tables, closed names and unlisted views dropped, catalog notes merged', async () => {
    const t = createSchemaTools(fake([]));
    const out = (await t.list_tables({domain: 'all'})) as Listed;
    expect(out.tables.map((x) => x.table)).toEqual(['pos_orders', 'coop_explore_stock_event', 'brand_new_table', 'coop_explore_drift_log']);
    expect(out.tables.find((x) => x.table === 'pos_orders')?.domain).toBe('pos-sales');
    expect(out.tables.find((x) => x.table === 'brand_new_table')?.domain).toBeNull();
    const stock = (await t.list_tables({domain: 'pos-sales'})) as Listed;
    expect(stock.tables.map((x) => x.table)).toEqual(['pos_orders']);
  });
  it('list_tables is compact: one short line per table (the first sentence of the catalog note), no column lists', async () => {
    const out = (await createSchemaTools(fake([])).list_tables({domain: 'all'})) as Listed;
    for (const x of out.tables) expect((x.about ?? '').length, x.table).toBeLessThanOrEqual(160);
    expect(JSON.stringify(out)).not.toMatch(/client_uuid/); // pos_orders' column list stays in describe_table
  });
  it('describe_table: live columns, never a secret column, with catalog meaning', async () => {
    const t = createSchemaTools(fake([]));
    const mixed = (await t.describe_table({table: 'explore_fixture_mixed'})) as {columns: {name: string}[]};
    expect(mixed.columns.map((c) => c.name)).toEqual(['id', 'label']);
    const orders = (await t.describe_table({table: 'pos_orders'})) as {about: string | null; columns: {name: string; nullable: boolean}[]};
    expect(orders.about).toMatch(/sale/i);
    expect(orders.columns).toEqual([{name: 'id', type: 'bigint', nullable: false}, {name: 'total', type: 'numeric', nullable: true}]);
  });
  it('describe_table says a closed name is closed, and why, from the name rule (no database call)', async () => {
    const seen: string[] = [];
    const t = createSchemaTools(fake(seen));
    for (const table of ['gl_sales', 'gl_inventory_snapshots', 'company_users', 'companies']) {
      expect(await t.describe_table({table}), table).toEqual({error: expect.stringMatching(/^E_RELATION: .* is tenant-fenced/)});
    }
    for (const table of ['marketplace_tokens', 'explore_fixture_api_keys']) {
      expect(await t.describe_table({table}), table).toEqual({error: expect.stringMatching(/^E_RELATION: .* is not available to Ask Coop/)});
    }
    expect(seen).toHaveLength(0);
  });
  it('describe_table refuses a view that is not allowlisted even when the database lists it', async () => {
    expect(await createSchemaTools(fake([])).describe_table({table: 'explore_fixture_qxml_view'})).toMatchObject({error: expect.stringMatching(/^E_RELATION/)});
  });
  it('refuses malformed or unknown names without a database call, and caps calls per question', async () => {
    const seen: string[] = [];
    const t = createSchemaTools(fake(seen));
    for (const table of ['Pos_Orders', "x' or '1'='1", 42, '']) expect(await t.describe_table({table})).toMatchObject({error: expect.stringMatching(/^E_RELATION/)});
    expect(seen).toHaveLength(0);
    expect(await t.describe_table({table: 'no_such_table'})).toMatchObject({error: expect.stringMatching(/^E_RELATION/)});
    const capped = createSchemaTools(fake([]));
    for (let i = 0; i < SCHEMA_CALLS_PER_QUESTION; i++) await capped.list_tables({domain: 'all'});
    expect(await capped.list_tables({domain: 'all'})).toMatchObject({error: expect.stringMatching(/^E_CALLS/)});
  });
  it('a failing read is E_UNAVAILABLE, never a thrown error or database text', async () => {
    const t = createSchemaTools(async () => {
      throw new Error('raw db text');
    });
    expect(await t.list_tables({domain: 'all'})).toEqual({error: expect.stringMatching(/^E_UNAVAILABLE/)});
    expect(await t.describe_table({table: 'pos_orders'})).toEqual({error: expect.stringMatching(/^E_UNAVAILABLE/)});
  });
});

describe('2.1 the production validator uses the live relation kinds (views default-deny in the parser too)', () => {
  it('reads the list once per question; an unlisted or unknown relation is E_RELATION; the static rule is the fallback', async () => {
    const seen: string[] = [];
    const validate = createLiveValidator(fake(seen));
    expect((await validate('select o.id from pos_orders o')).ok).toBe(true);
    expect((await validate('select s.stock from coop_explore_stock_event s')).ok).toBe(true);
    expect(await validate('select x.x from explore_fixture_qxml_view x')).toMatchObject({ok: false, code: 'E_RELATION'});
    expect(await validate('select n.id from not_granted_table n')).toMatchObject({ok: false, code: 'E_RELATION'});
    expect(seen.filter((s) => s.includes(LIST_TABLES_SQL))).toHaveLength(1);
    const down = createLiveValidator(async () => {
      throw new Error('down');
    });
    expect((await down('select n.id from not_granted_table n')).ok).toBe(true); // the database stays the lock
    expect(await down('select m.marketplace from marketplace_tokens m')).toMatchObject({ok: false, code: 'E_RELATION'});
  });
});

describe('2.3 the tools are wired: allowlisted, dispatched only for Explore users, constant progress labels', () => {
  it('createExecutors exposes list_tables and describe_table only with exploreSchema; dispatch reaches them', async () => {
    const {createExecutors, statusFor} = await import('../src/chat/tool-executors');
    const {dispatchToolCall, isAllowedTool} = await import('../src/chat/tools');
    expect(isAllowedTool('list_tables') && isAllowedTool('describe_table')).toBe(true);
    const base = {data: async () => { throw new Error('unused'); }, now: new Date('2026-10-07T00:00:00Z'), user: null, emitBlock: () => {}};
    const off = createExecutors(base as never);
    expect(off.list_tables).toBeUndefined();
    const on = createExecutors({...base, exploreSchema: createSchemaTools(fake([]))} as never);
    const r = await dispatchToolCall({name: 'describe_table', input: {table: 'gl_sales'}}, on);
    expect(r.is_error).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/tenant-fenced/);
    expect(statusFor('list_tables', {domain: 'all'})).toBe('Listing the tables');
    expect(statusFor('describe_table', {table: 'pos_orders'})).toBe("Reading a table's columns");
  });
});
