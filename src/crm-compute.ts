/**
 * Pure derivations for the CRM view. Kept free of server/client concerns so the
 * numbers can be unit-tested against the storefront admin's behaviour — the two
 * dashboards read the same API and must not disagree about what "Recovered" or
 * "Platinum" means.
 */
import type {CrmCheckout, CrmCustomer, CrmOrder} from './crm-types';

export type CartStatus = 'Active' | 'Recovered' | 'Converted';

/**
 * A cart's lifecycle state. "Recovered" is deliberately narrower than
 * "Converted": it means the purchase happened AFTER we emailed a reminder, so
 * it is the only one that can be credited to the recovery programme.
 */
export function cartStatus(c: Pick<CrmCheckout, 'convertedAt' | 'remindersSent'>): CartStatus {
  if (c.convertedAt && c.remindersSent > 0) return 'Recovered';
  if (c.convertedAt) return 'Converted';
  return 'Active';
}

/**
 * The start of the current membership spend window: January 1st, or the
 * programme start date when the programme began later in the same year.
 * Lexicographic compare is correct for zero-padded YYYY-MM-DD.
 */
export function membershipWindowStart(now: Date, programStart: string): string {
  const yearStart = `${now.getUTCFullYear()}-01-01`;
  return programStart > yearStart ? programStart : yearStart;
}

export type EnrichedCustomer = CrmCustomer & {
  /** Orders we captured for this customer (all statuses). */
  orderCount: number;
  /** Lifetime paid spend. */
  spent: number;
  /** Paid spend inside the current membership window — what Platinum measures. */
  spendYtd: number;
};

/**
 * Attach per-customer order counts and spend, computed from our own captured
 * orders rather than Shopify's `orders_count` / `total_spent` — those are not
 * populated on customers that entered via an order webhook. Matched on Shopify
 * customer id first, then email; only paid orders count toward spend.
 */
export function enrichCustomers(
  customers: CrmCustomer[],
  orders: CrmOrder[],
  windowStart: string,
): EnrichedCustomer[] {
  const stats = new Map<string, {count: number; spent: number; spentYtd: number}>();
  for (const o of orders) {
    const key = o.shopifyCustomerId || (o.email ?? '').toLowerCase();
    if (!key) continue;
    const s = stats.get(key) ?? {count: 0, spent: 0, spentYtd: 0};
    s.count += 1;
    if (o.financialStatus === 'paid') {
      const amt = Number(o.totalPrice) || 0;
      s.spent += amt;
      if ((o.createdAt ?? '') >= windowStart) s.spentYtd += amt;
    }
    stats.set(key, s);
  }
  return customers.map((c) => {
    const s =
      stats.get(c.shopifyCustomerId) ??
      stats.get((c.email ?? '').toLowerCase()) ??
      {count: 0, spent: 0, spentYtd: 0};
    return {...c, orderCount: s.count, spent: s.spent, spendYtd: s.spentYtd};
  });
}

/**
 * Tier headcount. The tier is whatever the storefront stamped on the customer
 * (`custom.membership_tier`); anyone without one checked out as a guest and has
 * no membership at all — counted separately rather than folded into Gold.
 */
export function tierCounts(customers: CrmCustomer[]): {platinum: number; gold: number; guest: number} {
  return customers.reduce(
    (a, c) => {
      if (c.membershipTier === 'platinum') a.platinum += 1;
      else if (c.membershipTier === 'gold') a.gold += 1;
      else a.guest += 1;
      return a;
    },
    {platinum: 0, gold: 0, guest: 0},
  );
}

/** Order placement → fulfillment, as "2d 4h 30m". Unfulfilled reads as '—'. */
export function turnaround(placed: string | null, fulfilled: string | null): string {
  if (!placed || !fulfilled) return '—';
  const ms = new Date(fulfilled).getTime() - new Date(placed).getTime();
  if (Number.isNaN(ms) || ms < 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 1440)}d ${Math.floor((totalMin % 1440) / 60)}h ${totalMin % 60}m`;
}

/** Case-insensitive "does any of these fields contain the needle". */
export function textMatch(needle: string, fields: Array<string | null | undefined>): boolean {
  if (!needle) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(needle));
}

/**
 * A timestamp in Philippine time — the store, the customers and the team are
 * all in PH, so the zone is pinned rather than taken from the viewer's browser
 * (this matches the storefront admin, and a colleague abroad sees the hour the
 * customer actually saw).
 */
export function fmtPh(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
