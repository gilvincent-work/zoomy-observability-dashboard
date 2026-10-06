// D2 (live Ask Coop G01): the answer never said how event orders were counted (POS tag vs date window) and gave no lead coverage note.
// Code writes both, from the PARSED query (relations + column refs) and a fixed coverage query, never the model (spec R6).
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createExploreExecutor, type RunQuery} from '../src/chat/explore/executor';
import {EXPLORE_COVERAGE_SQL, leadFactsOf, loadLeadFacts, resetCoverageCache} from '../src/chat/explore/coverage';
import {ORDERS_BY_DATE_NOTE, ORDERS_BY_TAG_NOTE, leadsCoverageNote} from '../src/chat/explore/basis';
import {DEFAULT_EXPLORE_LIMITS} from '../src/chat/explore/limits';
import {validateExploreSql} from '../src/chat/explore/parse';
import {checkNumbers} from '../src/chat/number-check';
import type {MetricResult} from '../src/chat/result-types';

beforeEach(resetCoverageCache);

const BY_TAG = "select e.name as event, o.pet_type as pet, count(*) as orders_count, round(sum(o.total), 2) as revenue_php from coop_explore_orders o join coop_explore_events e on e.event_id = o.event_id where o.status = 'completed' group by 1, 2";
const BY_DATE = "select e.name as event, o.pet_type as pet, count(*) as orders_count from coop_explore_orders o join coop_explore_events e on (o.created_at at time zone 'Asia/Manila')::date between e.starts_on and coalesce(e.ends_on, e.starts_on) where o.status = 'completed' group by 1, 2";
const BOTH = "select e.name as event, count(*) filter (where o.event_id = e.event_id) as tagged_count, count(*) as window_count from coop_explore_orders o join coop_explore_events e on (o.created_at at time zone 'Asia/Manila')::date between e.starts_on and coalesce(e.ends_on, e.starts_on) where o.status = 'completed' group by 1";
const LEADS = "select l.pet as pet, count(*) as leads_count from coop_explore_event_leads l group by 1";
const NONE = "select o.payment_method as method, count(*) as orders_count from coop_explore_orders o where o.status = 'completed' group by 1";
const ORDERS_ONLY_EVENT_ID = "select o.event_id as event, count(*) as orders_count from coop_explore_orders o where o.status = 'completed' group by 1";
const EVENTS_ONLY = "select e.name as event, e.starts_on as starts_on from coop_explore_events e";
const LEADS_AND_EVENTS = "select e.name as event, count(*) as leads_count from coop_explore_event_leads l join coop_explore_events e on (l.collected_at at time zone 'Asia/Manila')::date between e.starts_on and coalesce(e.ends_on, e.starts_on) group by 1";

const FACTS = {count: 8, withPet: 6, petFrom: '2026-09-12'};
const FACT_TEXT = '8 leads in the leads view, 6 with a pet value (pet was only collected from 12 Sep 2026).';

async function run(sql: string, facts: typeof FACTS | null = FACTS) {
  const store = new Map<string, MetricResult>();
  const rq: RunQuery = async () => ({columns: [{name: 'event', type: 'text'}, {name: 'n_count', type: 'number'}], rows: [['SM Aura Pet Fair', 17]], fetched: 1, ms: 1});
  const exec = createExploreExecutor({runQuery: rq, validate: validateExploreSql, limits: DEFAULT_EXPLORE_LIMITS, now: new Date('2026-10-05T00:00:00Z'), user: null, store, leadFacts: async () => facts});
  const payload = (await exec({purpose: 't', sql, step: 'final'})) as {coverage_note: string; meta: {caveats: string[]}};
  return {caveats: store.get('x1')!.meta.caveats, note: store.get('x1')!.meta.exploratory!.coverage_note, payload};
}

describe('D2 parser reports the referenced columns', () => {
  it('resolves aliases to views and ignores literals', async () => {
    const v = await validateExploreSql(BY_TAG);
    if (!v.ok) throw new Error(v.code);
    expect(v.columnRefs).toContainEqual({relation: 'coop_explore_orders', column: 'event_id'});
    expect(v.columnRefs).toContainEqual({relation: 'coop_explore_events', column: 'event_id'});
    const d = await validateExploreSql(BY_DATE);
    if (!d.ok) throw new Error(d.code);
    expect(d.columnRefs).toContainEqual({relation: 'coop_explore_events', column: 'starts_on'});
    expect(d.columnRefs.some((c) => c.relation === 'coop_explore_orders' && c.column === 'event_id')).toBe(false);
  });
});

describe('D2 basis and coverage caveats written by code', () => {
  it('leads only: booth note plus the lead counts and the pet start date', async () => {
    const r = await run(LEADS);
    expect(r.caveats).toContain('Leads are booth sign-ups, not buyers.');
    expect(r.caveats).toContain(FACT_TEXT);
    expect(r.caveats).not.toContain(ORDERS_BY_TAG_NOTE);
    expect(r.caveats).not.toContain(ORDERS_BY_DATE_NOTE);
    expect(r.note).toContain(FACT_TEXT);
  });

  it('leads facts unavailable: only the existing booth note, nothing invented', async () => {
    const r = await run(LEADS, null);
    expect(r.caveats.filter((c) => /leads in the leads view/.test(c))).toEqual([]);
    expect(r.caveats).toContain('Leads are booth sign-ups, not buyers.');
  });

  it('orders + events joined on orders.event_id: counted by POS tag', async () => {
    const r = await run(BY_TAG);
    expect(r.caveats).toContain(ORDERS_BY_TAG_NOTE);
    expect(r.caveats).not.toContain(ORDERS_BY_DATE_NOTE);
    expect(ORDERS_BY_TAG_NOTE).toBe('Orders counted are those tagged to the event in the POS (untagged sales on the event dates are not included).');
  });

  it('orders + events by the events date window: attributed by date', async () => {
    const r = await run(BY_DATE);
    expect(r.caveats).toContain(ORDERS_BY_DATE_NOTE);
    expect(r.caveats).not.toContain(ORDERS_BY_TAG_NOTE);
    expect(ORDERS_BY_DATE_NOTE).toBe('Orders attributed to the event by date window (includes untagged sales rung up on the event dates).');
  });

  it('both the tag and the date window: both sentences', async () => {
    const r = await run(BOTH);
    expect(r.caveats).toContain(ORDERS_BY_TAG_NOTE);
    expect(r.caveats).toContain(ORDERS_BY_DATE_NOTE);
    expect(r.note).toContain(ORDERS_BY_TAG_NOTE);
  });

  it('no basis line without both orders and events, and none for leads placed by date window', async () => {
    for (const sql of [NONE, ORDERS_ONLY_EVENT_ID, EVENTS_ONLY, LEADS_AND_EVENTS]) {
      const r = await run(sql);
      expect(r.caveats, sql).not.toContain(ORDERS_BY_TAG_NOTE);
      expect(r.caveats, sql).not.toContain(ORDERS_BY_DATE_NOTE);
    }
    expect((await run(NONE)).caveats.join(' ')).not.toMatch(/leads in the leads view/);
    expect((await run(LEADS_AND_EVENTS)).caveats).toContain(FACT_TEXT);
  });

  it('the notes are in the payload the model sees, so quoting their figures is not a new claim', async () => {
    const r = await run(LEADS);
    const seen = [r.payload];
    expect(checkNumbers('There are 8 leads and 6 have a pet value.', seen).violations).toEqual([]);
  });

  it('leadsCoverageNote wording and the zero-pet case', () => {
    expect(leadsCoverageNote(FACTS)).toBe(FACT_TEXT);
    expect(leadsCoverageNote({count: 5, withPet: 0, petFrom: null})).toBe('5 leads in the leads view, 0 with a pet value.');
    expect(leadsCoverageNote({count: 1, withPet: 1, petFrom: '2026-09-12'})).toBe('1 lead in the leads view, 1 with a pet value (pet was only collected from 12 Sep 2026).');
  });
});

describe('D2 lead facts come from the fixed coverage statement', () => {
  it('the statement still validates and reads the two new columns at the end of the row', async () => {
    const v = await validateExploreSql(EXPLORE_COVERAGE_SQL);
    expect(v.ok).toBe(true);
    expect(EXPLORE_COVERAGE_SQL).toMatch(/leads_with_pet/);
    expect(EXPLORE_COVERAGE_SQL).toMatch(/pet_from/);
    expect(leadFactsOf(['2026-09-07', '2026-09-27', 120, 6, '2026-09-11', 100, 70, '2026-09-12', '2026-09-27', 45, 30, '2026-09-18'])).toEqual({count: 45, withPet: 30, petFrom: '2026-09-18'});
    expect(leadFactsOf([null, null, 0, 0, null, 0, 0, null, null, 0])).toBeNull();
  });

  it('loadLeadFacts shares the one-minute cache with the coverage line and never throws', async () => {
    const row = ['2026-09-07', '2026-09-27', 3, 0, null, 0, 0, '2026-09-12', '2026-09-27', 8, 6, '2026-09-12'];
    const rq = vi.fn(async () => ({columns: [], rows: [row], fetched: 1, ms: 1}));
    const deps = {runQuery: rq, validate: validateExploreSql, limits: DEFAULT_EXPLORE_LIMITS, clock: () => 1000};
    expect(await loadLeadFacts(deps)).toEqual(FACTS);
    await loadLeadFacts(deps);
    expect(rq).toHaveBeenCalledTimes(1);
    resetCoverageCache();
    expect(await loadLeadFacts({...deps, runQuery: async () => { throw new Error('down'); }})).toBeNull();
  });
});
