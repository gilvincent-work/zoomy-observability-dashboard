// Per-channel QRR math — mirror of computeChannelHealth in zoomy-observability
// (src/observability/business-health.js). Kept in sync by necessity (cross-repo).
// Pure + client-safe so the dashboard recomputes live as the knobs change.
import type {ChannelFacts, Knobs, ChannelHealth} from './health-types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const div = (a: number, b: number) => (b ? a / b : 0);

export function computeChannelHealth(f: ChannelFacts, k: Knobs): ChannelHealth {
  const aov = r2(div(f.revenue, f.orders));
  const repeat = r3(div(f.orders, f.buyers));
  const roas = f.adSpend ? r3(div(f.adRevenue ?? 0, f.adSpend)) : null;
  const margin = r3(1 - k.cogsPct - k.platformFeePct);
  const ltv = r2(aov * repeat * margin);
  const marketingPerOrder = roas ? r2(div(aov, roas)) : 0; // Website: no ads → 0
  const promosPerOrder = r2(div(k.promos, f.orders));
  const cac = r2(marketingPerOrder + promosPerOrder);
  const qrr = cac > 0 ? r3(div(ltv, cac)) : null;
  return {aov, repeat, roas, margin, ltv, marketingPerOrder, promosPerOrder, cac, qrr};
}
