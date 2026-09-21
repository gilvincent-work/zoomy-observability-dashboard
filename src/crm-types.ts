/**
 * Shapes returned by the Zoomy CRM Worker's read API (/api/*). Only the fields
 * the dashboard renders are modelled — the endpoints also return a `raw` blob
 * of the original Shopify payload, which is heavy and full of PII we have no
 * use for here, so it is dropped at the boundary in crm-data.ts.
 */

export type CrmMetrics = {
  customers: number;
  orders: number;
  totalRevenue: number;
  ordersLast7Days: number;
  revenueLast7Days: number;
  abandonedActive: number;
  recovered: number;
  reminded: number;
  revenueRecovered: number;
  recoveryRate: number;
};

export type CrmCustomer = {
  shopifyCustomerId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  ordersCount: number | null;
  totalSpent: string | null;
  membershipTier: string | null;
  petName: string | null;
  petBirthday: string | null;
  emailMarketingState: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CrmOrder = {
  shopifyOrderId: string;
  shopifyCustomerId: string | null;
  orderNumber: string | null;
  email: string | null;
  totalPrice: string | null;
  currency: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  createdAt: string | null;
  fulfilledAt: string | null;
  reviewRequestSentAt: string | null;
  reviewSubmittedAt: string | null;
};

export type CrmCheckout = {
  shopifyCheckoutId: string;
  email: string | null;
  abandonedCheckoutUrl: string | null;
  totalPrice: string | null;
  currency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  convertedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
  reachedPaymentAt: string | null;
  /** When the one-off RETURN30 win-back went out (null = never sent). */
  winbackSentAt: string | null;
};

export type CrmBirthdayVoucher = {
  id: number;
  email: string;
  year: number;
  tier: string;
  code: string;
  amount: string;
  expiresAt: string | null;
  sentAt: string;
};

/** Membership settings, straight from the Shopify metafield the admin edits. */
export type CrmMembershipConfig = {
  platinumThreshold: number;
  programStart: string;
};
