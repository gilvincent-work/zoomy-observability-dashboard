import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {shapeDigest, DIGEST_SECTIONS, DIGEST_STALE_DAYS, type DigestSource} from '../src/chat/digest-lookup';
import {chatDigestClient} from '../src/chat/read/client';
import {readDigestRows, type DigestReadClient, type DigestRow} from '../src/chat/read/digest';
import {createGuardedFetch} from '../src/chat/read/guarded-fetch';
import {DIGEST_COLUMNS, digestRelationForMode, relationsForMode} from '../src/chat/read/relations';
import {createExecutors} from '../src/chat/tool-executors';
import {dispatchToolCall} from '../src/chat/tools';
import type {ChatToolContext} from '../src/chat/stream-types';
import type {ChatBlock} from '../src/chat/block-types';
import type {MetricData} from '../src/chat/result-types';
import type {DigestDocument} from '../src/types';

// F10 get_digest (design Slice 5): the digest adapter and its guard, the shaping, and the executor.
const NOW = new Date('2026-09-30T04:00:00Z'); // Philippine time: Sep 30
const QUOTE = 'FICTIONAL verbatim quote about stiff hips';
const BUNDLE_MARKER = 'SHOULD-NEVER-BE-SELECTED';

const doc = (over: Partial<DigestDocument> = {}): DigestDocument => ({
  window: {label: 'week of Sep 21 to 27', from: '2026-09-21T00:00:00.000Z', to: '2026-09-27T23:59:59.000Z'},
  degraded: false,
  headline: 'Lazada and Shopee both grew.',
  themes: [{theme: 'joints', displayName: 'Joint pain', quote: QUOTE, conversationId: 'c-1'}],
  comparison: {
    shopee: {revenue: 18400.5, orders: 41, aov: 448.8, units: 77, adSpend: 3100, roas: 2.9},
    lazada: {revenue: 26250, orders: 52, aov: 504.81, units: 96, adSpend: 4200.25, roas: 3.4},
    website: {revenue: 9120, orders: 14, aov: 651.43, units: 25, adSpend: null, roas: null},
  },
  figures: [
    {label: 'Conversations this week', value: 37, timeBasis: 'window'},
    {label: 'Total conversations (all-time)', value: 412, timeBasis: 'allTime'},
  ],
  recommendations: [],
  sales: {
    headline: 'Steady.',
    figures: [{label: 'Net revenue this week (PHP)', value: 9120, timeBasis: 'window'}, {label: 'Revenue change vs prior week (%)', value: 5, timeBasis: 'window'}],
    topProducts: [{title: 'Joint Support Chews', revenue: 2400}],
    watch: [],
    recommendations: [],
  },
  customers: {
    headline: 'Two new.',
    figures: [{label: 'New customers this week', value: 2, timeBasis: 'window'}],
    outreach: [{name: 'Maria Santos', list: 'vip', canEmail: true, note: 'FICTIONAL outreach note'}],
    recommendations: [],
  },
  shopee: {
    sales: {headline: 'ok', figures: [{label: 'Sales (PHP)', value: 18400.5, timeBasis: 'window'}], recommendations: [], window: {from: '2026-09-21', to: '2026-09-27', label: '21/09/2026 - 27/09/2026'}},
    products: {headline: 'ok', figures: [], recommendations: [], topProducts: [{title: 'Freeze Dried Munchies', revenue: 5200, units: 21}]},
  },
  lazada: {
    sales: {headline: 'ok', figures: [{label: 'Orders', value: 52, timeBasis: 'window'}], recommendations: [], topProducts: [{title: 'Meaty Treats', revenue: 4100, units: 16}]},
  },
  ...over,
});
const row = (d: DigestDocument, to: string): DigestRow => ({window_from: '2026-09-14T00:00:00+00:00', window_to: to, created_at: '2026-09-28T01:00:00+00:00', digest: d});
const LATEST = row(doc(), '2026-09-27T23:59:59+00:00');
const PREVIOUS = row(doc({headline: 'Quieter.', window: {label: 'week of Sep 14 to 20', from: '2026-09-14T00:00:00.000Z', to: '2026-09-20T23:59:59.000Z'}}), '2026-09-20T23:59:59+00:00');
const live = (rows: DigestRow[] = [LATEST, PREVIOUS]): DigestSource => ({source: 'live', rows});

type Out = Exclude<ReturnType<typeof shapeDigest>, {error: string}>;
const ok = (input: {window: string; section: string}, src: DigestSource | null = live(), now = NOW): Out => {
  const out = shapeDigest(input, src, now);
  if ('error' in out) throw new Error(out.error);
  return out;
};

describe('the digest adapter (src/chat/read/digest.ts)', () => {
  function fakeClient(data: unknown[] | null, error: {message: string} | null = null) {
    const calls: {relation: string; columns: string; order?: [string, unknown]; limit?: number}[] = [];
    const client: DigestReadClient = {
      from: (relation) => ({
        select: (columns) => {
          const call: (typeof calls)[number] = {relation, columns};
          calls.push(call);
          const b = {
            order: (c: string, o?: {ascending?: boolean}) => ((call.order = [c, o?.ascending]), b),
            limit: (n: number) => ((call.limit = n), b),
            then: (res: (v: {data: unknown[] | null; error: {message: string} | null}) => unknown) => Promise.resolve({data, error}).then(res),
          };
          return b as never;
        },
      }),
    };
    return {client, calls};
  }

  it('selects only the digest, its window and timestamp, newest first, up to twelve rows, and never bundle or *', async () => {
    const {client, calls} = fakeClient([{...LATEST}]);
    await readDigestRows(client, 'guarded_service');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({relation: 'digest_archive', columns: DIGEST_COLUMNS, order: ['window_to', false], limit: 12});
    expect(DIGEST_COLUMNS).toBe('window_from,window_to,digest,created_at');
    expect(calls[0].columns).not.toMatch(/bundle|\*/);
  });

  it('reads the definer view in ro_role mode and the table in guarded_service mode', () => {
    expect(digestRelationForMode('ro_role')).toBe('coop_chat_digest');
    expect(digestRelationForMode('guarded_service')).toBe('digest_archive');
  });

  it('masks customer names at the seam (outreach names become first name and initial)', async () => {
    const {client} = fakeClient([LATEST]);
    const [r] = await readDigestRows(client, 'ro_role');
    expect(r.digest.customers?.outreach[0].name).toBe('Maria S.');
  });

  it('drops a row it cannot use, and throws on a failed read', async () => {
    const {client} = fakeClient([{window_to: 5, digest: 'x'}, {window_to: '2026-09-27', digest: null}, LATEST]);
    expect(await readDigestRows(client, 'ro_role')).toHaveLength(1);
    await expect(readDigestRows(fakeClient(null, {message: 'boom'}).client, 'ro_role')).rejects.toThrow(/digest read failed: boom/);
  });
});

describe('the guard keeps `bundle` and every other table out of reach (Slice 5 criterion 3)', () => {
  const BASE = 'https://proj.supabase.co';
  const setup = (relations: readonly string[]) => {
    const underlying = vi.fn(async () => new Response('[]', {status: 200})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    return {...createGuardedFetch({baseUrl: BASE, relations, underlying}), underlying};
  };
  const url = (rel: string, select: string, extra = '') => `${BASE}/rest/v1/${rel}?select=${select}${extra}`;

  it('allows exactly the four digest columns', async () => {
    const {fetch: f, underlying} = setup(['digest_archive']);
    await f(url('digest_archive', DIGEST_COLUMNS, '&order=window_to.desc&limit=2'));
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['select=bundle', 'bundle'],
    ['bundle among columns', 'window_to,digest,bundle'],
    ['aliased bundle', 'b:bundle'],
    ['json path into bundle', 'digest->x,bundle->evidence'],
    ['select=*', '*'],
    ['percent-encoded bundle', '%62undle'],
  ])('blocks %s', async (_n, select) => {
    const {fetch: f, stats, underlying} = setup(['digest_archive']);
    await expect(f(url('digest_archive', select))).rejects.toThrow(/chat read guard/);
    expect(stats.attemptedNonRead).toBe(1);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('blocks filtering or ordering by bundle, and a select that is absent', async () => {
    const {fetch: f, underlying} = setup(['digest_archive']);
    await expect(f(url('digest_archive', DIGEST_COLUMNS, '&order=bundle.asc'))).rejects.toThrow(/forbidden column bundle/);
    await expect(f(url('digest_archive', DIGEST_COLUMNS, '&bundle=ilike.*x*'))).rejects.toThrow(/forbidden column bundle/);
    await expect(f(`${BASE}/rest/v1/digest_archive?limit=2`)).rejects.toThrow(/select is required/);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('keeps the POS reads unaffected (bundle_id and bundle_group are different words) and the digest tables out of the POS allowlist', async () => {
    const pos = setup(relationsForMode('guarded_service').allowed);
    await pos.fetch(url('pos_order_items', 'order_id,product_id,bundle_id,bundle_group,qty,unit_price,line_total'));
    expect(pos.underlying).toHaveBeenCalledTimes(1);
    expect(relationsForMode('guarded_service').allowed).not.toContain('digest_archive');
    expect(relationsForMode('ro_role').allowed).not.toContain('coop_chat_digest');
    await expect(pos.fetch(url('digest_archive', DIGEST_COLUMNS))).rejects.toThrow(/not allowlisted/);
  });

  it('the digest client reaches only its relation: a POS table or a write is refused before any request', async () => {
    const stub = vi.fn(async (_input: unknown) => new Response('[]', {status: 200}));
    vi.stubGlobal('fetch', stub);
    const env = {SUPABASE_URL_ARCHIVE: BASE, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'k'.repeat(40)};
    const {client, stats} = chatDigestClient({mode: 'guarded_service', env});
    // postgrest-js retries a failed GET with backoff (a guard refusal looks like a network error), so switch that off here.
    type Loose = {from(r: string): {select(c: string): {retry(on: boolean): PromiseLike<unknown>}}};
    const loose = client as unknown as Loose;
    const read = (rel: string, cols: string): PromiseLike<unknown> => loose.from(rel).select(cols).retry(false);

    await read('digest_archive', DIGEST_COLUMNS);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(String(stub.mock.calls[0][0])).toContain('/rest/v1/digest_archive?select=window_from%2Cwindow_to%2Cdigest%2Ccreated_at');

    // supabase-js turns the guard's throw into an {error} result: the data never comes back.
    const refusal = async (rel: string, cols: string) => (await read(rel, cols)) as {data: unknown; error: {message: string} | null};
    expect((await refusal('digest_archive', 'window_to,bundle')).error?.message).toMatch(/chat read guard: select references forbidden column bundle/);
    expect((await refusal('pos_orders', 'id,total')).error?.message).toMatch(/chat read guard: relation pos_orders is not allowlisted/);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stats.attemptedNonRead).toBe(2);
  });

  afterEach(() => vi.unstubAllGlobals());
});

describe('supabase/coop_chat_digest.sql', () => {
  const raw = readFileSync(join(process.cwd(), 'supabase', 'coop_chat_digest.sql'), 'utf8');
  const sql = raw.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').toLowerCase();

  it('is a definer view of exactly the four digest columns, never the bundle', () => {
    expect(sql).toMatch(/create or replace view public\.coop_chat_digest as select window_from, window_to, digest, created_at from public\.digest_archive;/);
    expect(sql).not.toMatch(/bundle|\*|security_invoker/);
    expect(DIGEST_COLUMNS.split(',')).toEqual(['window_from', 'window_to', 'digest', 'created_at']);
  });

  it('grants select to coop_chat_ro only, revokes the rest, and grants no write', () => {
    expect(sql).toContain('revoke all on public.coop_chat_digest from public, anon, authenticated;');
    expect(sql).toContain('grant select on public.coop_chat_digest to coop_chat_ro;');
    expect(sql).not.toMatch(/grant (insert|update|delete|all)/);
    expect(digestRelationForMode('ro_role')).toBe('coop_chat_digest');
  });
});

describe('shapeDigest: a digest-sourced result (Slice 5 criterion 2)', () => {
  it('has meta.source "digest", the window, the checks and no figure left to compute', () => {
    const {result, headline, window} = ok({window: 'latest', section: 'comparison'});
    expect(result.meta.source).toBe('digest');
    expect(result.metric).toBe('digest');
    expect(result.dimension).toBe('comparison');
    expect(result.meta.range).toEqual({from: '2026-09-21', to: '2026-09-27', label: 'week of Sep 21 to 27'});
    expect(window).toMatchObject({which: 'latest', label: 'week of Sep 21 to 27'});
    expect(headline).toBe('Lazada and Shopee both grew.');
    expect(result.rows.map((r) => r.channel)).toEqual(['Shopee', 'Lazada', 'Website']);
    expect(result.rows[1]).toEqual({channel: 'Lazada', revenue: 26250, orders: 52, aov: 504.81, units: 96, ad_spend: 4200.25, roas: 3.4});
    expect(result.rows[2]).toMatchObject({ad_spend: null, roas: null}); // missing is null, never zero
    expect(result.meta.reliable).toBe(true);
    expect(result.meta.checks.some((c) => c.code === 'partial_coverage' && c.status === 'info' && /not a full month/.test(c.text))).toBe(true);
    expect(result.meta.measures[0].method).toMatch(/nothing is recomputed/);
  });

  it('returns the previous window from the second row', () => {
    const {result, headline, window} = ok({window: 'previous', section: 'figures'});
    expect(headline).toBe('Quieter.');
    expect(window.label).toBe('week of Sep 14 to 20');
    expect(result.meta.range.from).toBe('2026-09-14');
  });

  it('pre-formats mixed-unit figures and keeps each time basis, so an all-time figure is never "this week"', () => {
    const {result} = ok({window: 'latest', section: 'sales'});
    expect(result.rows).toEqual([
      {area: 'website sales', figure: 'Net revenue this week (PHP)', value: '₱9,120', basis: 'this digest window'},
      {area: 'website sales', figure: 'Revenue change vs prior week (%)', value: '5%', basis: 'this digest window'},
    ]);
    expect(ok({window: 'latest', section: 'figures'}).result.rows[1]).toMatchObject({basis: 'all time', value: '412'});
    expect(ok({window: 'latest', section: 'shopee'}).result.rows[0]).toMatchObject({area: 'sales', basis: 'window 21/09/2026 - 27/09/2026'});
  });

  it('lists the top products per channel with units where the digest has them', () => {
    const {result} = ok({window: 'latest', section: 'products'});
    expect(result.rows).toEqual([
      {source: 'Website', product: 'Joint Support Chews', revenue: 2400, units: null},
      {source: 'Shopee', product: 'Freeze Dried Munchies', revenue: 5200, units: 21},
      {source: 'Lazada', product: 'Meaty Treats', revenue: 4100, units: 16},
    ]);
  });

  it('never returns a customer name, an outreach note, a verbatim quote, a conversation id or the bundle', () => {
    const everything = DIGEST_SECTIONS.map((s) => JSON.stringify(shapeDigest({window: 'latest', section: s}, live(), NOW))).join('\n');
    for (const secret of ['Maria', 'Santos', 'outreach', QUOTE, 'conversationId', 'c-1', 'bundle', BUNDLE_MARKER]) expect(everything).not.toContain(secret);
  });

  it('flags the digest as stale when even the newest stored one is old', () => {
    const old = new Date('2026-10-09T04:00:00Z'); // 12 days after Sep 27
    const {result} = ok({window: 'latest', section: 'comparison'}, live(), old);
    const stale = result.meta.checks.find((c) => c.status === 'warn');
    expect(stale?.code).toBe('partial_coverage');
    expect(stale?.text).toMatch(/ended 2026-09-27, 12 days ago/);
    expect(result.meta.caveats).toContain(stale?.text);
    expect(ok({window: 'latest', section: 'comparison'}).result.meta.checks.some((c) => c.status === 'warn')).toBe(false); // 3 days: fresh
    expect(DIGEST_STALE_DAYS).toBe(9);
  });

  it('flags sample digests and degraded digests', () => {
    const mock = ok({window: 'latest', section: 'comparison'}, {source: 'mock', rows: [LATEST, PREVIOUS]});
    expect(mock.result.meta.checks.some((c) => c.code === 'mock_source' && c.status === 'warn')).toBe(true);
    expect(mock.result.meta.source).toBe('digest');
    const degraded = ok({window: 'latest', section: 'comparison'}, live([row(doc({degraded: true}), LATEST.window_to)]));
    expect(degraded.result.meta.checks.some((c) => /degraded/.test(c.text))).toBe(true);
  });
});

describe('shapeDigest: steering errors', () => {
  const err = (input: unknown, src: DigestSource | null = live()): string => {
    const out = shapeDigest(input, src, NOW);
    if (!('error' in out)) throw new Error('expected an error');
    return out.error;
  };

  it('names the allowed values for a bad window or section', () => {
    expect(err({window: 'last_month', section: 'comparison'})).toMatch(/Allowed values for window: latest, previous/);
    expect(err({window: 'latest', section: 'bundle'})).toMatch(/Allowed values for section: comparison, figures, sales, customers, shopee, lazada, products/);
    expect(err(null)).toMatch(/window/);
  });

  it('says so plainly when there is no digest, and when there is no previous one', () => {
    expect(err({window: 'latest', section: 'figures'}, null)).toMatch(/not available right now/);
    expect(err({window: 'latest', section: 'figures'}, live([]))).toMatch(/not available right now/);
    expect(err({window: 'previous', section: 'figures'}, live([LATEST]))).toMatch(/no previous window/);
  });

  it('lists the sections the digest does have when one is missing', () => {
    const bare = row(doc({comparison: undefined, shopee: null, lazada: undefined, customers: null}), LATEST.window_to);
    expect(err({window: 'latest', section: 'comparison'}, live([bare]))).toMatch(/no comparison section\. Sections it has: figures, sales, products/);
  });
});

describe('the get_digest executor', () => {
  const data: MetricData = {source: 'live', orders: [], events: [], prices: [], priceChanges: [], bulkReads: []};
  const make = (digest?: ChatToolContext['digest']) => {
    const blocks: ChatBlock[] = [];
    const reports: unknown[] = [];
    const ctx: ChatToolContext = {data: async () => data, now: NOW, user: null, digest, emitBlock: (b) => blocks.push(b), emitReport: (s) => reports.push(s)};
    return {ex: createExecutors(ctx), blocks, reports};
  };

  it('returns a stored, compact result with the window and headline, and the result can be drawn as a table', async () => {
    const {ex, blocks, reports} = make(async () => live());
    const r = (await ex.get_digest?.({window: 'latest', section: 'comparison'})) as Record<string, any>;
    expect(r.id).toBe('r1');
    expect(r.meta.source).toBe('digest');
    expect(r.window).toMatchObject({which: 'latest'});
    expect(r.headline).toBe('Lazada and Shopee both grew.');
    expect(r.meta.method).toMatch(/exactly as published/);
    expect(r.meta).not.toHaveProperty('measures');

    await ex.render_chart?.({block: 'new', source: 'r1', kind: 'auto', orientation: 'auto', x: 'auto', y: ['auto'], title: 'Chart'});
    const drawn = (await ex.render_table?.({block: 'new', source: 'r1', columns: ['auto'], title: 'Channels'})) as {ok?: boolean; error?: string};
    expect(drawn.error).toBeUndefined();
    expect(blocks).toHaveLength(2); // the chart first (the default), then its table companion
    expect(blocks[1]).toMatchObject({kind: 'table', source: 'r1'});
    expect(reports).toEqual([null, null]); // no recipe to re-run, so nothing is recorded into a saved report
  });

  it('shares the r-counter with query_metric and lookup_product', async () => {
    const {ex} = make(async () => live());
    expect(((await ex.get_digest?.({window: 'latest', section: 'figures'})) as {id: string}).id).toBe('r1');
    expect(((await ex.get_digest?.({window: 'previous', section: 'figures'})) as {id: string}).id).toBe('r2');
  });

  it('degrades to a steering error when no loader is wired or the read fails (never a crash)', async () => {
    const input = {window: 'latest', section: 'figures'};
    for (const digest of [undefined, async () => Promise.reject(new Error('relation does not exist'))]) {
      const out = (await make(digest).ex.get_digest?.(input)) as {error: string};
      expect(Object.keys(out)).toEqual(['error']);
      expect(out.error).toMatch(/not available right now/);
      expect(out.error).not.toMatch(/relation does not exist/);
    }
  });

  it('is flagged is_error through dispatch when it refuses, and not when it answers', async () => {
    const {ex} = make(async () => live());
    expect((await dispatchToolCall({name: 'get_digest', input: {window: 'latest', section: 'nope'}}, ex)).is_error).toBe(true);
    expect((await dispatchToolCall({name: 'get_digest', input: {window: 'latest', section: 'comparison'}}, ex)).is_error).toBe(false);
  });
});

describe('a digest read goes through the digest adapter, not src/data.ts (Slice 5 criterion 3)', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));
  const chat = files(join(process.cwd(), 'src', 'chat'));

  it('no file under src/chat imports the legacy digest reader', () => {
    const offenders = chat.filter((f) => /from\s+['"](?:@\/src\/data|(?:\.\.?\/)+data)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the chat server glue reads the digest through readDigestRows and the digest client', () => {
    const server = readFileSync(join(process.cwd(), 'src', 'chat', 'server.ts'), 'utf8');
    expect(server).toMatch(/readDigestRows\(client, mode\)/);
    expect(server).toMatch(/chatDigestClient\(/);
    expect(server).not.toMatch(/createClient/);
  });
});

describe('get_digest recent_weeks / weekly_revenue (owner: online and offline week by week as a line)', () => {
  const week = (from: string, to: string, rev: {s: number | null; l: number | null; w: number | null}): DigestRow => ({
    window_from: `${from}T00:00:00.000Z`, window_to: `${to}T23:59:59.000Z`, created_at: `${to}T12:00:00.000Z`,
    digest: doc({
      window: {label: `${from} to ${to}`, from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.000Z`},
      comparison: {
        shopee: {revenue: rev.s, orders: 1, aov: 1, units: 1, adSpend: null, roas: null},
        lazada: {revenue: rev.l, orders: 1, aov: 1, units: 1, adSpend: null, roas: null},
        website: {revenue: rev.w, orders: 1, aov: 1, units: 1, adSpend: null, roas: null},
      },
    }),
  });
  // newest first, like the reader returns them
  const src: DigestSource = {source: 'live', rows: [week('2026-09-21', '2026-09-27', {s: 300, l: 400, w: 100}), week('2026-09-14', '2026-09-20', {s: 200, l: 350, w: 90}), week('2026-09-07', '2026-09-13', {s: 150, l: 300, w: null})]};
  const offline = (from: string): number | null => ({'2026-09-07': 1000, '2026-09-14': 1100, '2026-09-21': null}[from] ?? null);

  it('gives one row per stored week, oldest first, online as published and Offline POS for the same dates', () => {
    const out = shapeDigest({window: 'recent_weeks', section: 'weekly_revenue'}, src, NOW, offline);
    if ('error' in out) throw new Error(out.error);
    expect(out.result.rows.map((r) => r.week)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    expect(out.result.rows[0]).toMatchObject({shopee: 150, lazada: 300, website: null, offline_pos: 1000});
    expect(out.result.rows[2]).toMatchObject({shopee: 300, offline_pos: null}); // no POS data for that week: null, never 0
    expect(out.result.meta.source).toBe('digest');
    expect(out.result.columns.map((c) => c.key)).toEqual(['week', 'shopee', 'lazada', 'website', 'offline_pos']);
  });
  it('says how many weeks exist and that Offline POS is added from live POS data', () => {
    const out = shapeDigest({window: 'recent_weeks', section: 'weekly_revenue'}, src, NOW, offline);
    if ('error' in out) throw new Error(out.error);
    expect(out.result.meta.caveats.join(' ')).toMatch(/only for the 3 weeks that have a stored digest/);
    expect(out.result.meta.coverage).toBe('partial');
  });
  it('draws as a multi-series line over time (the default form for this shape)', async () => {
    const {recommendView} = await import('../src/chat/recommend-view');
    const out = shapeDigest({window: 'recent_weeks', section: 'weekly_revenue'}, src, NOW, offline);
    if ('error' in out) throw new Error(out.error);
    const d = recommendView({...out.result, id: 'r1'}, {kind: 'auto', orientation: 'auto'}).decisions[0];
    expect(d.block).toBe('chart');
    if (d.block === 'chart') expect([d.chart.form, d.chart.series.length]).toEqual(['line', 4]);
  });
  it('the window and the section go together', () => {
    expect('error' in shapeDigest({window: 'recent_weeks', section: 'comparison'}, src, NOW)).toBe(true);
    expect('error' in shapeDigest({window: 'latest', section: 'weekly_revenue'}, src, NOW)).toBe(true);
  });
  it('an empty or missing digest is a plain steering error', () => {
    expect('error' in shapeDigest({window: 'recent_weeks', section: 'weekly_revenue'}, {source: 'live', rows: []}, NOW)).toBe(true);
    expect('error' in shapeDigest({window: 'recent_weeks', section: 'weekly_revenue'}, null, NOW)).toBe(true);
  });
});
