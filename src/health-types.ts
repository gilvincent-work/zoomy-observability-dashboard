// Mirror of BusinessHealthSnapshot produced by zoomy-observability
// (src/observability/business-health.js). Read-only in the dashboard.
export interface HealthChannel {
  channel: 'shopee' | 'lazada' | 'website';
  orders: number;
  buyers: number;
  revenue: number;
  adSpend: number | null;
  adRevenue: number | null;
  roas: number | null;
  buyerMethod: string;
}
export interface BusinessHealthSnapshot {
  window: {from: string; to: string; label: string};
  margin: number;
  target: number;
  qrr: number;
  ltv: number;
  cac: number;
  blendedAov: number;
  repeatFactor: number;
  blendedRoas: number;
  totals: {orders: number; buyers: number; revenue: number};
  ads: {spend: number; revenue: number};
  perChannel: HealthChannel[];
  computedAt: string;
}
