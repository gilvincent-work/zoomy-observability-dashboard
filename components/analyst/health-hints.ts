// Central tooltip copy for the Business Health page. Each tooltip appears on a
// specific channel card, so copy stays per-channel and plain-language — no
// cross-channel references that would confuse (e.g. no Website notes on Shopee).
export const HEALTH_HINTS: Record<string, string> = {
  // Headline metrics
  qrr: 'Quality Revenue Ratio = Contribution ÷ CAC, both per order. How many pesos of gross margin each ₱1 of acquisition spend returns on an order. With promos at ₱0 it equals Margin × ROAS. Healthy at 3 or above. Shows N/A when there’s no acquisition cost to divide by.',
  overallQrr:
    'Overall QRR — the whole business pooled by volume, using your current assumptions: total gross margin (Σ contribution × orders) ÷ total marketing + promo spend (Σ CAC × orders). Every order counts once, so it lands near the highest-volume channel and always sits between the channel QRRs. Channels with no acquisition cost sit out entirely — counting their profit against ₱0 would inflate the ratio for free. Give such a channel an Acq. cost and it joins automatically.',
  contribution: 'Gross margin on a single order = AOV × Margin. This is the numerator of QRR. Repeat rate is deliberately excluded: CAC is a per-order cost, so multiplying by orders ÷ buyers here would double-count repeat purchases and inflate the ratio.',
  cac: 'Customer Acquisition Cost per order — what it costs to win one order. CAC = marketing cost per order + promo cost per order.',

  // Derived facts (measured from data)
  aov: 'Average Order Value for this channel = revenue ÷ orders.',
  repeat: 'Orders ÷ distinct buyers for this channel. Above 1 means the average customer buys more than once. Tracked as its own KPI and NOT part of QRR — folding it into the numerator against a per-order CAC would double-count it.',
  roas: 'Return on Ad Spend = ad revenue ÷ ad spend. Higher means each ₱1 of ads brings in more sales.',
  margin: 'The share of revenue left after costs: Margin = 1 − COGS% − Platform Fee%. Set COGS% and Platform Fee% in the fields here.',

  // Editable assumptions
  cogs: 'Cost of Goods Sold — what it costs to make and ship the product — as a % of revenue. Editable (default 35%).',
  platformFee: 'The marketplace’s commission and fees, as a % of revenue. Editable (default 25%). The Website has no marketplace fee, so it stays 0.',
  promos: 'Total spent on discounts and bundles this period, in ₱. It’s spread across orders and added to CAC. Editable (default ₱0).',
  perOrder: 'CAC is a cost per order, not a lump sum — so the total ₱ is divided by the number of orders. That puts it on the same per-order footing as the contribution above it, which is what makes the ratio a fair comparison.',
  acqCost: 'Total spent acquiring customers this period, in ₱ — e.g. organic, content, or ops cost. Used for the Website (which has no ads). Spread across orders to form its CAC. Editable — seeded at ₱5,000 for the Website as a placeholder, not a measured figure, so replace it with real spend.',

  // Volume facts
  buyers: 'Distinct customers who placed an order on this channel during the period (each counted once).',
  orders: 'Number of orders on this channel during the period (cancelled orders excluded).',
  window: 'All figures cover this trailing period, pulled fresh from each channel’s own source.',

  // Per-channel methodology (shown on the channel name)
  ch_shopee: 'Buyers are exact — deduped by the order export’s buyer username. Revenue is the order Grand Total. Ad figures are the real Mar–Jul data.',
  ch_lazada: 'Buyers are an estimate, ~1.3% high (a stable name + address + city match) — deliberately conservative. Ad figures come from the Lazada API for the full period.',
  ch_website: 'Buyers are exact (real customer IDs). There’s no ad data, so ROAS is N/A and CAC comes from the Acq. cost — seeded at ₱5,000 as a placeholder, so treat this channel’s QRR as provisional until you enter real spend. CRM order history starts 17 Apr 2026, so volume here is lower.',
};
