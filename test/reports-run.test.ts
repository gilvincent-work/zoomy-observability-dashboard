import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {createReportSession} from '../src/chat/report-session';
import {METRIC_GONE, isBlockError, pinSpecDates, runReport, toStoredSpec, type ReportRunOk} from '../src/reports-run';
import {EVAL_NOW} from './support/skill-eval-fixtures';
import {bundleData, chartBlock, FILTERS, kpiBlock, spec, tableBlock} from './support/report-fixtures';

const data = bundleData();
const LATER = new Date('2026-10-08T04:00:00Z'); // one week after EVAL_NOW (Thu Oct 1 PHT)
const ok = (r: ReturnType<typeof runReport>): ReportRunOk => {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r;
};
const asJson = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('Slice 4 #2: a stored report renders by re-running queries, with zero model calls', () => {
  it('renders every block exactly as the chat does for the same filters', () => {
    const s = spec();
    const run = ok(runReport(asJson(s), data, EVAL_NOW));
    const viaChat = createReportSession(s).setFilters({}, data, EVAL_NOW);
    expect(viaChat.ok).toBe(true);
    expect(run.blocks).toEqual(viaChat.ok ? viaChat.blocks : []);
    expect(run.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(run.blocks.map((b) => ('kind' in b ? b.kind : 'error'))).toEqual(['kpi', 'chart', 'table']);
  });

  it('makes no network call at all (no Anthropic, no Supabase)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    ok(runReport(asJson(spec()), data, EVAL_NOW));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the title, the resolved range, the scope label and the data-through day', () => {
    const run = ok(runReport(asJson(spec([kpiBlock('b1')], {title: 'Bundle sales'})), data, EVAL_NOW));
    expect(run.title).toBe('Bundle sales');
    expect(run.mode).toBe('live');
    expect(run.rangeLabel).toMatch(/^Sep \d+ to Sep \d+, 2026$/);
    expect(run.filtersLabel).toBe(`${run.rangeLabel} · All pets · All events · Offline`);
    expect(run.dataThrough).toMatch(/^2026-09-\d\d$/);
    expect(run.coverage).toHaveLength(1);
  });

  it('shows an em dash (null), never a zero, for a period with no data', () => {
    const empty = spec([kpiBlock('b1')], {filters: {...FILTERS, range: 'custom', from: '2026-01-01', to: '2026-01-31'}});
    const run = ok(runReport(asJson(empty), data, EVAL_NOW));
    const b = run.blocks[0];
    expect(isBlockError(b)).toBe(false);
    expect(b).toMatchObject({kind: 'kpi', value: null});
  });
});

describe('Slice 4 #5: relative ranges re-resolve, Pin dates stays fixed', () => {
  const live = spec([kpiBlock('b1')], {filters: {...FILTERS, range: 'last_week'}});

  it('a relative range re-resolves against a later now', () => {
    const a = ok(runReport(asJson(live), data, EVAL_NOW));
    const b = ok(runReport(asJson(live), data, LATER));
    expect(a.rangeLabel).toBe('Sep 21 to Sep 27, 2026');
    expect(b.rangeLabel).toBe('Sep 28 to Oct 4, 2026');
    expect(a.mode).toBe('live');
    expect(b.mode).toBe('live');
  });

  it('pinSpecDates resolves the range ONCE into custom from/to with pinned = true', () => {
    const p = pinSpecDates(live, data, EVAL_NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.filters).toMatchObject({range: 'custom', from: '2026-09-21', to: '2026-09-27', pinned: true});
    expect(live.filters.range).toBe('last_week'); // the input is not mutated
  });

  it('a pinned spec keeps its stored dates on a later run and reports mode pinned', () => {
    const p = pinSpecDates(live, data, EVAL_NOW);
    if (!p.ok) throw new Error(p.error);
    const stored = asJson(p.spec);
    const a = ok(runReport(stored, data, EVAL_NOW));
    const b = ok(runReport(stored, data, LATER));
    expect(a.mode).toBe('pinned');
    expect(b.mode).toBe('pinned');
    expect(b.pinned).toBe(true);
    expect(b.rangeLabel).toBe('Sep 21 to Sep 27, 2026');
    expect(b.blocks).toEqual(a.blocks);
    expect(b.filters).toMatchObject({range: 'custom', from: '2026-09-21', to: '2026-09-27', pinned: true});
  });

  it('pinned on a range that is not custom was never fixed: it runs live', () => {
    const odd = asJson(toStoredSpec(live, true));
    expect(ok(runReport(odd, data, LATER))).toMatchObject({mode: 'live', pinned: false, rangeLabel: 'Sep 28 to Oct 4, 2026'});
  });

  it('refuses to pin with no block, or dates that would not run as a custom range', () => {
    expect(pinSpecDates(spec([]), data, EVAL_NOW)).toMatchObject({ok: false});
    const noData = pinSpecDates(spec([kpiBlock('b1')], {filters: {...FILTERS, range: 'all_available'}}), {...data, orders: []}, EVAL_NOW);
    expect(noData).toMatchObject({ok: false});
  });
});

describe('Slice 4 #6: an untrusted stored spec is refused or contained, and nothing executes', () => {
  const trap = {
    ...data,
    get orders(): never {
      throw new Error('a refused spec must not read data');
    },
  };

  it('200 blocks: the whole report is refused before any block runs', () => {
    const many = Array.from({length: 200}, (_, i) => kpiBlock(`b${i + 1}`));
    expect(runReport(asJson(spec(many)), trap, EVAL_NOW)).toMatchObject({ok: false, error: expect.stringMatching(/at most 12 blocks|larger than/)});
    // small enough to pass the size cap: the block cap itself refuses it
    const thirty = Array.from({length: 30}, (_, i) => kpiBlock(`b${i + 1}`));
    expect(runReport(asJson(spec(thirty)), trap, EVAL_NOW)).toEqual({ok: false, error: 'A report holds at most 12 blocks.'});
  });

  it('13 blocks is one too many, 12 is fine', () => {
    expect(runReport(asJson(spec(Array.from({length: 13}, (_, i) => kpiBlock(`b${i + 1}`)))), trap, EVAL_NOW).ok).toBe(false);
    expect(runReport(asJson(spec(Array.from({length: 12}, (_, i) => kpiBlock(`b${i + 1}`)))), data, EVAL_NOW).ok).toBe(true);
  });

  it('an unknown metric becomes an error card for that block only', () => {
    const bad = {...kpiBlock('b2'), query: {...kpiBlock('b2').query, metric: 'drop_table'}};
    const run = ok(runReport(asJson(spec([kpiBlock('b1'), bad as never, tableBlock('b3')])), data, EVAL_NOW));
    expect(run.blocks[1]).toEqual({id: 'b2', error: METRIC_GONE});
    expect(isBlockError(run.blocks[0])).toBe(false);
    expect(isBlockError(run.blocks[2])).toBe(false);
  });

  it('an extra data array (top level, in a block, in a query) is dropped: the output holds none of it', () => {
    const planted = {rows: [{secret: 'LEAK-123'}]};
    const raw = asJson(spec());
    raw.data = [planted];
    raw.blocks[0].data = [planted];
    raw.blocks[0].values = [1, 2, 3];
    raw.blocks[1].view.rows = [planted];
    raw.blocks[2].query.data = [planted];
    const run = ok(runReport(raw, data, EVAL_NOW));
    expect(JSON.stringify(run)).not.toContain('LEAK-123');
    expect(run.blocks).toEqual(ok(runReport(asJson(spec()), data, EVAL_NOW)).blocks);
  });

  it('a spec over 32 KB, a wrong spec_version, a non-object, a bad filter and bad block ids are refused whole', () => {
    expect(runReport(asJson(spec([kpiBlock('b1', {view: {value: 'x'.repeat(40_000), label: '', format: 'peso'}} as never)])), trap, EVAL_NOW).ok).toBe(false);
    expect(runReport({...asJson(spec()), spec_version: 2}, trap, EVAL_NOW).ok).toBe(false);
    for (const junk of [null, 'x', 5, [], undefined]) expect(runReport(junk, trap, EVAL_NOW).ok).toBe(false);
    expect(runReport({...asJson(spec()), filters: {...FILTERS, range: 'next_year'}}, trap, EVAL_NOW).ok).toBe(false);
    expect(runReport(asJson(spec([kpiBlock('b1'), kpiBlock('b1')])), trap, EVAL_NOW)).toMatchObject({ok: false});
    expect(runReport(asJson(spec([kpiBlock('<script>')])), trap, EVAL_NOW)).toMatchObject({ok: false});
    expect(runReport({...asJson(spec()), blocks: 'nope'}, trap, EVAL_NOW)).toMatchObject({ok: false});
  });

  it('a block that cannot run for these filters becomes an error card with the reason; others still render', () => {
    const future = asJson(spec([kpiBlock('b1')], {filters: {...FILTERS, range: 'custom', from: '2026-09-01', to: '2099-01-01'}}));
    const run = ok(runReport(future, data, EVAL_NOW));
    expect(run.blocks[0]).toMatchObject({id: 'b1', error: expect.stringContaining('after today')});
    expect(run.rangeLabel).toBeNull();
  });

  it('titles stay plain text', () => {
    const run = ok(runReport(asJson(spec([kpiBlock('b1')], {title: '  <b>Hi</b>\u0000 there  '})), data, EVAL_NOW));
    expect(run.title).toBe('<b>Hi</b> there');
  });
});

describe('Slice 4 #7: an old version using a metric since removed loads and renders the rest', () => {
  it('shows "Metric no longer available" for that block and renders the other blocks', () => {
    const old = asJson(spec([kpiBlock('b1'), chartBlock('b2'), tableBlock('b3')]));
    old.blocks[1].query.metric = 'profit_margin_by_vibes'; // removed since this version was saved
    old.blocks[2].query.dimension = 'removed_dimension'; // a dimension the metric no longer declares
    const run = ok(runReport(old, data, EVAL_NOW));
    expect(run.blocks).toHaveLength(3);
    expect(run.blocks[0]).toMatchObject({id: 'b1', kind: 'kpi'});
    expect(run.blocks[1]).toEqual({id: 'b2', error: 'Metric no longer available'});
    expect(run.blocks[2]).toEqual({id: 'b3', error: 'Metric no longer available'});
  });
  it('every block gone still returns a report (all error cards), not a crash', () => {
    const old = asJson(spec([kpiBlock('b1')]));
    old.blocks[0].query.metric = 'gone';
    const run = ok(runReport(old, data, EVAL_NOW));
    expect(run.blocks).toEqual([{id: 'b1', error: METRIC_GONE}]);
    expect(run.rangeLabel).toBeNull();
    expect(run.dataThrough).toBeNull();
  });
});
