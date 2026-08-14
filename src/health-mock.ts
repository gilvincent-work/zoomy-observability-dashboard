import type {BusinessHealthSnapshot} from './health-types';

// Validated facts snapshot (Feb 1 – Jul 31 2026), reproduced by the batch QA run.
// Shopee ads are the real Mar–Jul figures. Used when the archive env is unset.
export const MOCK_HEALTH: BusinessHealthSnapshot = {
  window: {from: '2026-02-01', to: '2026-07-31', label: 'Feb – Jul 2026'},
  target: 3,
  perChannel: [
    {channel: 'shopee', orders: 1206, buyers: 953, revenue: 443273, adSpend: 211062.63, adRevenue: 467447, platformFeeApplies: true, defaults: {cogsPct: 0.35, platformFeePct: 0.25, promos: 0, acqCost: 0}},
    {channel: 'lazada', orders: 259, buyers: 221, revenue: 140489, adSpend: 44570.32, adRevenue: 117720.5, platformFeeApplies: true, defaults: {cogsPct: 0.35, platformFeePct: 0.25, promos: 0, acqCost: 0}},
    {channel: 'website', orders: 40, buyers: 27, revenue: 18417, adSpend: null, adRevenue: null, platformFeeApplies: false, defaults: {cogsPct: 0.35, platformFeePct: 0, promos: 0, acqCost: 0}},
  ],
  computedAt: '2026-08-14T00:00:00.000Z',
};
