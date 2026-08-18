// Per-channel QRR math — mirror of computeChannelHealth in zoomy-observability
// (src/observability/business-health.js). Kept in sync by necessity (cross-repo).
// Pure + client-safe so the dashboard recomputes live as the knobs change.
import type {ChannelFacts, ChannelActuals, Knobs, ChannelHealth, OverallHealth} from './health-types';

/** Placeholder acquisition spend for ad-less channels (Website) so they open
 *  with a CAC instead of N/A. Mirrors DEFAULT_WEBSITE_ACQ_COST in the batch. */
export const DEFAULT_WEBSITE_ACQ_COST = 5000;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const div = (a: number, b: number) => (b ? a / b : 0);

/** The measured actuals for a channel (defaults for the editable fields). */
export function factsToActuals(f: ChannelFacts): ChannelActuals {
  return {
    aov: r2(div(f.revenue, f.orders)),
    orders: f.orders,
    buyers: f.buyers,
    roas: f.adSpend ? r3(div(f.adRevenue ?? 0, f.adSpend)) : null,
  };
}

/** Compute health from editable actuals + assumption knobs (the what-if model). */
export function computeHealth(a: ChannelActuals, k: Knobs): ChannelHealth {
  const aov = r2(a.aov);
  const repeat = r3(div(a.orders, a.buyers));
  const roas = a.roas != null ? r3(a.roas) : null;
  const margin = r3(1 - k.cogsPct - k.platformFeePct);
  // Use the exact orders÷buyers (not the display-rounded `repeat`) so LTV matches
  // the fraction shown on the card.
  const ltv = r2(aov * div(a.orders, a.buyers) * margin);
  const marketingPerOrder = roas ? r2(div(aov, roas)) : r2(div(k.acqCost ?? 0, a.orders));
  const promosPerOrder = r2(div(k.promos, a.orders));
  const cac = r2(marketingPerOrder + promosPerOrder);
  const qrr = cac > 0 ? r3(div(ltv, cac)) : null;
  return {aov, repeat, roas, margin, ltv, marketingPerOrder, promosPerOrder, cac, qrr};
}

/**
 * Portfolio QRR across channels — the business as one blended customer.
 *
 * LTV is a per-BUYER figure and CAC a per-ORDER one, so each side is pooled in
 * its own unit before dividing (pooling profit ÷ cost directly would skew the
 * result by orders÷buyers and can even land outside every channel's QRR):
 *
 *   LTV = Σ (LTV_c × buyers_c) ÷ Σ buyers_c     — buyer-weighted
 *   CAC = Σ (CAC_c × orders_c) ÷ Σ orders_c     — order-weighted
 *   QRR = LTV ÷ CAC
 *
 * Channels with no CAC (Website, until an Acq. cost is entered) are EXCLUDED
 * from both sides: counting their profit against a ₱0 cost would inflate the
 * ratio for free. With a single qualifying channel this reduces exactly to that
 * channel's LTV ÷ CAC, so it stays consistent with the per-channel model.
 */
export function computeOverallHealth(
  channels: {channel: string; actuals: ChannelActuals; knobs: Knobs}[],
): OverallHealth {
  const included: string[] = [];
  const excluded: string[] = [];
  let profit = 0; // Σ LTV × buyers
  let cost = 0; // Σ CAC × orders
  let buyers = 0;
  let orders = 0;
  for (const c of channels) {
    const h = computeHealth(c.actuals, c.knobs);
    if (h.cac > 0) {
      included.push(c.channel);
      profit += h.ltv * c.actuals.buyers;
      cost += h.cac * c.actuals.orders;
      buyers += c.actuals.buyers;
      orders += c.actuals.orders;
    } else {
      excluded.push(c.channel);
    }
  }
  const ltv = r2(div(profit, buyers));
  const cac = r2(div(cost, orders));
  return {
    qrr: cac > 0 ? r3(div(ltv, cac)) : null,
    ltv,
    cac,
    profit: r2(profit),
    cost: r2(cost),
    included,
    excluded,
  };
}

export function computeChannelHealth(f: ChannelFacts, k: Knobs): ChannelHealth {
  const aov = r2(div(f.revenue, f.orders));
  const repeat = r3(div(f.orders, f.buyers));
  const roas = f.adSpend ? r3(div(f.adRevenue ?? 0, f.adSpend)) : null;
  const margin = r3(1 - k.cogsPct - k.platformFeePct);
  const ltv = r2(aov * div(f.orders, f.buyers) * margin);
  // Marketing per order: ad-derived (AOV/ROAS) where there are ads, else the
  // user-supplied acquisition spend per order (Website has no ROAS to derive from).
  const marketingPerOrder = roas ? r2(div(aov, roas)) : r2(div(k.acqCost ?? 0, f.orders));
  const promosPerOrder = r2(div(k.promos, f.orders));
  const cac = r2(marketingPerOrder + promosPerOrder);
  const qrr = cac > 0 ? r3(div(ltv, cac)) : null;
  return {aov, repeat, roas, margin, ltv, marketingPerOrder, promosPerOrder, cac, qrr};
}
