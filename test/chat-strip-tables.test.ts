// Live test 5 (G01, H2): the model typed a markdown table of the same rows the app had already drawn as chart + table twin.
import {describe, expect, it} from 'vitest';
import {stripMarkdownTables} from '../src/chat/strip-tables';

const TABLE = '| pet | orders_count |\n|---|---:|\n| dog | 14 |\n| cat | 3 |';

describe('stripMarkdownTables', () => {
  it('prose + table + prose becomes prose + prose, with no leftover blank run', () => {
    expect(stripMarkdownTables(`Dogs lead.\n\n${TABLE}\n\nBasis: completed orders.`)).toBe('Dogs lead.\n\nBasis: completed orders.');
  });
  it('handles a table at the start or end, tables without outer pipes, and alignment colons', () => {
    expect(stripMarkdownTables(`${TABLE}\n\nAfter.`)).toBe('After.');
    expect(stripMarkdownTables(`Before.\n\n${TABLE}`)).toBe('Before.');
    expect(stripMarkdownTables('Before.\n\npet | n\n:-- | --:\ndog | 14\n\nAfter.')).toBe('Before.\n\nAfter.');
  });
  it('removes every table of the text', () => {
    expect(stripMarkdownTables(`A.\n\n${TABLE}\n\nB.\n\n${TABLE}\n\nC.`)).toBe('A.\n\nB.\n\nC.');
  });
  it('keeps a table inside a code fence', () => {
    const fenced = `Look:\n\n\`\`\`\n${TABLE}\n\`\`\`\n\nDone.`;
    expect(stripMarkdownTables(fenced)).toBe(fenced);
    const tilde = `~~~md\n${TABLE}\n~~~`;
    expect(stripMarkdownTables(tilde)).toBe(tilde);
  });
  it('keeps prose with a pipe, a lone separator-looking line, and text with no table', () => {
    const t = 'Use a | b for choice.\n\n---\n\nPlain.';
    expect(stripMarkdownTables(t)).toBe(t);
  });
});
