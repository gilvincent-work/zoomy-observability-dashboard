// Per-channel QRR math — mirror of computeChannelHealth in zoomy-observability
// (src/observability/business-health.js). Kept in sync by necessity (cross-repo).
// Pure + client-safe so the dashboard recomputes live as the knobs change.
import type {ChannelFacts, ChannelActuals, Knobs, ChannelHealth} from './health-types';

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
