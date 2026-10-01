import {describe, it, expect} from 'vitest';
import {CHAT_TOOLS} from '../src/chat/tool-defs';
import {METRIC_IDS, METRICS} from '../src/chat/metrics-registry';
import {assertRequestShape} from '../src/chat/request-shape';

type Prop = {type?: unknown; enum?: unknown[]; description?: string; [k: string]: unknown};
const [describe_data, query_metric] = CHAT_TOOLS;
const props = (t: (typeof CHAT_TOOLS)[number]) => t.input_schema.properties as Record<string, Prop>;
const sortedUnion = (pick: (id: (typeof METRIC_IDS)[number]) => string[]) => [...new Set(METRIC_IDS.flatMap(pick))].sort();

const SINK = {info: () => undefined, error: () => undefined};

describe('CHAT_TOOLS', () => {
  it('has exactly describe_data then query_metric', () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toEqual(['describe_data', 'query_metric']);
  });

  it('meets the strict-mode limits', () => {
    expect(CHAT_TOOLS.length).toBeLessThanOrEqual(20);
    let total = 0;
    for (const t of CHAT_TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      const keys = Object.keys(t.input_schema.properties);
      expect([...t.input_schema.required].sort()).toEqual([...keys].sort()); // zero optional parameters
      total += keys.length - t.input_schema.required.length;
      for (const p of Object.values(props(t))) {
        expect(typeof p.type).toBe('string'); // no type arrays (unions)
        for (const banned of ['anyOf', 'oneOf', 'allOf', 'minimum', 'maximum', 'pattern', 'format', 'minLength', 'maxLength', 'minItems', 'maxItems'])
          expect(p).not.toHaveProperty(banned);
        for (const v of p.enum ?? []) expect(['string', 'number']).toContain(typeof v);
        for (const v of p.enum ?? []) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
      }
    }
    expect(total).toBeLessThanOrEqual(24);
  });

  it('builds enums from the registry', () => {
    expect(props(describe_data).metric.enum).toEqual(['all', ...METRIC_IDS]);
    const q = props(query_metric);
    expect(q.metric.enum).toEqual([...METRIC_IDS]);
    expect(q.dimension.enum).toEqual(sortedUnion((id) => METRICS[id].dimensions.map((d) => d.key)));
    expect(q.dimension.enum).toContain('none');
    expect(q.measure.enum).toEqual(['default', ...sortedUnion((id) => METRICS[id].measures.map((m) => m.key))]);
    expect(q.measure.enum).toContain('aov');
  });

  it('has the fixed enums and free-text fields', () => {
    const q = props(query_metric);
    expect(q.range.enum).toEqual(['last_week', 'this_week', 'last_month', 'all_available', 'custom']);
    expect(q.channel.enum).toEqual(['offline', 'all']);
    expect(q.pet.enum).toEqual(['all', 'dog', 'cat', 'both', 'untagged']);
    expect(q.compare_to.enum).toEqual(['none', 'previous_period']);
    expect(q.sort.enum).toEqual(['default', 'value_desc', 'value_asc']);
    expect(q.limit).toMatchObject({type: 'integer', enum: [3, 5, 10, 25]});
    expect(q.from.description).toBe('YYYY-MM-DD or "" unless range is custom');
    expect(q.to.description).toBe('YYYY-MM-DD or "" unless range is custom');
    expect(q.event.type).toBe('string');
    expect(q.event.enum).toBeUndefined();
  });

  it('puts the cache breakpoint on the last tool only', () => {
    expect(describe_data.cache_control).toBeUndefined();
    expect(query_metric.cache_control).toEqual({type: 'ephemeral'});
  });

  it('is deep-frozen', () => {
    expect(Object.isFrozen(CHAT_TOOLS)).toBe(true);
    expect(Object.isFrozen(query_metric)).toBe(true);
    expect(Object.isFrozen(query_metric.input_schema)).toBe(true);
    expect(Object.isFrozen(query_metric.input_schema.properties)).toBe(true);
    expect(Object.isFrozen(props(query_metric).range.enum)).toBe(true);
    expect(() => {
      (query_metric as {name: string}).name = 'x';
    }).toThrow();
  });

  it('tells the model when to call each tool', () => {
    expect(describe_data.description).toMatch(/unclear|what you can answer/);
    expect(query_metric.description).toMatch(/ANY figure/);
  });

  it('passes the request-shape check, and a wrong tool list fails it', () => {
    const base = {model: 'm', max_tokens: 10, system: 's', messages: [], tools: CHAT_TOOLS, tool_choice: {type: 'auto'}};
    expect(() => assertRequestShape(base, SINK)).not.toThrow();
    const extra = {...CHAT_TOOLS[0], name: 'run_sql'};
    expect(() => assertRequestShape({...base, tools: [...CHAT_TOOLS, extra]}, SINK)).toThrow(/allowlist/);
  });
});
