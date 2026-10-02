import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {runMetric} from '../src/chat/query-metric';
import {createReportSession, openReportSession} from '../src/chat/report-session';
import {requestOf} from '../src/chat/report-spec';
import {REPORT_MAX_BYTES, type ReportBlockSpec} from '../src/chat/report-types';
import type {KpiBlock, TableBlock} from '../src/chat/block-types';
import {EVAL_NOW} from './support/skill-eval-fixtures';
import {bundleData, chartBlock, FILTERS, kpiBlock, Q, spec, tableBlock} from './support/report-fixtures';

const data = bundleData();

describe('an empty session', () => {
  it('has no snapshot and no outline until something is recorded', () => {
    const s = createReportSession();
    expect(s.snapshot()).toBeNull();
    expect(s.outline()).toBe('');
    expect(s.size()).toBe(0);
    expect(s.counter()).toBe(0);
    s.setTitle('  Bundle   sales ');
    expect(s.snapshot()).toMatchObject({title: 'Bundle sales', blocks: []});
    expect(s.outline()).toContain('"Bundle sales"');
  });
  it('adopts the filters of the first render only while it has no blocks', () => {
    const s = createReportSession();
    s.adoptFilters({...FILTERS, pet: 'cat'});
    expect(s.filters().pet).toBe('cat');
    s.record(kpiBlock('b1'));
    s.adoptFilters({...FILTERS, pet: 'dog'});
    expect(s.filters().pet).toBe('cat');
  });
});

describe('a session from a client spec', () => {
  it('continues the id counter after the highest existing id, even with gaps', () => {
    expect(createReportSession(spec([kpiBlock('b2'), kpiBlock('b7')])).counter()).toBe(7);
    expect(createReportSession(spec([])).counter()).toBe(0);
  });
  it('hydrate re-runs every block into the store under its block id and the data equals query_metric', () => {
    const s = createReportSession(spec());
    expect(s.hydrate(data, EVAL_NOW)).toEqual([]);
    expect([...s.store.keys()]).toEqual(['b1', 'b2', 'b3']);
    const direct = runMetric(requestOf(tableBlock('b3').query, FILTERS), data, EVAL_NOW);
    if ('error' in direct) throw new Error(direct.error);
    expect(s.store.get('b3')?.rows).toEqual(direct.rows);
    expect(s.store.get('b3')?.id).toBe('b3');
    expect(s.requestOf('b3')).toMatchObject({metric: 'bundle_sales', dimension: 'bundle_by_pet', range: 'all_available', pet: 'all'});
  });
  it('a block that cannot run is reported, outlined as such, and does not stop the others', () => {
    const noPet: ReportBlockSpec = {id: 'b2', kind: 'table', query: {...Q, metric: 'pet_mix', dimension: 'none'}, view: {columns: ['auto'], title: 'Pets'}};
    const s = createReportSession(spec([kpiBlock('b1'), noPet], {filters: {...FILTERS, pet: 'cat'}}));
    expect(s.hydrate(data, EVAL_NOW)).toEqual(['b2']);
    expect(s.store.has('b1')).toBe(true);
    expect(s.store.has('b2')).toBe(false);
    expect(s.outline()).toMatch(/b2 table: .*could not be re-run/);
  });
  it('record adds at the end or replaces in place; remove drops a block; ids are never reused in the request', () => {
    const s = createReportSession(spec());
    s.record({...chartBlock('b2'), view: {...(chartBlock('b2') as any).view, kind: 'pie', mode: 'user'}} as never);
    expect(s.ids()).toEqual(['b1', 'b2', 'b3']);
    s.record(kpiBlock('b4'));
    expect(s.ids()).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(s.remove('b4')).toBe(true);
    expect(s.remove('b4')).toBe(false);
    expect(s.counter()).toBe(4);
    expect(s.snapshot()?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });
  it('the snapshot is a copy: changing it never changes the session', () => {
    const s = createReportSession(spec());
    const snap = s.snapshot();
    snap!.blocks.length = 0;
    snap!.filters.pet = 'cat';
    expect(s.size()).toBe(3);
    expect(s.filters().pet).toBe('all');
  });
});

describe('setFilters', () => {
  const hydrated = () => {
    const s = createReportSession(spec());
    s.hydrate(data, EVAL_NOW);
    return s;
  };
  it('re-runs every block in order with the same ids and reports coverage', () => {
    const s = hydrated();
    const out = s.setFilters({pet: 'cat'}, data, EVAL_NOW);
    if (!out.ok) throw new Error(out.error);
    expect(out.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(out.coverage.map((c) => c.block)).toEqual(['b1', 'b2', 'b3']);
    expect(s.filters().pet).toBe('cat');
    const cat = runMetric(requestOf(kpiBlock('b1').query, {...FILTERS, pet: 'cat'}), data, EVAL_NOW);
    if ('error' in cat) throw new Error(cat.error);
    expect((out.blocks[0] as KpiBlock).value).toBe(cat.rows[0].bundle_revenue);
  });
  it('is atomic: one block that cannot take the filter leaves the report unchanged', () => {
    const noPet: ReportBlockSpec = {id: 'b2', kind: 'table', query: {...Q, metric: 'pet_mix', dimension: 'none'}, view: {columns: ['auto'], title: 'Pets'}};
    const s = createReportSession(spec([kpiBlock('b1'), noPet]));
    s.hydrate(data, EVAL_NOW);
    const before = JSON.stringify(s.snapshot());
    const out = s.setFilters({pet: 'cat'}, data, EVAL_NOW);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/Block b2 cannot use these filters.*pet filter is not supported.*Nothing was changed/);
    expect(JSON.stringify(s.snapshot())).toBe(before);
  });
  it('clears from and to when the range is not custom, and keeps them for custom', () => {
    const s = hydrated();
    const custom = s.setFilters({range: 'custom', from: '2026-09-07', to: '2026-09-13'}, data, EVAL_NOW);
    expect(custom.ok).toBe(true);
    expect(s.filters()).toMatchObject({range: 'custom', from: '2026-09-07', to: '2026-09-13'});
    s.setFilters({range: 'last_week'}, data, EVAL_NOW);
    expect(s.filters()).toMatchObject({range: 'last_week', from: '', to: ''});
  });
  it('with nothing in the new period a tile is null and a chart or table has no rows, never zeros', () => {
    const s = hydrated();
    const out = s.setFilters({range: 'this_week'}, data, EVAL_NOW);
    if (!out.ok) throw new Error(out.error);
    expect(out.coverage.map((c) => c.coverage)).toEqual(['none', 'none', 'none']);
    expect((out.blocks[0] as KpiBlock).value).toBeNull();
    expect(out.blocks[1].kind).toBe('table');
    expect((out.blocks[1] as TableBlock).rows).toEqual([]);
    expect((out.blocks[2] as TableBlock).rows).toEqual([]);
    expect(out.blocks.every((b) => b.caveats.some((c) => /no data/i.test(c)))).toBe(true);
    expect(s.snapshot()?.blocks.map((b) => b.kind)).toEqual(['kpi', 'chart', 'table']); // the recipe keeps its kinds
  });
});

describe('outline', () => {
  it('lists ids, kinds, params, view and filters', () => {
    const s = createReportSession(spec([kpiBlock('b1'), {...chartBlock('b2'), view: {...(chartBlock('b2') as any).view, kind: 'pie', mode: 'user'}} as never], {title: 'Bundle sales', filters: {...FILTERS, range: 'custom', from: '2026-09-07', to: '2026-09-13'}}));
    const text = s.outline();
    expect(text).toContain('[dashboard open] "Bundle sales" | filters: range custom 2026-09-07 to 2026-09-13; pet all; event all; channel offline');
    expect(text).toMatch(/^b1 kpi: bundle_sales by none, measure default, limit 25; field bundle_revenue, peso, label "Bundle revenue"$/m);
    expect(text).toMatch(/^b2 chart: bundle_sales by pet_type, measure default, limit 25; view pie \(user\), orientation auto, title "Revenue by pet"$/m);
  });
});

describe('openReportSession (the route seam)', () => {
  const rejects: string[] = [];
  const open = (raw: unknown) => openReportSession(raw, data, EVAL_NOW, (r) => rejects.push(r));

  it('absent or null means an empty report and no rejection', () => {
    rejects.length = 0;
    expect(open(undefined).size()).toBe(0);
    expect(open(null).size()).toBe(0);
    expect(rejects).toEqual([]);
  });
  it('a valid spec is validated and hydrated', () => {
    const s = open(spec());
    expect(s.ids()).toEqual(['b1', 'b2', 'b3']);
    expect(s.store.has('b2')).toBe(true);
  });
  it('an invalid, oversized or non-object spec is ignored with a reason and no content (criterion 7)', () => {
    rejects.length = 0;
    const unknownMetric = spec([kpiBlock('b1', {query: {...Q, metric: 'nope'}} as never)]);
    const thirteen = spec(Array.from({length: 13}, (_, i) => kpiBlock(`b${i + 1}`)));
    const huge = spec();
    huge.title = 'T'.repeat(REPORT_MAX_BYTES + 1);
    for (const raw of [unknownMetric, thirteen, huge, 'a string', [1, 2]]) {
      const s = open(raw);
      expect(s.size()).toBe(0);
      expect(s.snapshot()).toBeNull();
      expect(s.outline()).toBe('');
    }
    expect(rejects).toHaveLength(5);
    expect(rejects.join(' ')).not.toContain('nope');
  });
  it('an extra data key is stripped and never reaches the outline', () => {
    const raw: any = JSON.parse(JSON.stringify(spec()));
    raw.blocks[0].data = [{secret: 'LEAK-1'}];
    raw.blocks[0].view.values = ['LEAK-2'];
    const s = open(raw);
    expect(JSON.stringify(s.snapshot())).not.toMatch(/LEAK/);
    expect(s.outline()).not.toMatch(/LEAK/);
  });
});
