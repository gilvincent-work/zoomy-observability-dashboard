import {describe, expect, it} from 'vitest';
import {suggestSave} from '../src/reports-suggest';
import {chartBlock, kpiBlock, spec} from './support/report-fixtures';

describe('suggestSave (the drawer offers Save or Update; the model never saves)', () => {
  it("'save' when the draft has a block and is not saved", () => {
    expect(suggestSave(spec(), null)).toBe('save');
  });
  it('null with no draft or no blocks, saved or not', () => {
    expect(suggestSave(null, null)).toBeNull();
    expect(suggestSave(spec([]), null)).toBeNull();
    expect(suggestSave(spec([]), {id: 'x', version: 1, spec: spec()})).toBeNull();
  });
  it("'update' when the draft differs from the saved version, null when it matches", () => {
    const saved = {id: 'x', version: 2, spec: spec()};
    expect(suggestSave(spec(), saved)).toBeNull();
    expect(suggestSave(spec([kpiBlock('b1'), chartBlock('b2')]), saved)).toBe('update');
    expect(suggestSave(spec(undefined, {filters: {...spec().filters, pet: 'cat'}}), saved)).toBe('update');
  });
  it('ignores key order (stored jsonb), the title (rename makes no version) and the Pin dates flag', () => {
    const s = spec();
    const reordered = JSON.parse(JSON.stringify({blocks: s.blocks.map((b) => ({view: b.view, query: b.query, kind: b.kind, id: b.id})), filters: {pinned: true, channel: s.filters.channel, event: 'all', pet: 'all', to: '', from: '', range: 'all_available'}, title: 'Renamed later', spec_version: 1}));
    expect(suggestSave(s, {id: 'x', version: 1, spec: reordered})).toBeNull();
  });
  it('a saved spec that is not even an object counts as different', () => {
    expect(suggestSave(spec(), {id: 'x', version: 1, spec: 'garbage'})).toBe('update');
    expect(suggestSave(spec(), {id: 'x', version: 1, spec: null})).toBe('update');
  });
});
