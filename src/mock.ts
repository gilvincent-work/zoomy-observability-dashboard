import type {DigestArchiveRow} from './types';

// Built-in fixtures so the dashboard runs with no database. One healthy digest,
// one degraded ("no data") — to exercise both UI states.
export const MOCK_DIGESTS: DigestArchiveRow[] = [
  {
    window_from: '2026-07-20T00:00:00.000Z',
    window_to: '2026-07-27T00:00:00.000Z',
    created_at: '2026-07-27T01:00:00.000Z',
    emailed_at: null,
    digest: {
      window: {label: 'week of Jul 20–27', from: '2026-07-20T00:00:00.000Z', to: '2026-07-27T00:00:00.000Z'},
      degraded: false,
      headline: 'Joint pain led the conversation this week, while grain-free senior options remain an unmet all-time gap.',
      figures: [
        {label: 'Conversations this week', value: 42, timeBasis: 'window'},
        {label: 'Joint pain mentions', value: 9, timeBasis: 'recurring'},
        {label: 'Grain-free senior food asks', value: 6, timeBasis: 'allTime'},
      ],
      themes: [
        {theme: 'joints', displayName: 'Joint pain', quote: 'his hips are achy and he seems stiff on the stairs', conversationId: 'demo-1'},
        {theme: 'digestion', displayName: 'Grain-free / digestion', quote: 'do you have anything grain-free for a senior dog?', conversationId: 'demo-2'},
      ],
      recommendations: [
        'Stock grain-free senior food — 6 all-time asks and a live grain-free query this week.',
        'Feature joint-supplement chews; joint pain is this week’s top theme.',
      ],
      sales: {
        headline: 'Revenue up 12% on strong joint-chew sales, though one treat line slipped.',
        figures: [
          {label: 'Net revenue this week (PHP)', value: 4003.05, timeBasis: 'window'},
          {label: 'Orders this week', value: 18, timeBasis: 'window'},
          {label: 'Revenue change vs prior week (%)', value: 12, timeBasis: 'window'},
          {label: 'Total revenue (all-time, PHP)', value: 128940, timeBasis: 'allTime'},
        ],
        topProducts: [
          {title: 'Joint Support Chews', revenue: 1240.5},
          {title: 'Freeze Dried Munchies', revenue: 980},
          {title: 'Meaty Treats', revenue: 620.25},
        ],
        rising: [
          {title: 'Joint Support Chews', note: 'Up 38% vs last week (₱900 → ₱1,240) — momentum building.'},
        ],
        watch: [
          {title: 'Grain-Free Senior Kibble', note: 'Dropped from ₱540 last week to ₱0 this week (-100%) — check stock/listing.'},
        ],
        recommendations: [
          'Reorder Joint Support Chews — top seller and aligned with this week’s top demand theme.',
          'Investigate why Grain-Free Senior Kibble went to zero despite standing demand.',
        ],
      },
      customers: {
        headline: 'Two new customers this week; a lapsed VIP is reachable for win-back.',
        figures: [
          {label: 'Total customers (all-time)', value: 31, timeBasis: 'allTime'},
          {label: 'New customers this week', value: 2, timeBasis: 'window'},
          {label: 'Returning customers (all-time)', value: 9, timeBasis: 'allTime'},
        ],
        outreach: [
          {name: 'Jane D.', list: 'vip', canEmail: true, note: 'Top spender (LTV ₱4,200) — send a loyalty perk.'},
          {name: 'Marco R.', list: 'atRisk', canEmail: false, note: 'Lapsed 74 days — re-engage via order follow-up or on-site, not marketing.'},
          {name: 'Aya S.', list: 'new', canEmail: true, note: 'Joined this week — welcome offer.'},
        ],
        recommendations: [
          'Send lapsed VIP Marco a transactional win-back touch (no marketing consent).',
          'Reward Jane with a loyalty perk to reinforce repeat purchases.',
        ],
      },
      shopee: {
        sales: {
          headline: 'Marketplace moved ₱9,820 across 22 buyers this window.',
          figures: [
            {label: 'Sales (PHP)', value: 9820, timeBasis: 'window'},
            {label: 'Buyers', value: 22, timeBasis: 'window'},
            {label: 'Sales per buyer (PHP)', value: 446.36, timeBasis: 'window'},
          ],
          recommendations: ['Bundle the top treats to lift the ₱446 basket further.'],
        },
        ads: {
          headline: 'Ads profitable at 2.3× ROAS, but a 43% ACOS leaves little margin.',
          figures: [
            {label: 'Ad spend (PHP)', value: 8177.18, timeBasis: 'window'},
            {label: 'Ad GMV (PHP)', value: 18827, timeBasis: 'window'},
            {label: 'ROAS', value: 2.3, timeBasis: 'window'},
            {label: 'ACOS (%)', value: 43.43, timeBasis: 'window'},
          ],
          recommendations: ['Trim bids on low-converting placements to pull ACOS down before scaling spend.'],
        },
        traffic: {
          headline: '616 visitors with a healthy 15.9% bounce, but only 28 new followers.',
          figures: [
            {label: 'Visitors', value: 616, timeBasis: 'window'},
            {label: 'Bounce rate (%)', value: 15.9, timeBasis: 'window'},
            {label: 'New followers', value: 28, timeBasis: 'window'},
          ],
          recommendations: ['Add a follow-incentive to convert traffic into a retargetable audience.'],
        },
        products: {
          headline: 'Add-to-cart is strong (18%) but only 3.6% of visitors buy — the leak is at checkout.',
          figures: [
            {label: 'Add-to-cart rate (%)', value: 18, timeBasis: 'window'},
            {label: 'Visit-to-buy rate (%)', value: 3.65, timeBasis: 'window'},
            {label: 'Search clicks', value: 2100, timeBasis: 'window'},
          ],
          recommendations: ['Send cart-recovery vouchers to convert the stalled add-to-carts.'],
        },
      },
    },
  },
  {
    window_from: '2026-07-13T00:00:00.000Z',
    window_to: '2026-07-20T00:00:00.000Z',
    created_at: '2026-07-20T01:00:00.000Z',
    emailed_at: '2026-07-20T01:05:00.000Z',
    digest: {
      window: {label: 'week of Jul 13–20', from: '2026-07-13T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z'},
      degraded: true,
      headline: 'no data — check the job',
      figures: [],
      themes: [],
      recommendations: [],
    },
  },
];
