import {describe, it, expect} from 'vitest';
import {
  buildSystemPrompt,
  buildManifestPrompt,
  buildPageDetectPrompt,
  EXTRACTION_SCHEMA,
  PAGE_DETECT_SCHEMA,
  MANIFESTS,
  INVENTORY_PAGES,
  COLUMN_KEYS,
  humanizeExtractError,
} from './goldline-extract';

describe('buildSystemPrompt', () => {
  const p = buildSystemPrompt();
  it('states the core guardrails', () => {
    expect(p).toContain('never infer');
    expect(p).toContain('null for an empty count cell');
    expect(p).toContain('Do not compute total_value');
    expect(p).toContain('page_mismatch');
    expect(p).toContain('confidence');
    expect(p).toContain('Return JSON only');
  });
});

describe('buildManifestPrompt', () => {
  it('lists page-1 item codes in order with the column meanings', () => {
    const m = buildManifestPrompt(1);
    expect(m).toContain('PAGE 1 of 6');
    expect(m).toContain('FBPP01 Salmon');
    expect(m).toContain('BB03N BB 03 Natural');
    expect(m).toContain('ending_on_hand (col5)');
  });

  it('builds a manifest for every inventory page (1–5)', () => {
    for (const p of [1, 2, 3, 4, 5]) {
      const m = buildManifestPrompt(p);
      expect(m).toContain(`PAGE ${p} of 6`);
    }
  });

  it('throws for page 6 (the sales report — no item manifest) and out-of-range pages', () => {
    expect(() => buildManifestPrompt(6)).toThrow(/manifest/i);
    expect(() => buildManifestPrompt(99)).toThrow();
  });
});

describe('EXTRACTION_SCHEMA', () => {
  it('requires per-row item_code, ending_on_hand, and confidence', () => {
    const row = EXTRACTION_SCHEMA.properties.rows.items;
    expect(row.required).toEqual(['item_code', 'ending_on_hand', 'confidence']);
    for (const k of COLUMN_KEYS) {
      expect(Object.keys(row.properties)).toContain(k);
    }
  });

  it('page-1 manifest covers all 43 coded rows (Final Powder has no item code)', () => {
    expect(MANIFESTS[1].length).toBe(43);
  });
});

describe('manifests pages 1–5', () => {
  it('has a non-empty manifest for every inventory page and none for page 6', () => {
    for (const p of INVENTORY_PAGES) expect(MANIFESTS[p]?.length ?? 0).toBeGreaterThan(0);
    expect(MANIFESTS[6]).toBeUndefined();
  });

  it('every item code is unique within its page', () => {
    for (const p of INVENTORY_PAGES) {
      const codes = MANIFESTS[p].map((i) => i.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('no blank codes or products', () => {
    for (const p of INVENTORY_PAGES) {
      for (const item of MANIFESTS[p]) {
        expect(item.code.trim().length).toBeGreaterThan(0);
        expect(item.product.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('page detection', () => {
  it('prompt asks for the footer page and the schema bounds 0–6', () => {
    expect(buildPageDetectPrompt()).toMatch(/PAGE # N|page/i);
    expect(PAGE_DETECT_SCHEMA.properties.page.minimum).toBe(0);
    expect(PAGE_DETECT_SCHEMA.properties.page.maximum).toBe(6);
  });
});

describe('humanizeExtractError', () => {
  it('explains the page 2–6 manifest gap without jargon', () => {
    const m = humanizeExtractError(new Error('No extraction manifest for page 2 (generate it from the blank template first)'));
    expect(m).toMatch(/page 1/i);
    expect(m).not.toMatch(/manifest/i);
  });
  it('maps page_mismatch, unreadable JSON, and busy/rate cases', () => {
    expect(humanizeExtractError(new Error('Extraction declined: page_mismatch'))).toMatch(/page 1/i);
    expect(humanizeExtractError(new Error('Extraction did not return valid JSON'))).toMatch(/clearer/i);
    expect(humanizeExtractError(new Error('Overloaded'))).toMatch(/busy/i);
  });
  it('never leaks a raw 400 / JSON blob — falls back to a safe generic', () => {
    const raw = '400 {"type":"error","error":{"type":"invalid_request_error","message":"..."}}';
    const m = humanizeExtractError(new Error(raw));
    expect(m).not.toContain('invalid_request_error');
    expect(m).not.toContain('{');
    expect(m).toMatch(/couldn.t process/i);
  });
});
