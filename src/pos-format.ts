// Pure helpers for the Product Controls page. Kept free of server/client
// concerns so they're unit-testable and shareable across both.

export type ProductLine = 'FDR' | 'JRK' | 'MEAT' | string;

/** Format a peso amount for display: ₱170, ₱1,250.50. */
export function formatPeso(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `₱${value.toLocaleString('en-PH', {minimumFractionDigits: 0, maximumFractionDigits: 2})}`;
}

/**
 * Validate a price string from the reprice form. Returns the parsed number or an
 * error message. Prices must be a positive, finite number.
 */
export function parsePrice(input: string): {value: number} | {error: string} {
  const trimmed = input.trim();
  if (!trimmed) return {error: 'Price is required.'};
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return {error: 'Enter a valid number.'};
  if (n <= 0) return {error: 'Price must be greater than zero.'};
  return {value: n};
}

/**
 * Validate a stock quantity string. Returns the parsed non-negative integer or
 * an error message. Empty is treated as 0 (allowed).
 */
export function parseQty(input: string): {value: number} | {error: string} {
  const trimmed = input.trim();
  if (!trimmed) return {value: 0};
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return {error: 'Enter a whole number.'};
  if (n < 0) return {error: 'Stock cannot be negative.'};
  return {value: n};
}

/** The valid product lines (static set) — the Line dropdown's options. */
export const PRODUCT_LINES = ['FDR', 'JRK', 'MEAT'] as const;
export type ProductLineCode = (typeof PRODUCT_LINES)[number];

/** The POS display tabs (categories). Coop is authoritative for these. */
export const POS_CATEGORIES = ['Freeze Dried', 'Meaty Treats', 'Super Duo Bites', 'Tasty Treats'] as const;
export type PosCategory = (typeof POS_CATEGORIES)[number];

/** Freeze-Dried's secondary tabs. Only that category has subcategories. */
export const POS_SUBCATEGORIES = ['Fish', 'Meats', 'Cat Grass / Yogurt', 'Super Food'] as const;
export const SUBCATEGORY_CATEGORY = 'Freeze Dried';

/** A product is low on stock when at/under this many units (UI hint only). */
export const LOW_STOCK_THRESHOLD = 10;

export function stockLabel(stock: number): 'out' | 'low' | 'ok' {
  if (stock <= 0) return 'out';
  if (stock <= LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

/** Human label for a product-line code. */
export function lineLabel(line: ProductLine): string {
  switch (line) {
    case 'FDR':
      return 'Freeze-Dried';
    case 'JRK':
      return 'Jerky';
    case 'MEAT':
      return 'Meaty';
    default:
      return line || '—';
  }
}
