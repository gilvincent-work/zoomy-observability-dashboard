// Live Ask Coop test 4 (G01): two successful finals (orders by event and pet, leads pivot by event and breed). The app drew only the last,
// and the title was built from series values. Scripted model, real parser and executor, fake driver. No network.
import {describe, expect, it} from 'vitest';
import type {RunQuery} from '../src/chat/explore/executor';
import {ORDERS_BY_TAG_NOTE} from '../src/chat/explore/basis';
import {toolTurn, toolUse} from './support/fake-model';
import {harness} from './support/explore-harness';

const ORDERS_SQL = "select e.name as event, o.pet_type as pet, count(*) as orders_count, sum(o.total) as revenue_php from coop_explore_orders o join coop_explore_events e on e.id = o.event_id where o.status = 'completed' group by 1, 2";
const LEADS_SQL = 'select l.event as event, count(*) filter (where l.breed is null) as no_breed_given, count(*) filter (where l.breed = \'puspin\') as puspin, count(*) filter (where l.breed = \'golden retriever\') as golden_retriever, count(*) filter (where l.breed = \'persian\') as persian, count(*) filter (where l.breed = \'aspin\') as aspin, count(*) filter (where l.breed = \'shih tzu\') as shih_tzu from coop_explore_event_leads l group by 1';
const ORDERS_COLS = [{name: 'event', type: 'text' as const}, {name: 'pet', type: 'text' as const}, {name: 'orders_count', type: 'number' as const}, {name: 'revenue_php', type: 'number' as const}];
const LEADS_COLS = [{name: 'event', type: 'text' as const}, ...['no_breed_given', 'puspin', 'golden_retriever', 'persian', 'aspin', 'shih_tzu', 'total_count'].map((name) => ({name, type: 'number' as const}))];
const run: RunQuery = async (sql) => (sql.includes('coop_explore_orders')
  ? {columns: ORDERS_COLS, rows: [['SM Aura', 'dog', 4, 4000], ['SM Aura', 'cat', 3, 2100], ['Circuit Makati', 'dog', 3, 2400], ['Circuit Makati', 'cat', 4, 3000]], fetched: 4, ms: 1}
  : {columns: LEADS_COLS, rows: [['SM Aura', 2, 1, 1, 0, 1, 0, 5], ['Circuit Makati', 1, 2, 0, 1, 0, 1, 5]], fetched: 2, ms: 1});
const fin = (id: string, sql: string) => toolUse(id, 'run_query', {purpose: 'p', sql, step: 'final'});

describe('G01 two finals, one answer', () => {
  it('EXP-03 draws both results in query order, each with its chip, SQL, own caveats and a deterministic title', async () => {
    const h = harness(run, (n) => (n === 1 ? toolTurn('', fin('a', ORDERS_SQL), fin('b', LEADS_SQL)) : {text: ['Dogs and cats sold evenly.'], stop_reason: 'end_turn'}), 'q', {leadFacts: {count: 8, withPet: 6, petFrom: '2026-09-12'}});
    await h.go();
    expect(h.blocks.map((b) => b.source)).toEqual(['x1', 'x2']);
    const [orders, leads] = h.blocks;
    expect(orders.exploratory).toBe(true);
    expect(leads.exploratory).toBe(true);
    expect(orders.sql).toBe(ORDERS_SQL);
    expect(leads.sql).toBe(LEADS_SQL);
    expect(orders.caveats).toContain(ORDERS_BY_TAG_NOTE); // the orders block carries its own basis caveat
    expect(leads.caveats).not.toContain(ORDERS_BY_TAG_NOTE);
    expect(leads.caveats.some((c) => /8 leads in the leads view/.test(c))).toBe(true);
    expect(orders.caveats.some((c) => /leads in the leads view/.test(c))).toBe(false);
    expect(orders.title).toBe('Revenue (PHP) by Event and Pet') // the plotted measure (pesos first), named by its column label;
    expect(leads.title).toBe('Counts by Event');
    for (const b of h.blocks) expect(b.title).not.toMatch(/dog|cat|puspin|persian|aspin|golden/i); // never made from row or series values
  });
});

// Live test 5 (G01): the label column was min(btrim(name)) per pet group, so "circuit makati weekend" (dog, cat) and "Circuit Makati Weekend" (both, untagged)
// were drawn as two categories. Code never merges rows (that would change numbers); it flags the split on the block.
describe('G01 labels that differ only in spelling are flagged, never merged', () => {
  const COLS = [{name: 'event', type: 'text' as const}, {name: 'pet', type: 'text' as const}, {name: 'orders_count', type: 'number' as const}];
  const ROWS = [['SM Aura Weekend', 'dog', 4], ['SM Aura Weekend', 'cat', 3], ['SM Aura Weekend', 'both', 1], ['SM Aura Weekend', 'untagged', 2], ['circuit makati weekend', 'dog', 3], ['circuit makati weekend', 'cat', 1], ['Circuit Makati Weekend', 'both', 2], ['Circuit Makati Weekend', 'untagged', 1]];
  const SQL = "select min(btrim(e.name)) as event, coalesce(o.pet_type, 'untagged') as pet, count(*) as orders_count from coop_explore_orders o join coop_explore_events e on e.id = o.event_id where o.status = 'completed' group by lower(btrim(e.name)), 2";
  const CAVEAT = 'Labels "circuit makati weekend" and "Circuit Makati Weekend" differ only in capitalisation or spacing; they were not merged: group by lower(btrim(...)) in the SQL to merge them.';
  const go = async (rows: unknown[][]) => {
    const h = harness(async () => ({columns: COLS, rows, fetched: rows.length, ms: 1}), (n) => (n === 1 ? toolTurn('', toolUse('a', 'run_query', {purpose: 'p', sql: SQL, step: 'final'})) : {text: ['Done.'], stop_reason: 'end_turn'}));
    await h.go();
    return h;
  };

  it('adds the code-written caveat to every drawn block, once, and leaves the 8 rows as they are', async () => {
    const h = await go(ROWS);
    expect(h.blocks.length).toBeGreaterThan(0);
    for (const b of h.blocks) expect(b.caveats.filter((c) => c === CAVEAT)).toHaveLength(1);
    const stored = h.session.store.get('x1')!;
    expect(stored.rows).toHaveLength(8);
    expect(stored.meta.caveats).toContain(CAVEAT);
  });

  it('adds nothing when every spelling of a label is the same', async () => {
    const h = await go(ROWS.map((r) => [String(r[0]).toLowerCase(), r[1], r[2]]));
    for (const b of h.blocks) expect(b.caveats.some((c) => /differ only in capitalisation/.test(c))).toBe(false);
  });
});
