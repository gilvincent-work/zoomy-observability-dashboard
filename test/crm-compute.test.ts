import {describe, it, expect} from 'vitest';
import {
  cartStatus,
  checkoutStage,
  enrichCustomers,
  filterActive,
  filterCarts,
  filterCustomers,
  filterOrders,
  fmtPh,
  membershipWindowStart,
  textMatch,
  tierCounts,
  turnaround,
  EMPTY_CART_FILTER,
  EMPTY_CUSTOMER_FILTER,
  EMPTY_ORDER_FILTER,
} from '../src/crm-compute';
import type {CrmCheckout, CrmCustomer, CrmOrder} from '../src/crm-types';

const customer = (over: Partial<CrmCustomer> = {}): CrmCustomer => ({
  shopifyCustomerId: '1', email: 'a@x.com', firstName: null, lastName: null, phone: null,
  ordersCount: null, totalSpent: null, membershipTier: null, petName: null, petBirthday: null,
  emailMarketingState: null, createdAt: null, updatedAt: null, ...over,
});
const order = (over: Partial<CrmOrder> = {}): CrmOrder => ({
  shopifyOrderId: 'o1', shopifyCustomerId: '1', orderNumber: '#1001', email: 'a@x.com',
  totalPrice: '500', currency: 'PHP', financialStatus: 'paid', fulfillmentStatus: null,
  createdAt: '2026-08-01T00:00:00Z', fulfilledAt: null, reviewRequestSentAt: null,
  reviewSubmittedAt: null, ...over,
});

describe('cartStatus', () => {
  // Only a purchase that came AFTER a reminder can be credited to recovery.
  it('separates recovered from self-converted', () => {
    expect(cartStatus({convertedAt: '2026-09-01', remindersSent: 2})).toBe('Recovered');
    expect(cartStatus({convertedAt: '2026-09-01', remindersSent: 0})).toBe('Converted');
    expect(cartStatus({convertedAt: null, remindersSent: 3})).toBe('Active');
  });
});

describe('membershipWindowStart', () => {
  it('is January 1st once the programme predates the year', () => {
    expect(membershipWindowStart(new Date('2027-03-04T00:00:00Z'), '2026-07-01')).toBe('2027-01-01');
  });

  it('is the programme start during its first year', () => {
    expect(membershipWindowStart(new Date('2026-09-21T00:00:00Z'), '2026-07-01')).toBe('2026-07-01');
  });
});

describe('enrichCustomers', () => {
  it('counts orders and paid spend, matching on id then email', () => {
    const [byId, byEmail] = enrichCustomers(
      [customer(), customer({shopifyCustomerId: '2', email: 'B@x.com'})],
      [
        order(),
        order({shopifyOrderId: 'o2', totalPrice: '300', financialStatus: 'pending'}),
        order({shopifyOrderId: 'o3', shopifyCustomerId: null, email: 'b@x.com', totalPrice: '900'}),
      ],
      '2026-07-01',
    );
    // Two orders captured, but only the paid one counts toward spend.
    expect(byId).toMatchObject({orderCount: 2, spent: 500, spendYtd: 500});
    expect(byEmail).toMatchObject({orderCount: 1, spent: 900});
  });

  it('excludes spend from before the membership window', () => {
    const [c] = enrichCustomers([customer()], [order({createdAt: '2026-02-01T00:00:00Z'})], '2026-07-01');
    expect(c).toMatchObject({spent: 500, spendYtd: 0});
  });

  it('leaves a customer with no orders at zero rather than undefined', () => {
    const [c] = enrichCustomers([customer({shopifyCustomerId: '99', email: null})], [], '2026-07-01');
    expect(c).toMatchObject({orderCount: 0, spent: 0, spendYtd: 0});
  });
});

describe('tierCounts', () => {
  // Guests checked out without an account, so they have no membership at all —
  // folding them into Gold would overstate the programme's reach.
  it('counts guests apart from Gold', () => {
    expect(
      tierCounts([
        customer({membershipTier: 'platinum'}),
        customer({membershipTier: 'gold'}),
        customer({membershipTier: null}),
        customer({membershipTier: ''}),
      ]),
    ).toEqual({platinum: 1, gold: 1, guest: 2});
  });
});

describe('turnaround', () => {
  it('formats placed → fulfilled', () => {
    expect(turnaround('2026-09-01T00:00:00Z', '2026-09-03T04:30:00Z')).toBe('2d 4h 30m');
  });

  it('is em dash when unfulfilled or inverted', () => {
    expect(turnaround('2026-09-01T00:00:00Z', null)).toBe('—');
    expect(turnaround('2026-09-03T00:00:00Z', '2026-09-01T00:00:00Z')).toBe('—');
  });
});

describe('fmtPh', () => {
  it('renders in Manila time whatever the server zone', () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      expect(fmtPh('2026-09-20T13:32:30Z')).toBe('Sep 20, 2026, 9:32 PM');
      process.env.TZ = 'America/New_York';
      expect(fmtPh('2026-09-20T13:32:30Z')).toBe('Sep 20, 2026, 9:32 PM');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('is em dash for missing or junk input', () => {
    expect(fmtPh(null)).toBe('—');
    expect(fmtPh('not a date')).toBe('—');
  });
});

describe('textMatch', () => {
  it('matches any field, case-insensitively, and passes everything when empty', () => {
    expect(textMatch('gmail', ['A@GMAIL.com', null])).toBe(true);
    expect(textMatch('zzz', ['a@x.com'])).toBe(false);
    expect(textMatch('', ['anything'])).toBe(true);
  });
});

/* ---------- filters ---------- */

const checkout = (over: Partial<CrmCheckout> = {}): CrmCheckout => ({
  shopifyCheckoutId: 'ck1', email: 'a@x.com', abandonedCheckoutUrl: null, totalPrice: '500',
  currency: 'PHP', createdAt: '2026-09-01T00:00:00Z', updatedAt: null, convertedAt: null,
  remindersSent: 0, lastReminderAt: null, reachedPaymentAt: null, winbackSentAt: null,
  stage: 'Email', ...over,
});

describe('checkoutStage', () => {
  // Shipping is the furthest Shopify exposes; payment engagement lives in its
  // secure iframe, so 'Payment' only comes from what the CRM recorded.
  it('reads the furthest step reached', () => {
    expect(checkoutStage({reachedPaymentAt: '2026-09-01'}, {})).toBe('Payment');
    expect(checkoutStage({email: 'a@x.com'}, {shipping_address: {city: 'Manila'}})).toBe('Shipping');
    expect(checkoutStage({email: null}, {shipping_lines: [{title: 'Std'}]})).toBe('Shipping');
    expect(checkoutStage({email: 'a@x.com'}, {})).toBe('Email');
    expect(checkoutStage({email: null}, {})).toBe('Started');
  });

  it('treats a missing or junk payload as no progress', () => {
    expect(checkoutStage({email: null}, null)).toBe('Started');
    expect(checkoutStage({email: null}, 'not an object')).toBe('Started');
  });
});

describe('filterCarts', () => {
  const rows = [
    checkout({shopifyCheckoutId: 'a', stage: 'Payment', remindersSent: 2, convertedAt: '2026-09-02'}),
    checkout({shopifyCheckoutId: 'b', stage: 'Email', email: 'other@y.com'}),
    checkout({shopifyCheckoutId: 'c', stage: 'Shipping', winbackSentAt: '2026-09-17'}),
  ];

  it('narrows by stage, status and win-back, and combines with the search', () => {
    expect(filterCarts(rows, {...EMPTY_CART_FILTER, stage: 'Payment'}, '').map((r) => r.shopifyCheckoutId)).toEqual(['a']);
    expect(filterCarts(rows, {...EMPTY_CART_FILTER, status: 'Recovered'}, '').map((r) => r.shopifyCheckoutId)).toEqual(['a']);
    expect(filterCarts(rows, {...EMPTY_CART_FILTER, winback: 'sent'}, '').map((r) => r.shopifyCheckoutId)).toEqual(['c']);
    expect(filterCarts(rows, {...EMPTY_CART_FILTER, winback: 'not-sent'}, 'other')).toHaveLength(1);
  });

  it('passes everything through when nothing is set', () => {
    expect(filterCarts(rows, EMPTY_CART_FILTER, '')).toHaveLength(3);
  });
});

describe('filterOrders', () => {
  const rows = [
    order({shopifyOrderId: 'a', financialStatus: 'paid', fulfilledAt: '2026-09-02', reviewSubmittedAt: '2026-09-05'}),
    order({shopifyOrderId: 'b', financialStatus: 'pending'}),
    order({shopifyOrderId: 'c', financialStatus: 'PAID'}),
  ];

  it('matches payment status case-insensitively', () => {
    expect(filterOrders(rows, {...EMPTY_ORDER_FILTER, payment: 'paid'}, '').map((r) => r.shopifyOrderId)).toEqual(['a', 'c']);
  });

  it('splits fulfilled and reviewed by presence of the timestamp', () => {
    expect(filterOrders(rows, {...EMPTY_ORDER_FILTER, fulfillment: 'unfulfilled'}, '')).toHaveLength(2);
    expect(filterOrders(rows, {...EMPTY_ORDER_FILTER, reviewed: 'reviewed'}, '').map((r) => r.shopifyOrderId)).toEqual(['a']);
    expect(filterOrders(rows, {...EMPTY_ORDER_FILTER, reviewed: 'pending'}, '')).toHaveLength(2);
  });
});

describe('filterCustomers', () => {
  const rows = enrichCustomers(
    [
      customer({shopifyCustomerId: '1', membershipTier: 'gold'}),
      customer({shopifyCustomerId: '2', email: 'g@x.com', membershipTier: null}),
    ],
    [order({shopifyCustomerId: '1'})],
    '2026-07-01',
  );

  it('treats a missing tier as guest', () => {
    expect(filterCustomers(rows, {...EMPTY_CUSTOMER_FILTER, tier: 'guest'}, '').map((r) => r.shopifyCustomerId)).toEqual(['2']);
    expect(filterCustomers(rows, {...EMPTY_CUSTOMER_FILTER, tier: 'gold'}, '').map((r) => r.shopifyCustomerId)).toEqual(['1']);
  });

  it('splits buyers from browsers', () => {
    expect(filterCustomers(rows, {...EMPTY_CUSTOMER_FILTER, buyers: 'buyers'}, '')).toHaveLength(1);
    expect(filterCustomers(rows, {...EMPTY_CUSTOMER_FILTER, buyers: 'none'}, '').map((r) => r.shopifyCustomerId)).toEqual(['2']);
  });
});

describe('filterActive', () => {
  it('is false only when every field is "all"', () => {
    expect(filterActive(EMPTY_CART_FILTER)).toBe(false);
    expect(filterActive({...EMPTY_CART_FILTER, stage: 'Payment'})).toBe(true);
  });
});
