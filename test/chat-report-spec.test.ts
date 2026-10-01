import {describe, expect, it} from 'vitest';
import {emptySpec, filtersOf, queryOf, requestOf, sameFilters, validateSpec} from '../src/chat/report-spec';
import {REPORT_MAX_BLOCKS, REPORT_MAX_BYTES} from '../src/chat/report-types';
import {BASE, chartBlock, FILTERS, kpiBlock, spec, tableBlock} from './support/report-fixtures';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ok = (raw: unknown) => {
  const r = validateSpec(raw);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};
const bad = (raw: unknown): string => {
  const r = validateSpec(raw);
  if (r.ok) throw new Error('expected the spec to be rejected');
  return r.error;
};

describe('validateSpec: a valid spec', () => {
  it('passes unchanged and shares nothing with the input', () => {
    const input = spec();
    const out = ok(input);
    expect(out).toEqual(input);
    out.blocks[0].id = 'b9';
    expect(input.blocks[0].id).toBe('b1');
  });
  it('accepts an empty report and the emptySpec helper', () => {
    expect(ok(emptySpec())).toEqual(emptySpec());
  });
});

describe('validateSpec: untrusted input is rebuilt, never copied (criterion 7)', () => {
  it('strips unknown keys at every level', () => {
    const raw: any = clone(spec());
    raw.evil = 1;
    raw.filters.evil = 1;
    raw.blocks[0].evil = 1;
    raw.blocks[0].query.evil = 1;
    raw.blocks[0].view.evil = 1;
    const out = ok(raw);
    expect(JSON.stringify(out)).not.toContain('evil');
    expect(out).toEqual(spec());
  });
  it('drops data, values and rows keys at any depth', () => {
    const raw: any = clone(spec());
    raw.data = [1];
    raw.blocks[0].data = {x: 1};
    raw.blocks[1].view.values = [1, 2];
    raw.blocks[2].view.rows = [{a: 1}];
    raw.filters.rows = [];
    const text = JSON.stringify(ok(raw));
    for (const key of ['"data"', '"values"', '"rows"']) expect(text).not.toContain(key);
  });
  it('never copies __proto__, constructor or prototype keys', () => {
    const raw = JSON.parse(
      '{"spec_version":1,"title":"T","__proto__":{"polluted":true},"filters":{"range":"all_available","from":"","to":"","pet":"all","event":"all","channel":"offline","pinned":false,"__proto__":{"x":1}},' +
        '"blocks":[{"id":"b1","kind":"kpi","__proto__":{"y":1},"constructor":{"prototype":{"z":1}},"query":{"metric":"bundle_sales","dimension":"none","measure":"default","compare_to":"none","sort":"default","limit":25},"view":{"value":"bundle_revenue","label":"R","format":"peso"}}]}',
    );
    const out = ok(raw);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(['blocks', 'filters', 'spec_version', 'title']);
    expect(Object.keys(out.blocks[0]).sort()).toEqual(['id', 'kind', 'query', 'view']);
  });
  it('forces filters.pinned to false', () => {
    const raw: any = clone(spec());
    raw.filters.pinned = true;
    expect(ok(raw).filters.pinned).toBe(false);
  });
  it('keeps dates only for a custom range', () => {
    const raw: any = clone(spec());
    raw.filters.from = '2026-09-01';
    raw.filters.to = '2026-09-30';
    expect(ok(raw).filters).toMatchObject({from: '', to: ''});
    raw.filters.range = 'custom';
    expect(ok(raw).filters).toMatchObject({from: '2026-09-01', to: '2026-09-30'});
    raw.filters.to = '2026-02-30';
    expect(bad(raw)).toMatch(/custom range/);
    raw.filters.to = '';
    expect(bad(raw)).toMatch(/custom range/);
  });
});

describe('validateSpec: bounds and enums', () => {
  it('requires spec_version 1', () => {
    for (const v of [0, 2, '1', undefined, null]) expect(bad({...spec(), spec_version: v})).toMatch(/spec_version/);
  });
  it('rejects a non-object, an array and null', () => {
    for (const v of [null, undefined, 5, 'x', [], [spec()]]) expect(validateSpec(v).ok).toBe(false);
  });
  it('accepts 12 blocks and rejects 13 (criterion 7)', () => {
    const many = (n: number) => spec(Array.from({length: n}, (_, i) => kpiBlock(`b${i + 1}`)));
    expect(ok(many(REPORT_MAX_BLOCKS)).blocks).toHaveLength(12);
    expect(bad(many(13))).toMatch(/at most 12/);
  });
  it('rejects bad, reused or non-string block ids', () => {
    for (const id of ['', 'b0', 'b01', 'B1', 'b1000', 'x1', 'b1 ', 5, null]) expect(validateSpec(spec([kpiBlock(id as string)])).ok).toBe(false);
    expect(bad(spec([kpiBlock('b1'), kpiBlock('b1')]))).toMatch(/unique/);
    expect(validateSpec(spec([kpiBlock('b999')])).ok).toBe(true);
  });
  it('rejects an unknown block kind', () => {
    expect(bad(spec([{...kpiBlock('b1'), kind: 'map'} as never]))).toMatch(/kpi, chart or table/);
  });
  it('rejects an unknown metric, an undeclared dimension or measure (criterion 7)', () => {
    const q = (over: object) => spec([kpiBlock('b1', {query: {...kpiBlock('b1').query, ...over}} as never)]);
    expect(bad(q({metric: 'drop_table'}))).toMatch(/unknown metric/);
    expect(bad(q({metric: '__proto__'}))).toMatch(/unknown metric/);
    expect(bad(q({dimension: 'sku'}))).toMatch(/dimension/);
    expect(bad(q({dimension: 'default'}))).toMatch(/dimension/);
    expect(bad(q({measure: 'aov'}))).toMatch(/measure/);
    expect(validateSpec(q({measure: 'revenue'})).ok).toBe(true);
    expect(validateSpec(q({measure: 'default'})).ok).toBe(true);
  });
  it('checks every enum', () => {
    const qv = (over: object) => spec([kpiBlock('b1', {query: {...kpiBlock('b1').query, ...over}} as never)]);
    expect(bad(qv({compare_to: 'next'}))).toMatch(/compare_to/);
    expect(bad(qv({sort: 'random'}))).toMatch(/sort/);
    expect(bad(qv({limit: 7}))).toMatch(/limit/);
    expect(bad(qv({limit: '5'}))).toMatch(/limit/);
    const f = (over: object) => ({...spec(), filters: {...FILTERS, ...over}});
    expect(bad(f({range: 'forever'}))).toMatch(/range/);
    expect(bad(f({pet: 'bird'}))).toMatch(/pet/);
    expect(bad(f({channel: 'lazada'}))).toMatch(/channel/);
    expect(bad(f({event: '   '}))).toMatch(/event/);
    const chart = (over: object) => spec([{...chartBlock('b1'), view: {...(chartBlock('b1') as any).view, ...over}} as never]);
    expect(bad(chart({kind: 'radar'}))).toMatch(/chart kind/);
    expect(bad(chart({orientation: 'diagonal'}))).toMatch(/orientation/);
    expect(bad(chart({mode: 'manual'}))).toMatch(/mode/);
    expect(validateSpec(chart({kind: 'pie', mode: 'user'})).ok).toBe(true);
    expect(bad(spec([kpiBlock('b1', {view: {value: 'bundle_revenue', label: 'R', format: 'euro'}} as never)]))).toMatch(/format/);
  });
  it('rejects a y of 9 entries, an over-long field name and a column list over its cap', () => {
    const y = (list: unknown) => spec([{...chartBlock('b1'), view: {...(chartBlock('b1') as any).view, y: list}} as never]);
    expect(validateSpec(y(Array.from({length: 8}, (_, i) => `m${i}`))).ok).toBe(true);
    expect(bad(y(Array.from({length: 9}, (_, i) => `m${i}`)))).toMatch(/at most 8/);
    expect(validateSpec(y(['x'.repeat(60)])).ok).toBe(true);
    expect(validateSpec(y(['x'.repeat(61)])).ok).toBe(false);
    expect(validateSpec(y([5])).ok).toBe(false);
    expect(validateSpec(y('auto')).ok).toBe(false);
    const cols = (list: unknown) => spec([{...tableBlock('b1'), view: {columns: list, title: ''}} as never]);
    expect(validateSpec(cols(Array.from({length: 24}, (_, i) => `c${i}`))).ok).toBe(true);
    expect(validateSpec(cols(Array.from({length: 25}, (_, i) => `c${i}`))).ok).toBe(false);
  });
  it('trims titles and labels to plain text of at most 120 characters', () => {
    const raw: any = clone(spec());
    raw.title = `  ${'T'.repeat(5000)}  `;
    raw.blocks[0].view.label = 'Bundle\u0000 \n revenue\t';
    raw.blocks[1].view.title = `<b>${'x'.repeat(200)}</b>`;
    const out = ok(raw);
    expect(out.title).toBe('T'.repeat(120));
    expect((out.blocks[0] as any).view.label).toBe('Bundle revenue');
    expect((out.blocks[1] as any).view.title).toHaveLength(120);
  });
  it('rejects a spec over 32 KB before reading it deeply', () => {
    const big = spec();
    big.title = 'T'.repeat(REPORT_MAX_BYTES);
    expect(bad(big)).toMatch(/larger than/);
    const cyclic: any = {spec_version: 1};
    cyclic.self = cyclic;
    expect(bad(cyclic)).toMatch(/could not be read/);
  });
});

describe('helpers', () => {
  it('requestOf puts the report filters on a block query, and queryOf/filtersOf split it back', () => {
    const q = kpiBlock('b1').query;
    const req = requestOf(q, {...FILTERS, pet: 'cat', range: 'last_week'});
    expect(req).toMatchObject({metric: 'bundle_sales', pet: 'cat', range: 'last_week', event: 'all', channel: 'offline', limit: 25});
    expect(queryOf(req)).toEqual(q);
    expect(filtersOf(req)).toEqual({...FILTERS, pet: 'cat', range: 'last_week'});
    expect(filtersOf(BASE)).toEqual(FILTERS);
  });
  it('sameFilters ignores dates unless custom and the case of the event name', () => {
    expect(sameFilters(FILTERS, {...FILTERS, from: '2026-01-01', to: '2026-01-02'})).toBe(true);
    expect(sameFilters({...FILTERS, range: 'custom', from: '2026-01-01', to: '2026-01-02'}, {...FILTERS, range: 'custom', from: '2026-01-01', to: '2026-01-03'})).toBe(false);
    expect(sameFilters({...FILTERS, event: 'Mall Pop-up'}, {...FILTERS, event: ' mall pop-up '})).toBe(true);
    expect(sameFilters(FILTERS, {...FILTERS, pet: 'cat'})).toBe(false);
  });
});
