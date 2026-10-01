import {describe, it, expect} from 'vitest';
import {filterInventoryRows, setStockRpcArgs, type FilterableInventoryRow, type InventoryFilter} from '../src/pos-inventory-compute';

const row = (over: Partial<FilterableInventoryRow> & {product_id: string}): FilterableInventoryRow => ({
  name: over.product_id, category: 'Freeze Dried', subcategory: null, active: true,
  status: 'healthy', office: 0, event: 5, ...over,
});

const NONE: InventoryFilter = {line: '', sub: '', status: '', loc: '', showOut: true, search: ''};
const ids = (rs: FilterableInventoryRow[]) => rs.map((r) => r.product_id);

const ROWS = [
  row({product_id: 'A1', name: 'Chicken Bites', status: 'healthy', event: 10}),
  row({product_id: 'B2', name: 'Salmon Chips', status: 'low', event: 2, office: 4}),
  row({product_id: 'C3', name: 'Beef Jerky', status: 'out', event: 0, office: 0, category: 'Meaty Treats'}),
  row({product_id: 'D4', name: 'Duck Feet', status: 'out', event: 0, office: 6, active: false}),
];

describe('filterInventoryRows', () => {
  it('returns every row with no filters', () => {
    expect(ids(filterInventoryRows(ROWS, NONE))).toEqual(['A1', 'B2', 'C3', 'D4']);
  });

  it('hides products tagged Out when showOut is off', () => {
    expect(ids(filterInventoryRows(ROWS, {...NONE, showOut: false}))).toEqual(['A1', 'B2']);
  });

  it('shows Out products when the Out status pill is chosen with showOut on', () => {
    expect(ids(filterInventoryRows(ROWS, {...NONE, status: 'out'}))).toEqual(['C3', 'D4']);
  });

  it('showOut off wins over the Out status pill (the UI resets the pill, the filter stays safe)', () => {
    expect(filterInventoryRows(ROWS, {...NONE, status: 'out', showOut: false})).toEqual([]);
  });

  it('filters by status and by unlisted', () => {
    expect(ids(filterInventoryRows(ROWS, {...NONE, status: 'low'}))).toEqual(['B2']);
    expect(ids(filterInventoryRows(ROWS, {...NONE, status: 'unlisted'}))).toEqual(['D4']);
  });

  it('filters by location stock (>0 in that location)', () => {
    expect(ids(filterInventoryRows(ROWS, {...NONE, loc: 'office'}))).toEqual(['B2', 'D4']);
    expect(ids(filterInventoryRows(ROWS, {...NONE, loc: 'event'}))).toEqual(['A1', 'B2']);
  });

  it('filters by line, treating a null category as empty', () => {
    const rows = [...ROWS, row({product_id: 'E5', category: null})];
    expect(ids(filterInventoryRows(rows, {...NONE, line: 'Meaty Treats'}))).toEqual(['C3']);
  });

  it('applies the subcategory only when the line is the subcategory line', () => {
    const rows = [
      row({product_id: 'S1', subcategory: 'Fish'}),
      row({product_id: 'S2', subcategory: 'Meats'}),
    ];
    expect(ids(filterInventoryRows(rows, {...NONE, line: 'Freeze Dried', sub: 'Fish'}))).toEqual(['S1']);
    // a stale sub is ignored once another line is selected
    expect(ids(filterInventoryRows([row({product_id: 'T1', category: 'Meaty Treats'})], {...NONE, line: 'Meaty Treats', sub: 'Fish'}))).toEqual(['T1']);
  });

  it('searches name and SKU, case-insensitively and trimmed', () => {
    expect(ids(filterInventoryRows(ROWS, {...NONE, search: '  salmon '}))).toEqual(['B2']);
    expect(ids(filterInventoryRows(ROWS, {...NONE, search: 'c3'}))).toEqual(['C3']);
  });

  it('combines filters and does not mutate the input', () => {
    const copy = [...ROWS];
    expect(ids(filterInventoryRows(ROWS, {...NONE, loc: 'office', showOut: false}))).toEqual(['B2']);
    expect(ROWS).toEqual(copy);
  });
});

describe('setStockRpcArgs', () => {
  it('omits p_location for Event so the original 3-argument function still matches', () => {
    expect(setStockRpcArgs('A1', 7, 'a@b.c', 'event')).toEqual({p_product_id: 'A1', p_new_qty: 7, p_by: 'a@b.c'});
  });

  it('sends p_location only for Office', () => {
    expect(setStockRpcArgs('A1', 7, 'a@b.c', 'office')).toEqual({p_product_id: 'A1', p_new_qty: 7, p_by: 'a@b.c', p_location: 'office'});
  });
});
