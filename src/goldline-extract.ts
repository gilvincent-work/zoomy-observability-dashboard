// Goldline inventory-form extraction (P2) — the template-aware prompt the Claude
// API gets for each scanned page, plus the JSON schema it must return.
//
// Strategy: the six Nichido pages are a FIXED template, so extraction is
// slot-filling against a known per-page manifest, not open reading. That removes
// the row-skips and column-drift a free read produces. This module is PURE (no
// network, no SDK) so it unit-tests; the live call that sends `buildSystemPrompt()`
// + `buildManifestPrompt(page)` + the schema with the PDF lives in the server
// route and is smoke-tested on Staging with ANTHROPIC_API_KEY in the env.

export const EXTRACT_MODEL = 'claude-sonnet-5';

/** The five handwritten count columns on the form, left→right (col6 is derived). */
export const COLUMN_KEYS = ['stockroom', 'drawer', 'selling_area', 'delivery', 'ending_on_hand'] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export type ManifestItem = {code: string; product: string};

// Per-page item manifest, in printed order, generated from the blank templates
// (Nichido/page 1_..PAGE 6). Page 1 is enumerated from the verified scan; pages
// 2–6 are generated the same way from their templates before go-live (tracked;
// an empty manifest makes buildManifestPrompt throw so a page can't be run blind).
export const MANIFESTS: Record<number, ManifestItem[]> = {
  1: [
    {code: 'FBPP01', product: 'Salmon'}, {code: 'FBPP02', product: 'Golden Tan'},
    {code: 'FBPP03', product: 'Almond'}, {code: 'FBPP04', product: 'Sand'},
    {code: 'FBPP05', product: 'Natural'},
    {code: 'FCPP01131', product: 'Natural'}, {code: 'FCPP01132', product: 'Beige'},
    {code: 'FCPP01133', product: 'Light'},
    {code: 'TSP01201', product: 'So Natural'}, {code: 'TSP01202', product: 'Ivory Glow'},
    {code: 'TSP01203', product: 'Pink Glow'}, {code: 'TSP01204', product: 'Creamy Glow'},
    {code: 'BP01205', product: 'Go Bronze'},
    {code: 'PF09111', product: 'Light Natural'}, {code: 'PF09113', product: 'Soft Beige'},
    {code: 'PF09114', product: 'Tender Honey'}, {code: 'PF09115', product: 'Medium Tan'},
    {code: 'TWC01151', product: '#1 Light'}, {code: 'TWC01152', product: '#2 Natural'},
    {code: 'TWC01153', product: '#3 Beige'}, {code: 'TWC01154', product: '#4 Oriental'},
    {code: 'MTW01171', product: 'Matte Natural'}, {code: 'MTW01172', product: 'Matte Ivory'},
    {code: 'MTW01173', product: 'Matte Beige'}, {code: 'MTW01174', product: 'Matte Oriental'},
    {code: 'BC01192', product: 'Summer Tan'}, {code: 'BC01194', product: 'Amber'},
    {code: 'BC01195', product: 'Mocha'}, {code: 'BC01196', product: 'Classic Mint'},
    {code: 'BC01197', product: 'Choco Brown'},
    {code: 'CPFCD', product: 'Cookie Dough'}, {code: 'CPFHO', product: 'Honey Oat'},
    {code: 'CPFB', product: 'Biscuit'},
    {code: 'LQFD091', product: 'Stay Light'}, {code: 'LQFD092', product: 'True Natural'},
    {code: 'BB01L', product: 'BB 01 Light'}, {code: 'BB02S', product: 'BB 02 Skin'},
    {code: 'BB03N', product: 'BB 03 Natural'}, {code: 'BB03B', product: 'BB 03 Beige'},
    {code: '6in1PSLFBU', product: 'Buttermilk'}, {code: '6in1PSLFC', product: 'Cashew'},
    {code: '6in1PSLFBE', product: 'Beige'}, {code: '6in1PSLFBI', product: 'Biscotti'},
  ],
  2: [], 3: [], 4: [], 5: [], 6: [], // TODO: enumerate from the blank templates before go-live
};

export const PAGE_COUNT = 6;

/** The fixed system role + global guardrails (same every call — prompt-cached). */
export function buildSystemPrompt(): string {
  return [
    'You transcribe NICHIDO COSMETICS "Semi-Monthly Inventory" forms.',
    'You receive ONE scanned page as image + text. Transcribe only what is written —',
    'never infer, estimate, average, or fill a blank.',
    '',
    'Rules:',
    '- Emit one object for every item code in the provided manifest, in order. Never add',
    '  a code that is not on the page; never skip one. Use null for an empty count cell.',
    '- Counts are whole numbers. An empty cell is null; only a written "0" is zero.',
    '- A mark belongs to the column it sits under; if it straddles two, pick the nearer,',
    '  lower the confidence, and flag it.',
    '- Do not compute total_value; leave it null (derived downstream as ending × price).',
    '- Ignore pre-printed marks ("(Bestseller)", stars, the printed price) and the dark',
    '  family-header bars; read only handwriting in the count columns.',
    '- If a cell is struck out and rewritten, take the rewrite and flag it.',
    '- Give each value a confidence 0–1. If a digit is unreadable/overwritten, take your',
    '  best reading, set confidence below 0.6, and put the other candidate in "alt".',
    '- Confirm the footer page number matches the manifest page; if it does not, return',
    '  { "error": "page_mismatch" } instead of mapping rows.',
    '- Skip the bottom TOTAL row. If the page is not a Nichido inventory page or is',
    '  unreadable, return { "error": "..." }. Return JSON only.',
  ].join('\n');
}

/** The per-page manifest text (item codes + column meanings). Cached per page. */
export function buildManifestPrompt(page: number): string {
  const items = MANIFESTS[page];
  if (!items || items.length === 0) {
    throw new Error(`No extraction manifest for page ${page} (generate it from the blank template first)`);
  }
  const list = items.map((i) => `${i.code} ${i.product}`).join(' · ');
  return [
    `PAGE ${page} of ${PAGE_COUNT}. Columns, left to right (handwritten int or null):`,
    '  stockroom (col1) · drawer (col2) · selling_area (col3) · delivery (col4) · ending_on_hand (col5)',
    '  total_value (col6) is DERIVED — leave null.',
    'Read the header: store code + name, period (MM/DD–MM/DD), beauty consultant.',
    'Item rows on this page, in printed order — read a value or null for each:',
    `  ${list}`,
  ].join('\n');
}

/** The JSON schema the model must return (header + one object per item). */
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    store_code: {type: 'string'},
    store_name: {type: 'string'},
    period_start: {type: ['string', 'null']},
    period_end: {type: ['string', 'null']},
    consultant: {type: ['string', 'null']},
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item_code: {type: 'string'},
          stockroom: {type: ['integer', 'null']},
          drawer: {type: ['integer', 'null']},
          selling_area: {type: ['integer', 'null']},
          delivery: {type: ['integer', 'null']},
          ending_on_hand: {type: ['integer', 'null']},
          confidence: {type: 'number'},
          alt: {type: ['string', 'null']},
        },
        required: ['item_code', 'ending_on_hand', 'confidence'],
      },
    },
  },
  required: ['store_code', 'rows'],
} as const;
