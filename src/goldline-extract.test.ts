import {describe, it, expect} from 'vitest';
import {
  buildSystemPrompt,
  buildManifestPrompt,
  EXTRACTION_SCHEMA,
  MANIFESTS,
  COLUMN_KEYS,
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

  it('throws for a page whose manifest is not yet generated', () => {
    expect(() => buildManifestPrompt(2)).toThrow(/manifest/i);
  });

  it('throws for an out-of-range page', () => {
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
