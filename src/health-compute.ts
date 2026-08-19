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
  // Gross margin on one order. Repeat rate is reported separately, never folded
  // in here — both sides of the ratio stay per-order.
  const contribution = r2(aov * margin);
  const marketingPerOrder = roas ? r2(div(aov, roas)) : r2(div(k.acqCost ?? 0, a.orders));
  const promosPerOrder = r2(div(k.promos, a.orders));
  const cac = r2(marketingPerOrder + promosPerOrder);
  const qrr = cac > 0 ? r3(div(contribution, cac)) : null;
  return {aov, repeat, roas, margin, contribution, marketingPerOrder, promosPerOrder, cac, qrr};
}

/**
 * The company number — volume-weighted pooling. Every order counts once:
 *
 *   QRR = Σ (contribution_c × orders_c) ÷ Σ (CAC_c × orders_c)
 *       = total gross margin ÷ total (marketing + promo) spend
 *
 * Both sides are per-order, so this is a plain pooled ratio — no unit juggling.
 * It lands near the highest-volume channel, which is the intended behaviour.
 *
 * Channels with no CAC (an ad-less channel whose Acq. cost is 0) are EXCLUDED
 * from both sides: counting their margin against a ₱0 cost would inflate the
 * ratio for free. With one qualifying channel it reduces to that channel's QRR.
 */
export function computeOverallHealth(
  channels: {channel: string; actuals: ChannelActuals; knobs: Knobs}[],
): OverallHealth {
  const included: string[] = [];
  const excluded: string[] = [];
  let margin = 0; // Σ contribution × orders  — total gross margin
  let spend = 0; // Σ CAC × orders           — total marketing + promo
  let orders = 0;
  for (const c of channels) {
    const h = computeHealth(c.actuals, c.knobs);
    if (h.cac > 0) {
      included.push(c.channel);
      margin += h.contribution * c.actuals.orders;
      spend += h.cac * c.actuals.orders;
      orders += c.actuals.orders;
    } else {
      excluded.push(c.channel);
    }
  }
  const contribution = r2(div(margin, orders));
  const cac = r2(div(spend, orders));
  return {
    qrr: spend > 0 ? r3(div(margin, spend)) : null,
    contribution,
    cac,
    profit: r2(margin),
    cost: r2(spend),
    included,
    excluded,
  };
}

export function computeChannelHealth(f: ChannelFacts, k: Knobs): ChannelHealth {
  const aov = r2(div(f.revenue, f.orders));
  const repeat = r3(div(f.orders, f.buyers));
  const roas = f.adSpend ? r3(div(f.adRevenue ?? 0, f.adSpend)) : null;
  const margin = r3(1 - k.cogsPct - k.platformFeePct);
  const contribution = r2(aov * margin);
  // Marketing per order: ad-derived (AOV/ROAS) where there are ads, else the
  // user-supplied acquisition spend per order (Website has no ROAS to derive from).
  const marketingPerOrder = roas ? r2(div(aov, roas)) : r2(div(k.acqCost ?? 0, f.orders));
  const promosPerOrder = r2(div(k.promos, f.orders));
  const cac = r2(marketingPerOrder + promosPerOrder);
  const qrr = cac > 0 ? r3(div(contribution, cac)) : null;
  return {aov, repeat, roas, margin, contribution, marketingPerOrder, promosPerOrder, cac, qrr};
}
