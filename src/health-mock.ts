import type {BusinessHealthSnapshot} from './health-types';

// Validated baseline (Feb 1 – Jul 31 2026), reproduced by the batch QA run.
// Used when the archive env is unset so /health renders without Supabase.
export const MOCK_HEALTH: BusinessHealthSnapshot = {
  window: {from: '2026-02-01', to: '2026-07-31', label: 'Feb – Jul 2026'},
  margin: 0.4,
  target: 3,
  qrr: 1.287,
  ltv: 200.54,
  cac: 155.81,
  blendedAov: 400.12,
  repeatFactor: 1.253,
  blendedRoas: 2.568,
  totals: {orders: 1505, buyers: 1201, revenue: 602179},
  ads: {spend: 324458.92, revenue: 833316.5},
  perChannel: [
    {channel: 'shopee', orders: 1206, buyers: 953, revenue: 443273, adSpend: 279888.6, adRevenue: 715596, roas: 2.557, buyerMethod: 'exact (order-export username)'},
    {channel: 'lazada', orders: 259, buyers: 221, revenue: 140489, adSpend: 44570.32, adRevenue: 117720.5, roas: 2.641, buyerMethod: 'proxy (~1.3% over — masked composite)'},
    {channel: 'website', orders: 40, buyers: 27, revenue: 18417, adSpend: null, adRevenue: null, roas: null, buyerMethod: 'exact (CRM customer identity)'},
  ],
  computedAt: '2026-08-13T00:00:00.000Z',
};
