import {describe, expect, it} from 'vitest';
import {HIDDEN, scrubRows, scrubValue} from '../src/chat/explore/scrub';

const jwt = 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12);
const skKey = 'sk-' + 'x9'.repeat(12);
const hex = 'f'.repeat(32);

describe('2.2 value scanner: secret-shaped values never reach the model (Review Focus 5)', () => {
  it('hides JWTs, API keys, PEM blocks and long hex inside text, keeping the rest', () => {
    expect(scrubValue(`token ${jwt} end`)).toEqual({value: `token ${HIDDEN} end`, hidden: 1});
    expect(scrubValue(skKey).value).toBe(HIDDEN);
    expect(scrubValue('sk_live_' + 'A1'.repeat(8)).value).toBe(HIDDEN);
    expect(scrubValue('pk_live_' + 'B2'.repeat(8)).value).toBe(HIDDEN);
    expect(scrubValue('pk_test_' + 'C3'.repeat(8)).value).toBe(HIDDEN);
    expect(scrubValue('sb_secret_' + 'q'.repeat(20)).value).toBe(HIDDEN);
    expect(scrubValue('-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----').value).toBe(HIDDEN);
    expect(scrubValue('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----').value).toBe(HIDDEN);
    expect(scrubValue('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn').value).toBe(HIDDEN); // truncated block: hidden to the end
    expect(scrubValue('-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----').value).toBe(HIDDEN); // any PEM block
    expect(scrubValue(`fixture-token-${hex}`).value).toBe(`fixture-token-${HIDDEN}`);
    expect(scrubValue('fixture-token-4a8a08f09d37b73795649038408b5f33').value).toBe(`fixture-token-${HIDDEN}`); // the fixture's md5
    expect(scrubValue('a1B2'.repeat(11)).value).toBe(HIDDEN); // 44 mixed letters and digits, no separator
  });
  it('hides any JSON value under a secret-named key, at any depth', () => {
    expect(scrubValue({lazada: {access_token: 'abc', shop: 'Zoomy'}, price: 129.5})).toEqual({value: {lazada: {access_token: HIDDEN, shop: 'Zoomy'}, price: 129.5}, hidden: 1});
    expect(scrubValue([{api_key: 'x'}, {pinned: true}]).value).toEqual([{api_key: HIDDEN}, {pinned: true}]);
    expect(scrubValue({refresh_token: null, password: ''})).toEqual({value: {refresh_token: null, password: ''}, hidden: 0}); // nothing to hide
  });
  it('leaves ordinary values alone: prices, dates, uuids, names, short ids, urls without tokens', () => {
    for (const v of [129.5, 0, null, true, '2026-09-28', '2026-09-28T04:00:00+08:00', '3f2b9c1e-8d7a-4b6e-9f0a-1c2d3e4f5a6b', 'Dog treats 100g', 'P1', 'https://zoomy.ph/products/jerky', 'GCash', 'SM Aura bazaar 2026']) {
      expect(scrubValue(v), String(v)).toEqual({value: v, hidden: 0});
    }
  });
  it('no false-positive explosion: uuids, order numbers and long digit strings are never hidden', () => {
    const keep = [
      '3F2B9C1E-8D7A-4B6E-9F0A-1C2D3E4F5A6B', // upper-case uuid
      'lead 3f2b9c1e-8d7a-4b6e-9f0a-1c2d3e4f5a6b, 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', // two uuids in text
      '250928ABCD1234', // Shopee order sn
      '1234567890123456', // Lazada order number (16 digits)
      '12345678901234567890123456789012345678901234567890', // 50 digits: no letter, not a token
      '09171234567', // a PH mobile number
      'ZMY-2026-000123', // a POS reference
      'gid://shopify/Product/8123456789012',
      'SPEPH0123456789A', // a tracking number
      'pos_inventory_by_location_snapshot_2026_09_28', // long snake_case identifier
      'the-quick-brown-fox-jumps-over-the-lazy-dog-again-and-again',
      'Order 1234567890, total 1290.00, paid by GCash', // digits inside text
    ];
    for (const v of keep) expect(scrubValue(v), v).toEqual({value: v, hidden: 0});
    const rows = Array.from({length: 200}, (_, i) => [i, `3f2b9c1e-8d7a-4b6e-9f0a-${String(i).padStart(12, '0')}`, `2509${String(i).padStart(10, '0')}`, 'completed']);
    expect(scrubRows(rows).hidden).toBe(0);
  });
  it('scrubs whole result rows and counts what it hid', () => {
    expect(scrubRows([[1, jwt, 'ok'], [2, 'fine', {secret: 's'}]])).toEqual({rows: [[1, HIDDEN, 'ok'], [2, 'fine', {secret: HIDDEN}]], hidden: 2});
  });
});

describe('2.2 the result says what the scanner hid; base-table reads keep the Train 1 notes', () => {
  const limits = {maxRows: 200, maxCols: 12, maxBytes: 65536, timeoutMs: 5000, maxSqlChars: 2000, maxCallsPerQuestion: 5, maxPerUserDay: 100, modelRows: 50, maxRelations: 8, maxDepth: 20};
  const shape = async (relations: string[], hidden?: number) => {
    const {shapeResult} = await import('../src/chat/explore/result');
    const raw = {columns: [{name: 'pet', type: 'text' as const}, {name: 'leads_count', type: 'number' as const}], rows: [['dog', 3]], fetched: 1, ms: 1, ...(hidden === undefined ? {} : {hidden})};
    const r = shapeResult({raw, validated: {sql: 'select 1', relations, lints: [], columnRefs: []}, limits, id: 'x1'});
    if (!r.ok) throw new Error(r.code);
    return r.result.meta.caveats;
  };
  it('the count is a result check (values_hidden, warn), so the UI and the model see it as data', async () => {
    const {shapeResult} = await import('../src/chat/explore/result');
    const raw = {columns: [{name: 'note', type: 'text' as const}], rows: [['[hidden]']], fetched: 1, ms: 1, hidden: 2};
    const r = shapeResult({raw, validated: {sql: 'select 1', relations: ['pos_orders'], lints: [], columnRefs: []}, limits, id: 'x1'});
    expect(r.ok && r.result.meta.checks).toEqual([{code: 'values_hidden', status: 'warn', text: '2 values looked like a secret (key, token or hash) and were hidden.', values: {hidden: 2}}]);
    const none = shapeResult({raw: {...raw, hidden: 0}, validated: {sql: 'select 1', relations: ['pos_orders'], lints: [], columnRefs: []}, limits, id: 'x1'});
    expect(none.ok && none.result.meta.checks).toEqual([]);
  });
  it('a caveat counts the hidden values (singular and plural); none when nothing was hidden', async () => {
    expect(await shape(['pos_orders'], 1)).toContain('1 value looked like a secret (key, token or hash) and was hidden.');
    expect(await shape(['pos_orders'], 3)).toContain('3 values looked like a secret (key, token or hash) and were hidden.');
    expect((await shape(['pos_orders'], 0)).join(' ')).not.toMatch(/hidden/);
  });
  it('the leads note follows the base table spin_wheel_leads, not only the coop_explore_event_leads alias', async () => {
    expect(await shape(['spin_wheel_leads'])).toContain('Leads are booth sign-ups, not buyers.');
    expect(await shape(['coop_explore_event_leads'])).toContain('Leads are booth sign-ups, not buyers.');
  });
});
