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
export interface BusinessHealthSnapshot {
  window: {from: string; to: string; label: string};
  target: number;
  perChannel: ChannelFacts[];
  monthly?: MonthlyPoint[];
  computedAt: string;
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
