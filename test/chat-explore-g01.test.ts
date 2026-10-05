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
