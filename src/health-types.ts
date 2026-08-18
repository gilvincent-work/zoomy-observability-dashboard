// Mirror of the facts snapshot produced by zoomy-observability
// (src/observability/business-health.js). The dashboard computes LTV/CAC/QRR from
// these facts + editable knobs (see health-compute.ts).
export interface Knobs {
  cogsPct: number; // fraction, e.g. 0.35
  platformFeePct: number; // fraction; 0 for Website
  promos: number; // total ₱ for the window
  acqCost: number; // total ₱ acquisition spend — used when a channel has no ROAS (Website)
}
export interface ChannelFacts {
  channel: 'shopee' | 'lazada' | 'website';
  orders: number;
  buyers: number;
  revenue: number;
  adSpend: number | null;
  adRevenue: number | null;
  platformFeeApplies: boolean;
  defaults: Knobs;
}
export interface MonthlyChannel {
  channel: 'shopee' | 'lazada' | 'website';
  orders: number;
  buyers: number;
  revenue: number;
  adSpend: number | null;
  adRevenue: number | null;
}
export interface MonthlyPoint {
  month: string; // YYYY-MM
  label: string; // e.g. "Feb"
  perChannel: MonthlyChannel[];
}
export interface CohortRow {
  cohort: string; // YYYY-MM (month of first purchase)
  size: number; // buyers in the cohort
  retention: number[]; // retention[k] = share active in month cohort+k (M0 = 1)
}
export interface CohortMatrix {
  months: string[]; // YYYY-MM window
  rows: CohortRow[];
}
export interface BusinessHealthSnapshot {
  window: {from: string; to: string; label: string};
  target: number;
  perChannel: ChannelFacts[];
  monthly?: MonthlyPoint[];
  cohorts?: Record<'shopee' | 'lazada' | 'website', CohortMatrix>;
  buyerMix?: Record<'shopee' | 'lazada' | 'website', Array<{month: string; newBuyers: number; returning: number}>>;
  computedAt: string;
}
// The measured values a user can override to model a target scenario.
export interface ChannelActuals {
  aov: number;
  orders: number;
  buyers: number;
  roas: number | null; // null = no ads (Website)
}
export interface ChannelHealth {
  aov: number;
  repeat: number;
  roas: number | null;
  margin: number;
  ltv: number;
  marketingPerOrder: number;
  promosPerOrder: number;
  cac: number;
  qrr: number | null; // null = N/A (no acquisition cost)
}
/** Portfolio QRR across the channels that have a CAC (see computeOverallHealth). */
export interface OverallHealth {
  qrr: number | null; // null = N/A (no channel has an acquisition cost)
  ltv: number; // buyer-weighted LTV across included channels
  cac: number; // order-weighted CAC across included channels
  profit: number; // Σ LTV × buyers over included channels
  cost: number; // Σ CAC × orders over included channels
  included: string[];
  excluded: string[]; // channels sat out for having no CAC
}
