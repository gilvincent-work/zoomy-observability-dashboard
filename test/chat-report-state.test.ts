import {describe, expect, it} from 'vitest';
import type {ChatBlock} from '../src/chat/block-types';
import type {ReportBlockSpec, ReportFilters, ReportSpec} from '../src/chat/report-types';
import {applyReportEvent, describeFilters, dropBlocks, placeBlock, reportBody, sanitizeReport} from '../components/analyst/report-state';
import type {PlacedBlock} from '../components/analyst/chat-blocks-format';
import {plainBar, tableTotal, kpiRow} from '../components/analyst/chat-blocks.fixtures';

const filters = (over: Partial<ReportFilters> = {}): ReportFilters => ({range: 'last_week', from: '', to: '', pet: 'all', event: 'all', channel: 'all', pinned: false, ...over});
const query = {metric: 'bundle_sales', dimension: 'none', measure: 'default', compare_to: 'none', sort: 'default', limit: 5} as const;
const kpi = (id: string): ReportBlockSpec => ({id, kind: 'kpi', query: query as ReportBlockSpec['query'], view: {value: 'revenue', label: 'Revenue', format: 'peso'}});
const spec = (n = 2): ReportSpec => ({spec_version: 1, title: 'Sales', filters: filters(), blocks: Array.from({length: n}, (_, i) => kpi(`b${i + 1}`))});

describe('sanitizeReport', () => {
  it('keeps a valid spec', () => expect(sanitizeReport(spec())).toEqual(spec()));
  it('returns null for non-objects and null', () => {
    for (const v of [null, undefined, 5, 'x', [], true]) expect(sanitizeReport(v)).toBeNull();
  });
  it('rejects a wrong version, missing filters, non-array blocks', () => {
    expect(sanitizeReport({...spec(), spec_version: 2})).toBeNull();
    expect(sanitizeReport({...spec(), filters: null})).toBeNull();
    expect(sanitizeReport({...spec(), blocks: 'nope'})).toBeNull();
  });
  it('allows 12 blocks and rejects 13', () => {
    expect(sanitizeReport(spec(12))).not.toBeNull();
    expect(sanitizeReport(spec(13))).toBeNull();
  });
  it('rejects malformed block entries', () => {
    expect(sanitizeReport({...spec(), blocks: [null]})).toBeNull();
    expect(sanitizeReport({...spec(), blocks: [{id: 3}]})).toBeNull();
    expect(sanitizeReport({...spec(), blocks: [{id: ''}]})).toBeNull();
  });
});

describe('reportBody', () => {
  it('is undefined for null', () => expect(reportBody(null)).toBeUndefined());
  it('returns the spec when small', () => expect(reportBody(spec())).toEqual(spec()));
  it('is undefined over 32 KB', () => expect(reportBody({...spec(), title: 'x'.repeat(40 * 1024)})).toBeUndefined());
});

describe('describeFilters', () => {
  it('reads each range', () => {
    expect(describeFilters(filters({range: 'last_week'}))).toEqual(['Last week']);
    expect(describeFilters(filters({range: 'this_week'}))).toEqual(['This week']);
    expect(describeFilters(filters({range: 'last_month'}))).toEqual(['Last month']);
    expect(describeFilters(filters({range: 'all_available'}))).toEqual(['All time']);
  });
  it('formats custom dates, and falls back when they are missing', () => {
    expect(describeFilters(filters({range: 'custom', from: '2026-09-11', to: '2026-09-27'}))).toEqual(['11 Sep to 27 Sep']);
    expect(describeFilters(filters({range: 'custom', from: '', to: ''}))).toEqual(['Custom dates']);
  });
  it('names each pet and omits all', () => {
    expect(describeFilters(filters({pet: 'cat'}))).toEqual(['Cats', 'Last week']);
    expect(describeFilters(filters({pet: 'dog'}))[0]).toBe('Dogs');
    expect(describeFilters(filters({pet: 'both'}))[0]).toBe('Dog and cat');
    expect(describeFilters(filters({pet: 'untagged'}))[0]).toBe('Untagged pets');
    expect(describeFilters(filters({pet: 'all'}))).toEqual(['Last week']);
  });
  it('shows an event and the offline channel, omits the neutral values', () => {
    expect(describeFilters(filters({pet: 'cat', range: 'last_month', event: 'Mall Pop-up', channel: 'offline'}))).toEqual(['Cats', 'Last month', 'Mall Pop-up', 'Offline']);
    expect(describeFilters(filters({event: 'all', channel: 'all'}))).toEqual(['Last week']);
  });
});

type M = {role: 'user' | 'assistant'; content: string; blocks?: PlacedBlock[]};
const withId = (b: ChatBlock, id: string): ChatBlock => ({...b, id});
const b1 = withId(plainBar, 'b1');
const b2 = withId(tableTotal, 'b2');
const b3 = withId(kpiRow[0], 'b3');

describe('placeBlock', () => {
  const base = (): M[] => [
    {role: 'user', content: 'q1'},
    {role: 'assistant', content: 'first answer', blocks: [{at: 3, block: b1}, {at: 5, block: b2}]},
    {role: 'user', content: 'q2'},
    {role: 'assistant', content: 'second'},
  ];
  const held = new Set(['b1', 'b2']); // the open dashboard holds b1 and b2

  it('replaces an id of the open dashboard from an earlier message in place and leaves the rest untouched', () => {
    const edited = {...b1, title: 'Edited'};
    const out = placeBlock(base(), 3, edited, 99, held);
    const expected = base();
    expected[1].blocks = [{at: 3, block: edited}, {at: 5, block: b2}];
    expect(out).toEqual(expected);
    expect(out[3].blocks).toBeUndefined();
  });

  it('appends a new id to the current message at its offset', () => {
    const out = placeBlock(base(), 3, b3, 6, held);
    expect(out[3].blocks).toEqual([{at: 6, block: b3}]);
    expect(out[1]).toEqual(base()[1]);
  });

  it('upserts an id already in the current message', () => {
    const once = placeBlock(base(), 3, b3, 6, held);
    const edited = {...b3, title: 'Again'};
    const twice = placeBlock(once, 3, edited, 20, held);
    expect(twice[3].blocks).toEqual([{at: 6, block: edited}]);
  });

  it('never duplicates an id across messages while the dashboard is open, and does not mutate the input', () => {
    const input = base();
    const snapshot = JSON.parse(JSON.stringify(input));
    let out = placeBlock(input, 3, b1, 1, held);
    out = placeBlock(out, 3, b3, 2, held);
    out = placeBlock(out, 3, b3, 2, held);
    const ids = out.flatMap((m) => (m.blocks ?? []).map((p) => p.block.id));
    expect(ids.sort()).toEqual(['b1', 'b2', 'b3']);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('M4: after Clear dashboard (nothing held) a new b1 is a NEW block of the current message and the old b1 stays', () => {
    const fresh = {...b1, title: 'Unrelated tile'};
    const out = placeBlock(base(), 3, fresh, 4, new Set());
    expect(out[1].blocks).toEqual([{at: 3, block: b1}, {at: 5, block: b2}]); // the earlier answer is untouched
    expect(out[3].blocks).toEqual([{at: 4, block: fresh}]);
  });

  it('an id that is NOT in the open dashboard never replaces an earlier block, even if an older message has it', () => {
    const out = placeBlock(base(), 3, {...b2, title: 'Other'}, 4, new Set(['b1']));
    expect(out[1].blocks?.find((p) => p.block.id === 'b2')?.block).toEqual(b2);
    expect(out[3].blocks?.map((p) => p.block.id)).toEqual(['b2']);
  });

  it('with the same id in two earlier messages the NEWEST one is the open dashboard\'s and is the one replaced', () => {
    const msgs: M[] = [
      {role: 'assistant', content: 'old', blocks: [{at: 0, block: b1}]},
      {role: 'assistant', content: 'newer dashboard', blocks: [{at: 0, block: {...b1, title: 'Newer'}}]},
      {role: 'assistant', content: 'now'},
    ];
    const edited = {...b1, title: 'Edited newer'};
    const out = placeBlock(msgs, 2, edited, 0, new Set(['b1']));
    expect(out[0].blocks?.[0].block).toEqual(b1);
    expect(out[1].blocks?.[0].block).toEqual(edited);
    expect(out[2].blocks).toBeUndefined();
  });
});

describe('dropBlocks', () => {
  const blk = (id: string) => ({at: 0, block: {id, kind: 'table'} as unknown as ChatBlock});
  it('removes the named blocks from every message and leaves the rest untouched', () => {
    const msgs = [{blocks: [blk('b1'), blk('b2')]}, {blocks: [blk('b3')]}, {}];
    const out = dropBlocks(msgs, new Set(['b1', 'b3']));
    expect(out[0].blocks?.map((p) => p.block.id)).toEqual(['b2']);
    expect(out[1].blocks).toEqual([]);
    expect(out[2]).toBe(msgs[2]);
  });
  it('with the same id in two messages (a cleared dashboard, then a new one) only the NEWEST copy goes', () => {
    const msgs = [{blocks: [blk('b1')]}, {blocks: [blk('b1'), blk('b2')]}];
    const out = dropBlocks(msgs, new Set(['b1']));
    expect(out[0].blocks?.map((p) => p.block.id)).toEqual(['b1']);
    expect(out[1].blocks?.map((p) => p.block.id)).toEqual(['b2']);
  });
  it('returns the same array when nothing is removed', () => {
    const msgs = [{blocks: [blk('b1')]}];
    expect(dropBlocks(msgs, new Set())).toBe(msgs);
  });
});

describe('applyReportEvent', () => {
  const blk = (id: string) => ({at: 0, block: {id, kind: 'table'} as unknown as ChatBlock});
  const spec = (ids: string[]) => ({spec_version: 1, title: '', filters: {range: 'all_available', from: '', to: '', pet: 'all', event: 'all', channel: 'offline', pinned: false}, blocks: ids.map((id) => ({id}))}) as unknown as ReportSpec;
  it('keeps blocks drawn this turn that no report records (digest lookups): the "I drew a pie but nothing shows" regression', () => {
    const msgs = [{blocks: [blk('b1'), blk('b2')]}];
    const out = applyReportEvent(msgs, new Set(), spec([]));
    expect(out.messages[0].blocks?.map((p) => p.block.id)).toEqual(['b1', 'b2']);
  });
  it('removes only blocks that were in the previous report and are gone from the new one', () => {
    const msgs = [{blocks: [blk('b1'), blk('b2'), blk('b9')]}];
    const out = applyReportEvent(msgs, new Set(['b1', 'b2']), spec(['b2']));
    expect(out.messages[0].blocks?.map((p) => p.block.id)).toEqual(['b2', 'b9']);
    expect([...out.held]).toEqual(['b2']);
  });
  it('a null spec empties the held set', () => {
    expect(applyReportEvent([{}], new Set(['b1']), null).held.size).toBe(0);
  });
});
