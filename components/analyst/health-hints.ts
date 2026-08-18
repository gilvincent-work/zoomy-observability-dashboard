// Central tooltip copy for the Business Health page. Each tooltip appears on a
// specific channel card, so copy stays per-channel and plain-language — no
// cross-channel references that would confuse (e.g. no Website notes on Shopee).
export const HEALTH_HINTS: Record<string, string> = {
  // Headline metrics
  qrr: 'Quality Revenue Ratio = LTV ÷ CAC. Roughly, how many pesos of lifetime value each ₱1 spent to acquire a customer returns. Healthy at 3 or above. Shows N/A when there’s no acquisition cost to divide by.',
  overallQrr:
    'Overall QRR — the business as one blended customer, using your current assumptions. LTV is buyer-weighted (Σ LTV × buyers ÷ Σ buyers) and CAC order-weighted (Σ CAC × orders ÷ Σ orders), each pooled in its own unit, then divided. It always lands between the channel QRRs. Channels with no acquisition cost sit out entirely — counting their profit against ₱0 would inflate the ratio for free. Give such a channel an Acq. cost and it joins automatically.',
  ltv: 'Lifetime Value — what this channel’s average customer is worth over time. LTV = AOV × (orders ÷ buyers) × Margin.',
  cac: 'Customer Acquisition Cost per order — what it costs to win one order. CAC = marketing cost per order + promo cost per order.',

  // Derived facts (measured from data)
  aov: 'Average Order Value for this channel = revenue ÷ orders.',
  repeat: 'Orders ÷ distinct buyers for this channel. Above 1 means the average customer buys more than once.',
  roas: 'Return on Ad Spend = ad revenue ÷ ad spend. Higher means each ₱1 of ads brings in more sales.',
  margin: 'The share of revenue left after costs: Margin = 1 − COGS% − Platform Fee%. Set COGS% and Platform Fee% in the fields here.',

  // Editable assumptions
  cogs: 'Cost of Goods Sold — what it costs to make and ship the product — as a % of revenue. Editable (default 35%).',
  platformFee: 'The marketplace’s commission and fees, as a % of revenue. Editable (default 25%). The Website has no marketplace fee, so it stays 0.',
  promos: 'Total spent on discounts and bundles this period, in ₱. It’s spread across orders and added to CAC. Editable (default ₱0).',
  perOrder: 'CAC is a cost per order, not a lump sum — so the total ₱ is divided by the number of orders. That puts it on the same per-order footing as the marketing cost, so LTV (per customer) ÷ CAC (per order) is a fair ratio.',
  acqCost: 'Total spent acquiring customers this period, in ₱ — e.g. organic, content, or ops cost. Used for the Website (which has no ads). Spread across orders to form its CAC. Editable (default ₱0).',

  // Volume facts
  buyers: 'Distinct customers who placed an order on this channel during the period (each counted once).',
  orders: 'Number of orders on this channel during the period (cancelled orders excluded).',
  window: 'All figures cover this trailing period, pulled fresh from each channel’s own source.',

  // Per-channel methodology (shown on the channel name)
  ch_shopee: 'Buyers are exact — deduped by the order export’s buyer username. Revenue is the order Grand Total. Ad figures are the real Mar–Jul data.',
  ch_lazada: 'Buyers are an estimate, ~1.3% high (a stable name + address + city match) — deliberately conservative. Ad figures come from the Lazada API for the full period.',
  ch_website: 'Buyers are exact (real customer IDs). There’s no ad data, so ROAS is N/A — enter an Acq. cost to give CAC a value. CRM order history starts 17 Apr 2026, so volume here is lower.',
};
