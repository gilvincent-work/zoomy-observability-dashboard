// EXP-03: the block component shows the Exploratory chip and a collapsed "Show SQL" disclosure for Explore blocks, and neither for registry blocks.
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

// The vitest config has no '@' alias (the page tests mock '@/...' ids the same way).
vi.mock('@/lib/utils', () => ({cn: (...a: unknown[]) => a.filter((x) => typeof x === 'string').join(' ')}));
import {ChatBlocks} from '../components/analyst/chat-blocks';
import type {TableBlock} from '../src/chat/block-types';

const table = (extra: Partial<TableBlock> = {}): TableBlock => ({
  id: 'u1', source: 'x1', title: 'Revenue by pet', reliable: true, caveats: ['Exploratory, not a registered metric.'], basis: 'Exploratory query', kind: 'table',
  columns: [{key: 'pet', label: 'Pet', unit: 'text', role: 'category'}, {key: 'revenue_php', label: 'Revenue', unit: 'PHP', role: 'measure'}],
  rows: [{pet: 'dog', revenue_php: 3800.5}], total: null, ...extra,
});

describe('EXP-03 the Exploratory chip and SQL disclosure', () => {
  it('EXP-03 an Explore block shows the chip and a collapsed Show SQL with the SQL as text', () => {
    const sql = "select o.pet_type as pet from coop_explore_orders o where o.remarks = '<script>alert(1)</script>'";
    const html = renderToStaticMarkup(<ChatBlocks blocks={[table({exploratory: true, sql})]} />);
    expect(html).toContain('Exploratory, not a registered metric');
    expect(html).toContain('Show SQL');
    expect(html).toMatch(/<details/);
    expect(html).not.toMatch(/<details[^>]*\sopen/); // collapsed
    expect(html).toContain('&lt;script&gt;'); // escaped, never HTML
    expect(html).not.toContain('<script>');
  });
  it('EXP-03 a registry block shows neither', () => {
    const html = renderToStaticMarkup(<ChatBlocks blocks={[table({caveats: [], basis: 'Sep 1 to Sep 30'})]} />);
    expect(html).not.toContain('Show SQL');
    expect(html).not.toContain('Exploratory, not a registered metric');
  });
});
