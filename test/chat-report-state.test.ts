import {describe, expect, it} from 'vitest';
import type {ChatBlock} from '../src/chat/block-types';
import type {ReportBlockSpec, ReportFilters, ReportSpec} from '../src/chat/report-types';
import {describeFilters, dropBlocks, placeBlock, reportBody, sanitizeReport} from '../components/analyst/report-state';
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

  it('replaces an id from an earlier message in place and leaves the rest untouched', () => {
    const edited = {...b1, title: 'Edited'};
    const out = placeBlock(base(), 3, edited, 99);
    const expected = base();
    expected[1].blocks = [{at: 3, block: edited}, {at: 5, block: b2}];
    expect(out).toEqual(expected);
    expect(out[3].blocks).toBeUndefined();
  });

  it('appends a new id to the current message at its offset', () => {
    const out = placeBlock(base(), 3, b3, 6);
    expect(out[3].blocks).toEqual([{at: 6, block: b3}]);
    expect(out[1]).toEqual(base()[1]);
  });

  it('upserts an id already in the current message', () => {
    const once = placeBlock(base(), 3, b3, 6);
    const edited = {...b3, title: 'Again'};
    const twice = placeBlock(once, 3, edited, 20);
    expect(twice[3].blocks).toEqual([{at: 6, block: edited}]);
  });

  it('never duplicates an id across messages and does not mutate the input', () => {
    const input = base();
    const snapshot = JSON.parse(JSON.stringify(input));
    let out = placeBlock(input, 3, b1, 1);
    out = placeBlock(out, 3, b3, 2);
    out = placeBlock(out, 3, b3, 2);
    const ids = out.flatMap((m) => (m.blocks ?? []).map((p) => p.block.id));
    expect(ids.sort()).toEqual(['b1', 'b2', 'b3']);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
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
  it('returns the same array when nothing is removed', () => {
    const msgs = [{blocks: [blk('b1')]}];
    expect(dropBlocks(msgs, new Set())).toBe(msgs);
  });
});
