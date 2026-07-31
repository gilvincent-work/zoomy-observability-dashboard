// The forward-looking AI-analyst layer — a MOCK of what an extended synthesize()
// would produce once Shopify (orders/products), CRM (customers), and GA4 (traffic)
// retrieval lands. That retrieval is Dev A's seam (the RetrievalBundle), so this
// is deliberately mocked: it exercises the delivery/UX half without waiting on it.
//
// Everything here stays GROUNDED and CONFIDENCE-TAGGED — recommendations carry
// verbatim evidence + the reasoning + honest known-unknowns; predictions carry
// their basis + a confidence. That's the product's human-in-the-loop stance:
// the store owner can always see the work, not just the verdict.

export type Category = 'inventory' | 'crm' | 'revenue' | 'traffic';
export type Impact = 'high' | 'medium' | 'low';
export type Severity = 'watch' | 'warning' | 'critical';

/** A single piece of grounding behind a recommendation. */
export interface Evidence {
  kind: 'quote' | 'figure';
  text: string; // verbatim quote or the figure as shown
  source: string; // where it came from (conversation id, "Shopify orders", …)
}

export interface Recommendation {
  id: string;
  title: string; // the action, imperative
  category: Category;
  impact: Impact;
  confidence: number; // 0..1
  confidenceReason: string; // WHY this confidence — never a bare number
  rationale: string; // the reasoning chain, one or two sentences
  evidence: Evidence[]; // the "show the work"
  knownUnknowns: string[]; // what would change the call — honesty, not hedging
}

export interface Prediction {
  id: string;
  label: string;
  category: Category;
  projection: string; // human-readable forecast ("~6 days to stock-out")
  confidence: number; // 0..1
  basis: string; // what it's extrapolated from
}

export interface Anomaly {
  label: string;
  severity: Severity;
  detail: string;
  metric: string; // the figure that tripped it
  category: Category; // which tab/domain it belongs to
}

export interface SalesSignals {
  revenue: {
    total: number;
    deltaPct: number;
    aov: number;
    // Weekly actuals + a one-week forecast with a confidence band (lo/hi).
    series: {week: string; revenue?: number; forecast?: number; lo?: number; hi?: number}[];
  };
  topSkus: {name: string; revenue: number}[];
  customers: {total: number; atRisk: number; vip: number; new: number; churnPct: number; repeatPct: number};
  traffic: {sessions: number; sources: {name: string; sessions: number}[]};
  funnel: {stage: string; value: number}[];
}

export interface AnalystBrief {
  verdict: string; // the one-line "if you read nothing else"
  confidence: number; // overall
  signals: SalesSignals;
  recommendations: Recommendation[]; // pre-ranked by impact × confidence
  predictions: Prediction[];
  anomalies: Anomaly[];
}

// ── The mock brief for the healthy week (Jul 20–27) ────────────────────────────
// Consistent with the figures used across the design mocks so the story holds:
// revenue $8,420 ▲6%, AOV $54, 3,100 sessions, 1,284 customers, grain-free gap, etc.
export const MOCK_BRIEF: AnalystBrief = {
  verdict:
    'Demand is shifting to senior-dog care — reorder joint chews now and stock grain-free senior food; both are running into unmet demand while revenue holds up ▲6%.',
  confidence: 0.74,
  signals: {
    revenue: {
      total: 8420,
      deltaPct: 6,
      aov: 54,
      series: [
        {week: 'Jun 15', revenue: 7180},
        {week: 'Jun 22', revenue: 7460},
        {week: 'Jun 29', revenue: 7320},
        {week: 'Jul 6', revenue: 7890},
        {week: 'Jul 13', revenue: 7940},
        {week: 'Jul 20', revenue: 8420},
        // forecast anchors to the last actual, then projects one week with a band
        {week: 'Jul 27', forecast: 8900, lo: 8300, hi: 9500},
      ],
    },
    topSkus: [
      {name: 'Salmon kibble', revenue: 2100},
      {name: 'Joint chews', revenue: 1340},
      {name: 'Dental sticks', revenue: 980},
      {name: 'Puppy starter pack', revenue: 610},
      {name: 'Cat litter (bulk)', revenue: 540},
    ],
    customers: {total: 1284, atRisk: 47, vip: 18, new: 23, churnPct: 9, repeatPct: 38},
    traffic: {
      sessions: 3100,
      sources: [
        {name: 'Instagram', sessions: 1271}, // 41%
        {name: 'Organic', sessions: 868}, // 28%
        {name: 'Direct', sessions: 589}, // 19%
        {name: 'Other', sessions: 372}, // 12%
      ],
    },
    funnel: [
      {stage: 'Sessions', value: 3100},
      {stage: 'Product views', value: 1860},
      {stage: 'Add to cart', value: 520},
      {stage: 'Checkout', value: 210},
      {stage: 'Purchased', value: 156},
    ],
  },
  predictions: [
    {
      id: 'p-stockout-joint',
      label: 'Joint chews stock-out',
      category: 'inventory',
      projection: '~6 days to zero',
      confidence: 0.72,
      basis: '12 units left, selling ~2/day on the 4-week average',
    },
    {
      id: 'p-revenue',
      label: 'Next-week revenue',
      category: 'revenue',
      projection: '$8,900  ± $600',
      confidence: 0.65,
      basis: '6-week trend + seasonality; band is the 80% interval',
    },
    {
      id: 'p-churn',
      label: 'At-risk churn',
      category: 'crm',
      projection: '~12 of 47 likely to lapse in 30d',
      confidence: 0.58,
      basis: 'no order in 60+ days and declining cadence, vs. historical lapse rate',
    },
    {
      id: 'p-latent',
      label: 'Grain-free senior demand',
      category: 'inventory',
      projection: '8–10 units first week if stocked',
      confidence: 0.5,
      basis: '6 all-time asks + 1 live query; no price/supplier data yet — wide band',
    },
  ],
  recommendations: [
    {
      id: 'r-grainfree',
      title: 'Stock grain-free senior food',
      category: 'inventory',
      impact: 'high',
      confidence: 0.8,
      confidenceReason: 'repeated, specific asks over time plus a live in-week query — consistent signal, not a one-off',
      rationale:
        '6 all-time asks and a live grain-free query this week, against 0 units on hand — a standing unmet demand with a shopper asking right now.',
      evidence: [
        {kind: 'quote', text: 'do you have anything grain-free for a senior dog?', source: 'conversation demo-2'},
        {kind: 'figure', text: '6 grain-free senior asks (all-time) · 0 units in stock', source: 'demand themes + inventory'},
      ],
      knownUnknowns: ['Supplier lead time and unit cost not confirmed', 'No price sensitivity data for this segment'],
    },
    {
      id: 'r-jointchews',
      title: 'Reorder joint chews now',
      category: 'inventory',
      impact: 'high',
      confidence: 0.75,
      confidenceReason: 'stock and sell-through are both hard numbers; only the reorder lead time is uncertain',
      rationale:
        'Joint pain is the top theme (9 mentions) and joint chews are the #2 SKU by revenue, but only ~6 days of stock remain at the current rate.',
      evidence: [
        {kind: 'figure', text: 'Joint chews: $1,340 revenue (#2 SKU) · 12 units left · ~2/day', source: 'Shopify orders + inventory'},
        {kind: 'quote', text: 'his hips are achy and he seems stiff on the stairs', source: 'conversation demo-1'},
      ],
      knownUnknowns: ['Reorder lead time unknown — may stock out before delivery'],
    },
    {
      id: 'r-atrisk',
      title: 'Send a win-back to the 47 at-risk customers',
      category: 'crm',
      impact: 'medium',
      confidence: 0.6,
      confidenceReason: 'cohort is well-defined, but win-back response rate for this store is unproven',
      rationale:
        '47 customers show a lapsing pattern and overall churn is 9%; a targeted offer is cheaper than replacing them with new acquisition.',
      evidence: [
        {kind: 'figure', text: '47 at-risk of 1,284 customers · 9% churn · 38% repeat rate', source: 'CRM'},
      ],
      knownUnknowns: ['No prior win-back campaign to benchmark response', 'Discount depth vs. margin not decided'],
    },
    {
      id: 'r-funnel',
      title: 'Fix the product-view → add-to-cart drop',
      category: 'traffic',
      impact: 'medium',
      confidence: 0.55,
      confidenceReason: 'the leak is clear in the funnel; the cause (price? photos? stock?) is not yet isolated',
      rationale:
        'Only 520 of 1,860 product views add to cart — a 72% drop, the single biggest leak in the funnel. Recovering a slice of it is pure upside on existing traffic.',
      evidence: [
        {kind: 'figure', text: 'Funnel: 1,860 views → 520 add-to-cart (−72%)', source: 'GA4'},
      ],
      knownUnknowns: ['Root cause not isolated — needs a look at PDPs and pricing', 'Mobile vs. desktop split unknown'],
    },
  ],
  anomalies: [
    {
      label: 'Grain-free senior food: demand with zero stock',
      severity: 'critical',
      detail: 'Repeated asks and a live query against 0 units on hand — the store is turning away ready buyers.',
      metric: '6 asks · 0 units',
      category: 'inventory',
    },
    {
      label: 'Puppy starter pack sales down 22% WoW',
      severity: 'warning',
      detail: 'A double-digit drop week-over-week; worth checking pricing, listing, or seasonality.',
      metric: '▼22% WoW',
      category: 'revenue',
    },
    {
      label: 'Churn ticked to 9%',
      severity: 'watch',
      detail: 'Within normal range but trending up; the at-risk win-back should keep it in check.',
      metric: '9% churn',
      category: 'crm',
    },
  ],
};

/** Mock accessor — swap for a server-side read once the extended bundle exists. */
export function getBrief(): AnalystBrief {
  return MOCK_BRIEF;
}
