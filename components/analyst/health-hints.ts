// Central tooltip copy for the Business Health page — authored together so the
// "basis for each metric" is consistent. Voice: what it is → how computed → caveat.
export const HEALTH_HINTS: Record<string, string> = {
  qrr: 'Quality Revenue Ratio = customer lifetime value ÷ acquisition cost. Our north-star; healthy at 3 or above. Equals Repeat × Margin × ROAS.',
  ltv: 'Lifetime Value = Blended AOV × Repeat factor × Margin. What an average customer is worth to us over their lifetime.',
  cac: 'Customer Acquisition Cost = Blended AOV ÷ Blended ROAS. Roughly the ad spend to win one order. Paid channels only (Shopee + Lazada).',
  repeatFactor: 'Repeat factor = total orders ÷ distinct buyers over 6 months. Above 1 means customers buy more than once. A key lever on QRR.',
  margin: 'Contribution margin kept after costs. Fixed at 0.40 for now; will later be computed from real COGS + shipping.',
  blendedRoas: 'Blended ROAS = ad revenue ÷ ad spend across paid channels (Shopee + Lazada). A key lever on QRR.',
  blendedAov: 'Blended AOV = total revenue ÷ total orders across all channels. Note: it cancels out of QRR (it is in both LTV and CAC).',
  buyers: 'Distinct buyers over 6 months, counted once per channel and summed. No cross-channel dedup (a person on two channels counts twice).',
  orders: 'Total orders across all channels over the 6-month window (confirmed / non-cancelled).',
  window: 'All figures are a trailing 6-month window, computed fresh from each channel’s source.',
  ch_shopee: 'Shopee distinct buyers are exact — deduped by the order export’s Username (Buyer). Revenue = order Grand Total.',
  ch_lazada: 'Lazada distinct buyers are a proxy (~1.3% over) — masked but stable first-name + address + city. Conservative (never over-optimistic).',
  ch_website: 'Website distinct buyers are exact — real CRM customer identity. No ad data (Meta deferred), so it’s excluded from CAC.',
};
