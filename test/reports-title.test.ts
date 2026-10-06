import {describe, expect, it} from 'vitest';
import {fallbackTitle} from '../src/reports-title';

describe('fallbackTitle: Saving never fails for a blank title (owner report: "Give the report a title.")', () => {
  const view = (v: Record<string, unknown>) => ({id: 'b1', kind: 'chart', view: v});
  it('uses the first block title, then a tile label', () => {
    expect(fallbackTitle({blocks: [view({title: 'SKUs in dog bundles'}), view({title: 'Other'})]}, 'q')).toBe('SKUs in dog bundles');
    expect(fallbackTitle({blocks: [view({title: ''}), view({label: 'Bundle revenue'})]}, 'q')).toBe('Bundle revenue');
  });
  it('else the question that produced it: first sentence, plain text, at most 80 characters', () => {
    expect(fallbackTitle({blocks: [view({title: ''})]}, 'Make me a dashboard of dog and cat SKUs. Also a chart.')).toBe('Make me a dashboard of dog and cat SKUs');
    expect(fallbackTitle({blocks: []}, `<b>${'x'.repeat(200)}</b>`).length).toBeLessThanOrEqual(80);
  });
  it('else "Untitled report"', () => {
    expect(fallbackTitle(null, undefined)).toBe('Untitled report');
    expect(fallbackTitle({blocks: [view({})]}, '   ')).toBe('Untitled report');
  });
});
