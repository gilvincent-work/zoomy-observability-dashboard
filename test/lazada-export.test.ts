import {describe, it, expect} from 'vitest';
import {
  normalizePhone,
  pickName,
  pickCity,
  parseLazadaDate,
  isExcludedStatus,
  isMasked,
  rowsToOrderItems,
  itemsToCustomers,
  summarize,
  classifySupabaseError,
  summarizeExclusions,
  buildUploadSummary,
  parseAmount,
  cleanVariation,
  payMethodLabel,
  productRanking,
  productDisplayName,
  dataFreshness,
} from '../src/lazada-export';

describe('normalizePhone', () => {
  it('normalizes the 13-digit country-code-plus-trunk-zero form', () => {
    // The shape 601 of 604 rows in the real export use: 63 + 09XXXXXXXXX.
    expect(normalizePhone('6309171234567')).toBe('+639171234567');
  });

  it('normalizes the 12-digit E.164-without-plus form', () => {
    expect(normalizePhone('639171234567')).toBe('+639171234567');
  });

  it('normalizes bare local and 9-prefixed forms', () => {
    expect(normalizePhone('09171234567')).toBe('+639171234567');
    expect(normalizePhone('9171234567')).toBe('+639171234567');
  });

  it('tolerates punctuation and a leading plus', () => {
    expect(normalizePhone('+63 917 123-4567')).toBe('+639171234567');
  });

  it('rejects anything that is not a PH mobile number', () => {
    for (const bad of ['', null, undefined, 'n/a', '12345', '0281234567', '630917123456789']) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});

describe('pickName', () => {
  it('prefers the recipient over the account holder', () => {
    expect(pickName({shippingName: 'Ana Cruz', billingName: 'B', customerName: 'C'})).toBe('Ana Cruz');
  });

  it('falls through masked and empty values', () => {
    expect(pickName({shippingName: '', billingName: 'a**b', customerName: 'Real Name'})).toBe('Real Name');
    expect(pickName({shippingName: '********123'})).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(pickName({})).toBeNull();
  });
});

describe('pickCity', () => {
  it('prefers billing city and falls back to shipping', () => {
    expect(pickCity({billingCity: 'Quezon City', shippingCity: 'Makati'})).toBe('Quezon City');
    expect(pickCity({billingCity: '', shippingCity: 'Makati'})).toBe('Makati');
    expect(pickCity({})).toBeNull();
  });
});

describe('parseLazadaDate', () => {
  it('parses the export format as Manila time', () => {
    // 14:35 +08:00 is 06:35 UTC — deterministic regardless of host timezone.
    expect(parseLazadaDate('30 Jul 2026 14:35')).toBe('2026-07-30T06:35:00.000Z');
  });

  it('parses a date with no time component', () => {
    expect(parseLazadaDate('01 Feb 2026')).toBe('2026-01-31T16:00:00.000Z');
  });

  it('accepts a Date instance from a date-typed cell', () => {
    expect(parseLazadaDate(new Date('2026-07-30T06:35:00Z'))).toBe('2026-07-30T06:35:00.000Z');
  });

  it('returns null on unparseable input', () => {
    for (const bad of ['', null, 'yesterday', '30 Xyz 2026 14:35', new Date('nope')]) {
      expect(parseLazadaDate(bad)).toBeNull();
    }
  });
});

describe('isExcludedStatus / isMasked', () => {
  it('excludes canceled, returned and scrapped orders, case-insensitively', () => {
    for (const s of ['canceled', 'Canceled', 'returned', 'Package Returned', 'package scrapped']) {
      expect(isExcludedStatus(s)).toBe(true);
    }
  });

  it('keeps confirmed and delivered orders', () => {
    expect(isExcludedStatus('confirmed')).toBe(false);
    expect(isExcludedStatus('delivered')).toBe(false);
  });

  it('detects redacted values', () => {
    expect(isMasked('a**b')).toBe(true);
    expect(isMasked('Ana Cruz')).toBe(false);
  });
});

const row = (over = {}) => ({
  orderItemId: '1',
  orderNumber: '100',
  createTime: '30 Jul 2026 14:35',
  status: 'confirmed',
  shippingName: 'Ana Cruz',
  billingCity: 'Quezon City',
  billingPhone: '6309171234567',
  itemName: 'Zoomy! Meaty Treats',
  variation: 'Type:Beef Liver',
  paidPrice: '184.00',
  shippingFee: '45.00',
  payMethod: 'GCASH_PP',
  ...over,
});

describe('rowsToOrderItems', () => {
  it('maps a usable row to a storable record', () => {
    const {items, skipped} = rowsToOrderItems([row()]);
    expect(items).toEqual([
      {
        order_item_id: '1',
        order_number: '100',
        ordered_at: '2026-07-30T06:35:00.000Z',
        status: 'confirmed',
        customer_name: 'Ana Cruz',
        city: 'Quezon City',
        phone: '+639171234567',
        item_name: 'Zoomy! Meaty Treats',
        variation: 'Beef Liver',
        paid_price: 184,
        shipping_fee: 45,
        pay_method: 'GCash',
      },
    ]);
    expect(skipped).toEqual({status: 0, phone: 0, date: 0, id: 0});
  });

  it('drops unusable rows and counts why', () => {
    const {items, skipped} = rowsToOrderItems([
      row({orderItemId: '', }),
      row({orderItemId: '2', status: 'canceled'}),
      row({orderItemId: '3', billingPhone: 'n/a'}),
      row({orderItemId: '4', createTime: 'sometime'}),
      row({orderItemId: '5'}),
    ]);
    expect(items.map((i) => i.order_item_id)).toEqual(['5']);
    expect(skipped).toEqual({status: 1, phone: 1, date: 1, id: 1});
  });

  it('de-duplicates repeated order items within one file', () => {
    const {items} = rowsToOrderItems([row(), row()]);
    expect(items).toHaveLength(1);
  });
});

describe('itemsToCustomers', () => {
  const NOW = Date.parse('2026-08-24T00:00:00Z');
  const item = (over: Record<string, unknown>) => ({
    order_item_id: 'x',
    order_number: 'o1',
    ordered_at: '2026-08-01T00:00:00.000Z',
    status: 'confirmed',
    customer_name: 'Ana Cruz',
    city: 'Quezon City',
    phone: '+639171234567',
    item_name: 'Meaty Treats',
    variation: 'Beef Liver',
    paid_price: 100,
    pay_method: 'GCash',
    ...over,
  });

  it('collapses items to one row per phone and counts DISTINCT orders', () => {
    const out = itemsToCustomers(
      [
        item({order_item_id: 'a', order_number: 'o1'}),
        item({order_item_id: 'b', order_number: 'o1'}), // same order, 2nd item
        item({order_item_id: 'c', order_number: 'o2'}),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].orderCount).toBe(2);
  });

  it('takes name, city and product from the most recent order', () => {
    const out = itemsToCustomers(
      [
        item({order_item_id: 'a', order_number: 'o1', ordered_at: '2026-05-01T00:00:00.000Z', customer_name: 'Old Name', city: 'Cebu', item_name: 'Munchies'}),
        item({order_item_id: 'b', order_number: 'o2', ordered_at: '2026-08-14T00:00:00.000Z', customer_name: 'New Name', city: 'Makati', item_name: 'Beef Slices'}),
      ],
      NOW,
    );
    expect(out[0]).toMatchObject({
      name: 'New Name',
      city: 'Makati',
      lastProduct: 'Beef Slices',
      lastOrderAt: '2026-08-14T00:00:00.000Z',
      firstOrderAt: '2026-05-01T00:00:00.000Z',
      daysSince: 10,
    });
  });

  it('sorts the most overdue customer first', () => {
    const out = itemsToCustomers(
      [
        item({order_item_id: 'a', phone: '+639170000001', ordered_at: '2026-08-20T00:00:00.000Z'}),
        item({order_item_id: 'b', phone: '+639170000002', ordered_at: '2026-02-01T00:00:00.000Z'}),
      ],
      NOW,
    );
    expect(out.map((c) => c.phone)).toEqual(['+639170000002', '+639170000001']);
  });
});

describe('summarize', () => {
  it('reports zeros for an empty list', () => {
    expect(summarize([])).toEqual({
      customers: 0, orders: 0, repeatCustomers: 0, cities: 0, revenue: 0,
      oldestOrderAt: null, newestOrderAt: null,
    });
  });

  it('aggregates customers, orders, repeats, cities, revenue and the date span', () => {
    const out = summarize([
      {phone: 'a', city: 'Makati', orderCount: 3, totalSpent: 1500.5, firstOrderAt: '2026-02-01T00:00:00.000Z', lastOrderAt: '2026-07-01T00:00:00.000Z'},
      {phone: 'b', city: 'makati', orderCount: 1, totalSpent: 184, firstOrderAt: '2026-03-01T00:00:00.000Z', lastOrderAt: '2026-08-01T00:00:00.000Z'},
      {phone: 'c', city: null, orderCount: 1, firstOrderAt: '2026-01-15T00:00:00.000Z', lastOrderAt: '2026-01-15T00:00:00.000Z'},
    ]);
    expect(out).toEqual({
      customers: 3,
      orders: 5,
      repeatCustomers: 1,
      cities: 1, // case-insensitive
      revenue: 1684.5, // the customer with no money data contributes 0, not NaN
      oldestOrderAt: '2026-01-15T00:00:00.000Z',
      newestOrderAt: '2026-08-01T00:00:00.000Z',
    });
  });
});

describe('classifySupabaseError', () => {
  it('recognizes PostgREST\'s missing-table response', () => {
    // The shape the client actually throws: `supabase GET lazada_orders 404 {...}`.
    const err = new Error(
      'supabase GET lazada_orders?select=order_item_id 404 {"code":"PGRST205","message":"Could not find the table \'public.lazada_orders\' in the schema cache"}',
    );
    expect(classifySupabaseError(err).kind).toBe('missing-table');
  });

  it('recognizes a raw postgres undefined-relation message', () => {
    expect(classifySupabaseError(new Error('relation "lazada_orders" does not exist')).kind)
      .toBe('missing-table');
  });

  it('treats auth, permission and transport failures as unknown', () => {
    for (const message of [
      'supabase GET lazada_orders 401 {"message":"Invalid API key"}',
      'supabase POST lazada_orders 403 {"code":"42501","message":"permission denied"}',
      'supabase GET lazada_orders 500 {}',
      'fetch failed',
    ]) {
      expect(classifySupabaseError(new Error(message)).kind).toBe('unknown');
    }
  });

  it('always returns a message, even for a non-Error throw', () => {
    expect(classifySupabaseError('boom')).toEqual({kind: 'unknown', message: 'boom'});
    expect(classifySupabaseError(null).message).toBe('Unknown error');
  });
});

describe('summarizeExclusions', () => {
  const r = (phone: string, status: string) => ({billingPhone: phone, status});

  it('counts a buyer whose only order was canceled', () => {
    const out = summarizeExclusions([r('6309171234567', 'canceled')]);
    expect(out).toEqual({excludedItems: 1, excludedBuyers: 1});
  });

  it('does not count a buyer who also has a kept order', () => {
    // The canceled item is still excluded, but the buyer stays in the list.
    const out = summarizeExclusions([
      r('6309171234567', 'canceled'),
      r('6309171234567', 'delivered'),
    ]);
    expect(out).toEqual({excludedItems: 1, excludedBuyers: 0});
  });

  it('matches the real export shape: 604 rows, 20 excluded items, 13 lost buyers', () => {
    const rows = [];
    // 13 buyers whose only order was returned -> they disappear entirely.
    for (let i = 0; i < 13; i++) rows.push(r(`63091700000${String(i).padStart(2, '0')}`, 'Package Returned'));
    // 7 more excluded items belonging to buyers who also ordered successfully.
    for (let i = 0; i < 7; i++) {
      const phone = `63091711111${String(i).padStart(2, '0')}`;
      rows.push(r(phone, 'canceled'));
      rows.push(r(phone, 'delivered'));
    }
    expect(summarizeExclusions(rows)).toEqual({excludedItems: 20, excludedBuyers: 13});
  });

  it('ignores rows whose phone number is unusable', () => {
    expect(summarizeExclusions([r('n/a', 'canceled'), r('', 'delivered')]))
      .toEqual({excludedItems: 0, excludedBuyers: 0});
  });
});

describe('buildUploadSummary', () => {
  const items = [
    {phone: '+639171234567', order_item_id: 'a'},
    {phone: '+639171234567', order_item_id: 'b'}, // same buyer, second item
    {phone: '+639170000002', order_item_id: 'c'},
  ];

  it('recomputes buyers and items from the payload rather than trusting the client', () => {
    const out = buildUploadSummary(items, {total: 604, buyers: 9999, skipped: {}}, 'export.xlsx');
    expect(out.items_saved).toBe(3);
    expect(out.buyers).toBe(2); // not 9999
    expect(out.rows_read).toBe(604);
    expect(out.file_name).toBe('export.xlsx');
  });

  it('carries the parse-time figures that cannot be recomputed server-side', () => {
    const out = buildUploadSummary(items, {
      total: 604,
      skipped: {status: 20, phone: 1, date: 2, id: 3},
      exclusions: {excludedBuyers: 13},
    });
    expect(out).toMatchObject({
      skipped_status: 20, skipped_phone: 1, skipped_date: 2, skipped_id: 3, excluded_buyers: 13,
    });
  });

  it('coerces junk, negative and missing stats to zero', () => {
    const out = buildUploadSummary([], {total: -5, skipped: {status: 'lots'}, exclusions: null});
    expect(out).toMatchObject({
      rows_read: 0, items_saved: 0, buyers: 0, skipped_status: 0, excluded_buyers: 0, file_name: null,
    });
  });

  it('stores no personally identifying fields', () => {
    const out = buildUploadSummary(items, {total: 3});
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('639171234567');
    expect(Object.keys(out).sort()).toEqual([
      'buyers', 'excluded_buyers', 'file_name', 'items_saved', 'rows_read',
      'skipped_date', 'skipped_id', 'skipped_phone', 'skipped_status',
    ]);
  });
});

describe('parseAmount', () => {
  it('parses the string amounts the export actually ships', () => {
    expect(parseAmount('184.00')).toBe(184);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('-11.56')).toBe(-11.56); // seller discounts arrive negative
    expect(parseAmount(245.82)).toBe(245.82);
  });

  it('returns null for absent or unparseable values', () => {
    for (const bad of ['', null, undefined, 'n/a', '-', '.']) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe('cleanVariation', () => {
  it('strips the attribute name, keeping only the value', () => {
    expect(cleanVariation('Type:Chicken Breast')).toBe('Chicken Breast');
    expect(cleanVariation('Pet Food Flavors & Ingredients:Chicken')).toBe('Chicken');
    expect(cleanVariation('Flavor:B1T1 Salmon Cubes')).toBe('B1T1 Salmon Cubes');
  });

  it('passes through a bare value and nulls the empties', () => {
    expect(cleanVariation('Chicken')).toBe('Chicken');
    expect(cleanVariation('Type:')).toBeNull();
    expect(cleanVariation('')).toBeNull();
  });
});

describe('payMethodLabel', () => {
  it('maps the codes seen in the real export', () => {
    expect(payMethodLabel('GCASH_PP')).toBe('GCash');
    expect(payMethodLabel('MIXEDCARD')).toBe('Card');
    expect(payMethodLabel('COD')).toBe('COD');
    expect(payMethodLabel('WALLET_PAYMAYA2C2P')).toBe('Maya');
  });

  it('title-cases an unknown code rather than dropping it', () => {
    expect(payMethodLabel('SOME_NEW_METHOD')).toBe('Some New Method');
    expect(payMethodLabel('')).toBeNull();
  });
});

describe('productRanking', () => {
  const it_ = (over: Record<string, unknown>) => ({
    order_number: 'o1', phone: '+639170000001',
    item_name: 'Freeze Dried Munchies', variation: 'Chicken Breast', paid_price: 100, ...over,
  });

  it('ranks by distinct orders, counting a multi-item order once', () => {
    const out = productRanking([
      it_({order_number: 'o1'}),
      it_({order_number: 'o1'}), // same order, second bag
      it_({order_number: 'o2', variation: 'Duck Breast'}),
      it_({order_number: 'o3', variation: 'Duck Breast'}),
    ]);
    expect(out.map((r) => [r.variant, r.orders, r.items])).toEqual([
      ['Duck Breast', 2, 2],
      ['Chicken Breast', 1, 2],
    ]);
  });

  it('separates flavours of the same product and sums revenue', () => {
    const out = productRanking([
      it_({variation: 'Chicken Breast', paid_price: 184}),
      it_({order_number: 'o2', variation: 'Beef Liver', paid_price: 132.97}),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.variant === 'Beef Liver')?.revenue).toBe(132.97);
  });

  it('counts distinct buyers per variant', () => {
    const out = productRanking([
      it_({phone: '+639170000001'}),
      it_({phone: '+639170000002', order_number: 'o2'}),
      it_({phone: '+639170000002', order_number: 'o3'}),
    ]);
    expect(out[0].buyers).toBe(2);
    expect(out[0].orders).toBe(3);
  });

  it('labels a missing product rather than dropping the row', () => {
    expect(productRanking([it_({item_name: null, variation: null})])[0])
      .toMatchObject({product: 'Unknown product', variant: null});
  });
});

describe('productDisplayName', () => {
  it('cuts the SEO filler after the first pipe', () => {
    expect(productDisplayName('Zoomy! Freeze Dried Superfood Munchies | Beef Blueberry Chicken Cranberry | Pet Treats'))
      .toBe('Zoomy! Freeze Dried Superfood Munchies');
    expect(productDisplayName('Zoomy! 10-in-1 Multivitamin Dog Treats Snack Chicken Beef Duck | Probiotics Omega-3'))
      .toBe('Zoomy! 10-in-1 Multivitamin Dog Treats Snack Chicken Beef Duck');
  });

  it('leaves a title with no pipe untouched', () => {
    expect(productDisplayName('BUY 1 TAKE 1 Zoomy! Meaty Treats')).toBe('BUY 1 TAKE 1 Zoomy! Meaty Treats');
  });

  it('falls back to the full title rather than emptying out', () => {
    expect(productDisplayName('| Training Treats Pet Treats')).toBe('| Training Treats Pet Treats');
    expect(productDisplayName('')).toBe('');
    expect(productDisplayName(null)).toBe('');
  });
});

describe('dataFreshness', () => {
  const NOW = Date.parse('2026-08-25T00:00:00Z');

  it('reports the age of the newest order in the data', () => {
    // The real export's window closed Jul 30 — 26 days before this "now".
    expect(dataFreshness('2026-07-30T06:35:00.000Z', NOW)).toEqual({ageDays: 25, tone: 'aging'});
  });

  it('treats a fortnight as still fresh', () => {
    expect(dataFreshness('2026-08-20T00:00:00.000Z', NOW)?.tone).toBe('fresh');
    expect(dataFreshness('2026-08-11T00:00:00.000Z', NOW)).toEqual({ageDays: 14, tone: 'fresh'});
  });

  it('flags data older than the reorder cycle as stale', () => {
    expect(dataFreshness('2026-07-21T00:00:00.000Z', NOW)).toEqual({ageDays: 35, tone: 'stale'});
  });

  it('returns null when there is no data', () => {
    expect(dataFreshness(null, NOW)).toBeNull();
    expect(dataFreshness('not a date', NOW)).toBeNull();
  });
});
