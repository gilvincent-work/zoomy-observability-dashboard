import {describe, expect, it} from 'vitest';
import {
  formatReportDay,
  formatReportTime,
  friendlySaveError,
  lastUserPrompt,
  layoutBlocks,
  loadSavedRef,
  noticeFor,
  parseVersionParam,
  pinDatesFor,
  reportHref,
  saveBarState,
  serializeSavedRef,
  statusLine,
  toDrawerSpec,
  versionSummary,
  versionTitle,
} from '../components/analyst/reports-helpers';
import {kpiRow, plainBar, tableTotal} from '../components/analyst/chat-blocks.fixtures';
import {chartBlock, kpiBlock, spec} from './support/report-fixtures';

describe('parseVersionParam (?v=N)', () => {
  it('accepts a positive integer', () => {
    expect(parseVersionParam('1')).toBe(1);
    expect(parseVersionParam('12')).toBe(12);
  });
  it('anything else means the latest version', () => {
    for (const bad of [undefined, '', 'abc', '0', '-1', '1.5', '2e3', ' 2', '2 ', '00', '999999999', '99999999999999999999', '1;drop']) {
      expect(parseVersionParam(bad), String(bad)).toBeUndefined();
    }
  });
  it('takes the first of a repeated parameter', () => {
    expect(parseVersionParam(['3', '4'])).toBe(3);
    expect(parseVersionParam([])).toBeUndefined();
  });
  it('builds the URL: latest is the plain one', () => {
    expect(reportHref('abc')).toBe('/reports/abc');
    expect(reportHref('abc', 2)).toBe('/reports/abc?v=2');
  });
});

describe('labels', () => {
  it('prints Philippine time, the same on server and browser', () => {
    expect(formatReportTime('2026-09-27T06:02:00Z')).toBe('Sep 27, 2:02 PM');
    expect(formatReportTime('nonsense')).toBe('');
  });
  it('formats a calendar day', () => {
    expect(formatReportDay('2026-09-27')).toBe('Sep 27');
    expect(formatReportDay(null)).toBe('');
    expect(formatReportDay('27/09/2026')).toBe('');
  });
  it('labels versions', () => {
    expect(versionTitle(3, 3)).toBe('Version 3 (latest)');
    expect(versionTitle(2, 3)).toBe('Version 2');
    expect(versionSummary({created_at: '2026-09-27T06:02:00Z', created_by: 'a@zoomy.ph'})).toBe('Sep 27, 2:02 PM by a@zoomy.ph');
    expect(versionSummary({created_at: 'x', created_by: ''})).toBe('');
  });
  it('writes the header status line for Live and Pinned', () => {
    const now = new Date('2026-09-28T06:02:00Z');
    expect(statusLine({mode: 'live', rangeLabel: 'Sep 21 to Sep 27, 2026', dataThrough: '2026-09-27'}, now)).toBe('Live, data through Sep 27, refreshed 2:02 PM');
    expect(statusLine({mode: 'live', rangeLabel: null, dataThrough: null}, now)).toBe('Live, refreshed 2:02 PM');
    expect(statusLine({mode: 'pinned', rangeLabel: 'Sep 11 to Sep 27, 2026', dataThrough: '2026-09-27'}, now)).toBe('Pinned Sep 11 to Sep 27, 2026');
  });
  it('words the not-ready states calmly, without technical detail', () => {
    expect(noticeFor('not_setup').title).toBe('Reports not set up');
    expect(noticeFor('not_setup').body).toMatch(/person/i);
    expect(noticeFor('unconfigured').title).toMatch(/Supabase/);
    expect(noticeFor('error', 'boom').body).toBe('boom');
    expect(noticeFor('error', 'x'.repeat(500)).body).toMatch(/try again/i);
    expect(noticeFor('error').body).toMatch(/try again/i);
  });
});

describe('layoutBlocks', () => {
  const [k1, k2] = kpiRow;
  it('groups adjacent stat tiles into one row, keeps order, and lets an error card sit among the others', () => {
    const items = layoutBlocks([k1, k2, plainBar, {id: 'b4', error: 'Metric no longer available'}, kpiRow[2], tableTotal]);
    expect(items.map((i) => i.kind)).toEqual(['kpis', 'chart', 'error', 'kpis', 'table']);
    expect(items[0].kind === 'kpis' && items[0].blocks.map((b) => b.id)).toEqual([k1.id, k2.id]);
    expect(items[2]).toMatchObject({kind: 'error', id: 'b4', error: 'Metric no longer available'});
  });
  it('is empty for no blocks', () => {
    expect(layoutBlocks([])).toEqual([]);
  });
});

describe('saved reference persisted in coop-report-saved-v1', () => {
  const ref = {id: 'abc', version: 2, spec: spec()};
  it('round-trips', () => {
    expect(loadSavedRef(serializeSavedRef(ref))).toEqual(ref);
  });
  it('is tolerant: anything malformed is null and nothing throws', () => {
    const bad = [null, undefined, '', 'not json', '[]', '"x"', '123', '{}', JSON.stringify({id: '', version: 1, spec: {}}), JSON.stringify({id: 'a', version: 0, spec: {}}), JSON.stringify({id: 'a', version: 1.5, spec: {}}), JSON.stringify({id: 'a', version: '2', spec: {}}), JSON.stringify({id: 'a', version: 1, spec: 'x'}), JSON.stringify({id: 'a', version: 1, spec: [1]}), JSON.stringify({id: 7, version: 1, spec: {}}), JSON.stringify({id: 'a'.repeat(200), version: 1, spec: {}})];
    for (const raw of bad) expect(loadSavedRef(raw), String(raw)).toBeNull();
  });
  it('drops unknown extra keys', () => {
    expect(loadSavedRef(JSON.stringify({id: 'a', version: 1, spec: {k: 1}, junk: true}))).toEqual({id: 'a', version: 1, spec: {k: 1}});
  });
});

describe('saveBarState (draft, none, save, update, saved, pending, error)', () => {
  const idle = {pending: false, busy: false, error: null};
  it('none without a draft or without blocks', () => {
    expect(saveBarState(null, null, idle)).toEqual({kind: 'none'});
    expect(saveBarState(spec([]), null, idle)).toEqual({kind: 'none'});
    expect(saveBarState(spec([]), {id: 'a', version: 1, spec: spec()}, idle)).toEqual({kind: 'none'});
  });
  it('save for an unsaved draft', () => {
    expect(saveBarState(spec(), null, idle)).toEqual({kind: 'save', pending: false, disabled: false, error: null});
  });
  it('update when the saved recipe differs, saved when it matches', () => {
    const saved = {id: 'a', version: 2, spec: spec()};
    expect(saveBarState(spec([kpiBlock('b1'), chartBlock('b2')]), saved, idle).kind).toBe('update');
    expect(saveBarState(spec(), saved, idle).kind).toBe('saved');
  });
  it('disables while an action is pending or the chat is still answering', () => {
    expect(saveBarState(spec(), null, {...idle, pending: true})).toMatchObject({kind: 'save', pending: true, disabled: true});
    expect(saveBarState(spec(), null, {...idle, busy: true})).toMatchObject({kind: 'save', pending: false, disabled: true});
  });
  it('carries an error to show inline', () => {
    expect(saveBarState(spec(), null, {...idle, error: 'nope'})).toMatchObject({kind: 'save', error: 'nope'});
  });
  it('words a stale version in one plain sentence and passes other errors through', () => {
    const stale = 'This report changed since you opened it (it is now version 3). Reload it and try again. Nothing was saved.';
    expect(friendlySaveError(stale)).toBe('This report changed elsewhere. Open it to see the latest.');
    expect(friendlySaveError('Reload the report and try again.')).toBe('This report changed elsewhere. Open it to see the latest.');
    expect(friendlySaveError('Sign in to use reports.')).toBe('Sign in to use reports.');
  });
});

describe('drawer glue', () => {
  it('sends the last user message as the prompt, capped at 2000 characters', () => {
    expect(lastUserPrompt([])).toBeNull();
    expect(lastUserPrompt([{role: 'assistant', content: 'hi'}])).toBeNull();
    expect(lastUserPrompt([{role: 'user', content: ' first '}, {role: 'assistant', content: 'a'}, {role: 'user', content: '  make it a pie  '}, {role: 'assistant', content: 'ok'}])).toBe('make it a pie');
    expect(lastUserPrompt([{role: 'user', content: '   '}])).toBeNull();
    expect(lastUserPrompt([{role: 'user', content: 'x'.repeat(3000)}])?.length).toBe(2000);
  });
  it('opens a stored spec as a draft with Pin dates off, or null when it is not a version 1 recipe', () => {
    const stored = spec(undefined, {filters: {...spec().filters, range: 'custom', from: '2026-09-11', to: '2026-09-27', pinned: true} as never});
    expect(toDrawerSpec(stored)?.filters.pinned).toBe(false);
    expect(toDrawerSpec(stored)?.filters.from).toBe('2026-09-11');
    expect(toDrawerSpec({spec_version: 2})).toBeNull();
    expect(toDrawerSpec('x')).toBeNull();
  });
  it('keeps fixed dates on an update only when the saved version had them and the draft is still a custom range', () => {
    const pinned = {id: 'a', version: 1, spec: {filters: {pinned: true}}};
    const custom = spec(undefined, {filters: {...spec().filters, range: 'custom', from: '2026-09-11', to: '2026-09-27'}});
    expect(pinDatesFor(pinned, custom)).toBe(true);
    expect(pinDatesFor(pinned, spec())).toBe(false);
    expect(pinDatesFor({id: 'a', version: 1, spec: {filters: {pinned: false}}}, custom)).toBe(false);
    expect(pinDatesFor(null, custom)).toBe(false);
  });
});
