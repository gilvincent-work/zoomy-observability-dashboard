import {describe, expect, it} from 'vitest';
import {TOOL_ALLOWLIST, isAllowedTool} from '../src/chat/tools';

describe('tool allowlist', () => {
  it('has exactly the fourteen read-only tools (eleven plus run_query, list_tables and describe_table, which are only SENT to Explore users)', () => {
    expect([...TOOL_ALLOWLIST]).toEqual([
      'describe_data', 'query_metric', 'render_chart', 'render_table', 'render_kpi',
      'set_report_filters', 'remove_block', 'set_report_title', 'get_digest', 'get_channel_report', 'lookup_product', 'run_query',
      'list_tables', 'describe_table',
    ]);
  });

  it('is frozen: mutation attempts throw (strict mode) and change nothing', () => {
    const list = TOOL_ALLOWLIST as unknown as string[];
    expect(Object.isFrozen(TOOL_ALLOWLIST)).toBe(true);
    expect(() => list.push('update_price')).toThrow();
    expect(() => { list[0] = 'update_price'; }).toThrow();
    expect(() => list.pop()).toThrow();
    expect(TOOL_ALLOWLIST).toHaveLength(14);
    expect(isAllowedTool('update_price')).toBe(false);
  });

  it('accepts every listed name', () => {
    for (const n of TOOL_ALLOWLIST) expect(isAllowedTool(n)).toBe(true);
  });

  it.each(['update_price', 'void_order', 'save_report', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', ' query_metric', 'QUERY_METRIC'])(
    'refuses %j',
    (name) => expect(isAllowedTool(name)).toBe(false),
  );

  it.each([undefined, null, 0, 1, true, {}, [], ['query_metric'], {toString: () => 'query_metric'}, Symbol('x')])('refuses non-string %s', (v) => {
    expect(isAllowedTool(v)).toBe(false);
  });
});
