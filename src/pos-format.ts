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
