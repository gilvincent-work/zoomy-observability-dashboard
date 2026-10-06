import {describe, it, expect} from 'vitest';
import {buildDegradedPreamble, buildPreamble, buildStaticCatalog} from '../src/chat/preamble';
import {METRICS, METRIC_IDS} from '../src/chat/metrics-registry';
import type {MetricData} from '../src/chat/result-types';
import type {PosOrder} from '../src/pos-sales-types';

function ord(id: string, at: string, pet: PosOrder['pet_type'] = null): PosOrder {
  return {
    id, client_uuid: id, subtotal: 1234, discount: null, total: 1234, oversold: false, device_id: null, payment_method: 'cash',
    customer_handle: null, status: 'completed', remarks: null, created_at: at, edited_at: null, event_id: null, pet_type: pet, items: [],
  };
}
const data = (over: Partial<MetricData> = {}): MetricData => ({
  source: 'live',
  orders: [ord('a', '2026-09-11T10:00:00+08:00', 'dog'), ord('b', '2026-09-20T10:00:00+08:00'), ord('c', '2026-09-27T10:00:00+08:00', 'cat')],
  events: [], prices: [], priceChanges: [], bulkReads: [], ...over,
});

describe('buildPreamble', () => {
  const now = new Date('2026-10-01T04:00:00Z');

  it('states weekday, date, coverage and the unavailable list', () => {
    const p = buildPreamble(data(), now);
    expect(p).toContain('Thursday, 1 October 2026');
    expect(p).toContain('live and covers 11 Sep 2026 to 27 Sep 2026 (3 completed orders; 33% have no pet tag)');
    expect(p).toMatch(/Traffic.*Meta ads.*Shopee/);
    expect(p).toMatch(/outside this range/);
  });

  it('does not forbid pet and event questions as "customer-level data"', () => {
    const p = buildPreamble(data(), now);
    expect(p).not.toMatch(/customer-level/i);
    expect(p).toMatch(/Contact details \(email, phone, instagram\) are not exposed/);
    expect(p).toMatch(/Pet type and event ARE available/);
    expect(p).toMatch(/free-form query tool is planned, not available yet/);
    expect(buildDegradedPreamble(now)).not.toMatch(/customer-level/i);
  });

  it('is deterministic', () => {
    expect(buildPreamble(data(), now)).toBe(buildPreamble(data(), now));
  });

  it('uses PHT, not the machine timezone, at the day edge', () => {
    expect(buildPreamble(data(), new Date('2026-09-30T17:00:00Z'))).toContain('Thursday, 1 October 2026');
    expect(buildPreamble(data(), new Date('2026-09-30T15:00:00Z'))).toContain('Wednesday, 30 September 2026');
  });

  it('has a mock and an empty variant', () => {
    expect(buildPreamble(data({source: 'mock'}), now)).toMatch(/sample data/);
    const empty = buildPreamble(data({orders: []}), now);
    expect(empty).toMatch(/no order data yet/);
    expect(empty).not.toMatch(/NaN|null|undefined/);
  });

  it('stays short and has no money or other percentages', () => {
    const p = buildPreamble(data(), now);
    expect(p.length).toBeLessThan(600);
    expect(p).not.toMatch(/₱|PHP|\$/);
    expect(p.match(/\d+%/g)).toEqual(['33%']);
  });
});

describe('buildStaticCatalog', () => {
  const cat = buildStaticCatalog();

  it('is static across calls', () => {
    expect(buildStaticCatalog()).toBe(cat);
  });

  it('mentions every metric id, measure key and method', () => {
    for (const id of METRIC_IDS) {
      expect(cat).toContain(id);
      for (const m of METRICS[id].measures) {
        expect(cat).toContain(`measure ${m.key} `);
        expect(cat).toContain(m.method);
      }
    }
  });

  it('stays under the token cap and has no dates or counts', () => {
    expect(cat.length / 3.5).toBeLessThan(1500);
    expect(cat).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it('contains the tool rules', () => {
    expect(cat).toMatch(/every tool parameter is required/);
    expect(cat).toMatch(/"none", "all" or "default"/);
    expect(cat).toMatch(/custom/);
    expect(cat).toMatch(/must come from a tool result/);
  });
});

describe('buildDegradedPreamble', () => {
  it('gives today in Philippine time and says live POS data is unavailable, with no figures', () => {
    const text = buildDegradedPreamble(new Date('2026-09-30T17:00:00Z')); // 1 Oct 01:00 PHT
    expect(text).toContain('Thursday, 1 October 2026');
    expect(text).toContain('2026-10-01');
    expect(text).toMatch(/Live offline POS data is not available right now/);
    expect(text).not.toMatch(/\d+%|₱|\d+ completed orders/);
    expect(buildDegradedPreamble(new Date('2026-09-30T17:00:00Z'))).toBe(text);
  });
});
