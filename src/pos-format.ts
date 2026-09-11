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

/** The POS tile emoji fallback, shared with the app's default. */
export const DEFAULT_EMOJI = '🍬';
export const MAX_EMOJI = 3;

/**
 * Curated tile emojis for the tap-only picker (users don't type these, and a
 * desktop has no emoji key). Mirrors zoomy-pos/constants/emoji.ts.
 */
export const PRODUCT_EMOJIS = [
  '🍬', '🦴', '🐾', '🐕', '🐈', '⭐️',
  '🥩', '🍖', '🍗', '🥓', '🍔', '🌭',
  '🐟', '🐠', '🍤', '🦐', '🦑', '🦀',
  '🐔', '🦆', '🦃', '🥚', '🧀', '🥛',
  '🌿', '🍀', '🥕', '🫐', '🍓', '🍎',
  '🍐', '🎃', '🍠', '🥦', '🥜', '🍯',
  '🥢', '🧊',
];

/** Split a string into grapheme clusters so multi-codepoint emoji count as one. */
export function graphemes(input: string): string[] {
  const Seg = (Intl as {Segmenter?: typeof Intl.Segmenter}).Segmenter;
  if (Seg) {
    return Array.from(new Seg(undefined, {granularity: 'grapheme'}).segment(input), (s) => s.segment);
  }
  return Array.from(input); // code-point fallback (good enough for most emoji)
}

/** Trim whitespace and cap at MAX_EMOJI grapheme clusters (for input handling). */
export function clampEmoji(input: string): string {
  return graphemes(input.replace(/\s+/g, '')).slice(0, MAX_EMOJI).join('');
}

/**
 * Validate an emoji field: 1 to MAX_EMOJI characters after trimming. Returns the
 * cleaned value or an error. Empty is allowed by callers that treat it as "use
 * the default" — this is for the explicit-set path.
 */
export function parseEmoji(input: string): {value: string} | {error: string} {
  const cleaned = clampEmoji(input);
  if (!cleaned) return {error: 'Enter at least one emoji.'};
  return {value: cleaned};
}

/** Human label for a POS payment method, matching how the POS records it. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'qrph':
      return 'QRPH';
    case 'gcash':
      return 'GCash';
    case 'card':
      return 'Card';
    case 'maya':
      return 'Maya';
    case 'bpi':
      return 'BPI';
    case 'bank_transfer':
      return 'Bank';
    default:
      return 'Cash';
  }
}

/** Tailwind classes for a color-coded payment-method badge — a muted tinted
 *  background + readable text per method, so the mix of methods in the
 *  transactions list is scannable at a glance on the dark theme. */
export function paymentMethodBadgeClass(method: string | null | undefined): string {
  // Darker text in light mode, lighter in dark mode — readable on both themes.
  switch (method) {
    case 'cash':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    case 'qrph':
      return 'bg-violet-500/15 text-violet-700 dark:text-violet-300';
    case 'gcash':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
    case 'maya':
      return 'bg-teal-500/15 text-teal-700 dark:text-teal-300';
    case 'card':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'bpi':
      return 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
    case 'bank_transfer':
      return 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
    default: // null/legacy reads as cash
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  }
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
