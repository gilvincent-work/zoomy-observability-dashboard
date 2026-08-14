// Central tooltip copy for the Business Health page — authored together so the
// "basis for each metric" is consistent. Voice: what it is → how computed → caveat.
export const HEALTH_HINTS: Record<string, string> = {
  qrr: 'Quality Revenue Ratio = LTV ÷ CAC, per channel. Healthy at 3 or above. N/A when there is no acquisition cost (e.g. Website with no ads or promos).',
  ltv: 'Lifetime Value = AOV × Repeat × Margin. What an average customer on this channel is worth over their lifetime.',
  cac: 'Customer Acquisition Cost per order = (AOV ÷ ROAS) + (Promos ÷ orders). The ad + promo cost to win one order.',
  aov: 'Average Order Value = channel revenue ÷ channel orders.',
  repeat: 'Repeat factor = orders ÷ distinct buyers over the window. Above 1 means customers buy more than once.',
  roas: 'Return on Ad Spend = ad revenue ÷ ad spend. Website has no ad data, so its ROAS (and marketing cost) is N/A.',
  margin: 'Contribution margin = 1 − COGS% − Platform Fee%. Editable via the fields below.',
  cogs: 'Cost of goods sold — manufacturing + shipping — as a % of revenue. Editable; default 35%.',
  platformFee: 'Marketplace fee as a % of revenue. Editable; default 25% for Shopee & Lazada, 0% for Website.',
  promos: 'Total promo spend (discounts, bundles) for the window, in ₱. Added to CAC as Promos ÷ orders. Editable; default ₱0.',
  acqCost: 'Total acquisition spend for the window, in ₱ — for channels with no ads (Website), this is your organic/ops cost to win customers. Divided by orders to give a per-order CAC. Editable; default ₱0.',
  buyers: 'Distinct buyers over the window (whole-window dedup).',
  orders: 'Orders over the window (confirmed / non-cancelled).',
  window: 'A trailing 6-month window, computed fresh from each channel’s source.',
  ch_shopee: 'Distinct buyers are exact — deduped by the order export’s Username (Buyer). Revenue = order Grand Total. Ads are the real Mar–Jul figures.',
  ch_lazada: 'Distinct buyers are a proxy (~1.3% over) — masked but stable name + address + city. Conservative. Ads pulled from the API for the full window.',
  ch_website: 'Distinct buyers are exact — real CRM customer identity. CRM order history starts 17 Apr 2026 (earlier orders not synced). No ad data (Meta deferred), so ROAS and marketing cost are N/A; CAC comes from promos only.',
};
