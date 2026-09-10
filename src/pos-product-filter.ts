// Pure filtering for the Product Controls table. Kept free of server/client
// concerns so it's unit-testable and shareable, mirroring pos-sales-compute.ts's
// transactions filter. Unlike that filter, this one is local component state —
// the whole catalog is already loaded (no pagination), so narrowing it down is
// just an in-memory filter, not a URL-param-driven server refetch.

import type {PosProductRow} from './pos-types';
import {POS_CATEGORIES, POS_SUBCATEGORIES, SUBCATEGORY_CATEGORY} from './pos-format';

export type ProductStatusFilter = 'all' | 'listed' | 'unlisted';

export interface ProductFilter {
  search: string;
  category: string; // '' = all
  subcategory: string; // '' = all; only meaningful when category === SUBCATEGORY_CATEGORY
  status: ProductStatusFilter;
  minStock: number | null;
  maxStock: number | null;
}

export const DEFAULT_PRODUCT_FILTER: ProductFilter = {
  search: '',
  category: '',
  subcategory: '',
  status: 'all',
  minStock: null,
  maxStock: null,
};

/** Category chips, mirroring the POS's own category tabs. */
export const PRODUCT_CATEGORY_FILTERS: {value: string; label: string}[] = [
  {value: '', label: 'All'},
  ...POS_CATEGORIES.map((c) => ({value: c as string, label: c})),
];

/** Subcategory chips, shown only when the category filter is Freeze Dried. */
export const PRODUCT_SUBCATEGORY_FILTERS: {value: string; label: string}[] = [
  {value: '', label: 'All'},
  ...POS_SUBCATEGORIES.map((s) => ({value: s as string, label: s})),
];

/** Status chips for the listed/unlisted toggle column. */
export const PRODUCT_STATUS_FILTERS: {value: ProductStatusFilter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'listed', label: 'Listed'},
  {value: 'unlisted', label: 'Unlisted'},
];

/** True when any filter is narrowing the results (used to show a Clear). */
export function isProductFilterActive(f: ProductFilter): boolean {
  return (
    f.search.trim() !== '' ||
    f.category !== '' ||
    f.subcategory !== '' ||
    f.status !== 'all' ||
    f.minStock != null ||
    f.maxStock != null
  );
}

/** Slider ceiling from the dataset's current max stock (never below 10). */
export function productStockMax(rows: PosProductRow[]): number {
  return Math.max(10, rows.reduce((m, r) => Math.max(m, r.stock), 0));
}

/** Apply the product filter in memory. */
export function filterProductRows(rows: PosProductRow[], f: ProductFilter): PosProductRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.category && (r.category ?? '') !== f.category) return false;
    if (f.category === SUBCATEGORY_CATEGORY && f.subcategory && (r.subcategory ?? '') !== f.subcategory) {
      return false;
    }
    if (f.status === 'listed' && !r.active) return false;
    if (f.status === 'unlisted' && r.active) return false;
    if (f.minStock != null && r.stock < f.minStock) return false;
    if (f.maxStock != null && r.stock > f.maxStock) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.product_id.toLowerCase().includes(q))) return false;
    return true;
  });
}
