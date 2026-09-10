import {describe, it, expect} from 'vitest';
import {
  DEFAULT_PRODUCT_FILTER,
  filterProductRows,
  isProductFilterActive,
  productStockMax,
  type ProductFilter,
} from '../src/pos-product-filter';
import type {PosProductRow} from '../src/pos-types';

function row(overrides: Partial<PosProductRow>): PosProductRow {
  return {
    product_id: 'ZMYFDFDRCGRCUB01',
    name: 'Freeze-Dried Cat Grass Cubes',
    product_line: 'FDR',
    category: 'Freeze Dried',
    subcategory: 'Cat Grass / Yogurt',
    emoji: '🌿',
    active: true,
    price: 170,
    stock: 227,
    next_expiry: null,
    ...overrides,
  };
}

const ROWS: PosProductRow[] = [
  row({product_id: 'ZMYFDFDRCGRCUB01', name: 'Freeze-Dried Cat Grass Cubes', category: 'Freeze Dried', subcategory: 'Cat Grass / Yogurt', stock: 227, active: true}),
  row({product_id: 'ZMYFDFDRSLMCUB01', name: 'Freeze-Dried Salmon Cubes', category: 'Freeze Dried', subcategory: 'Fish', stock: 43, active: true}),
  row({product_id: 'ZMYFDMEATBEFWHL01', name: 'Meaty Treats Beef', category: 'Meaty Treats', subcategory: null, stock: 252, active: true}),
  row({product_id: 'ZMYFDJRKCHKCAR01', name: 'Super Duo Bites Chicken Carrot', category: 'Super Duo Bites', subcategory: null, stock: 8, active: false}),
];

describe('isProductFilterActive', () => {
  it('is false for the default filter', () => {
    expect(isProductFilterActive(DEFAULT_PRODUCT_FILTER)).toBe(false);
  });

  it('is true when any field narrows the result', () => {
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, search: 'beef'})).toBe(true);
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, category: 'Freeze Dried'})).toBe(true);
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, subcategory: 'Fish'})).toBe(true);
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, status: 'listed'})).toBe(true);
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, minStock: 10})).toBe(true);
    expect(isProductFilterActive({...DEFAULT_PRODUCT_FILTER, maxStock: 100})).toBe(true);
  });
});

describe('productStockMax', () => {
  it('returns the dataset max stock', () => {
    expect(productStockMax(ROWS)).toBe(252);
  });

  it('never returns below 10, even for an empty or low-stock set', () => {
    expect(productStockMax([])).toBe(10);
    expect(productStockMax([row({stock: 3})])).toBe(10);
  });
});

describe('filterProductRows', () => {
  it('returns everything for the default filter', () => {
    expect(filterProductRows(ROWS, DEFAULT_PRODUCT_FILTER)).toHaveLength(4);
  });

  it('filters by category', () => {
    const result = filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, category: 'Freeze Dried'});
    expect(result.map((r) => r.product_id)).toEqual(['ZMYFDFDRCGRCUB01', 'ZMYFDFDRSLMCUB01']);
  });

  it('filters by subcategory, scoped to Freeze Dried only', () => {
    const result = filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, category: 'Freeze Dried', subcategory: 'Fish'});
    expect(result.map((r) => r.product_id)).toEqual(['ZMYFDFDRSLMCUB01']);
  });

  it('ignores a leftover subcategory value once the category changes away from Freeze Dried', () => {
    // A stale subcategory (e.g. from a previous selection) must not silently
    // filter out every non-Freeze-Dried row.
    const result = filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, category: 'Meaty Treats', subcategory: 'Fish'});
    expect(result.map((r) => r.product_id)).toEqual(['ZMYFDMEATBEFWHL01']);
  });

  it('filters by listed status', () => {
    expect(filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, status: 'listed'})).toHaveLength(3);
    expect(filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, status: 'unlisted'})).toHaveLength(1);
  });

  it('filters by stock range', () => {
    const result = filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, minStock: 50, maxStock: 230});
    expect(result.map((r) => r.product_id)).toEqual(['ZMYFDFDRCGRCUB01']);
  });

  it('filters by name or SKU search, case-insensitively', () => {
    expect(filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, search: 'salmon'}).map((r) => r.product_id)).toEqual([
      'ZMYFDFDRSLMCUB01',
    ]);
    expect(
      filterProductRows(ROWS, {...DEFAULT_PRODUCT_FILTER, search: 'zmyfdmeatbefwhl01'}).map((r) => r.product_id),
    ).toEqual(['ZMYFDMEATBEFWHL01']);
  });

  it('combines multiple active filters (AND, not OR)', () => {
    const filter: ProductFilter = {
      ...DEFAULT_PRODUCT_FILTER,
      category: 'Freeze Dried',
      subcategory: 'Cat Grass / Yogurt',
      status: 'listed',
      minStock: 100,
    };
    expect(filterProductRows(ROWS, filter).map((r) => r.product_id)).toEqual(['ZMYFDFDRCGRCUB01']);
  });
});
