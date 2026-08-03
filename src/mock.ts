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
          window: {from: '2026-07-04', to: '2026-08-02', label: '04/07/2026 - 02/08/2026'},
          headline:
            'The Shopee shop brought in ₱9,820 from 22 buyers over this 30-day stretch — that works out to about ₱446 per buyer, a healthy basket size. The store is making sales, but from a small number of buyers, so the biggest opportunity is turning more of the traffic into orders rather than squeezing each order.',
          figures: [
            {label: 'Sales (PHP)', value: 9820, timeBasis: 'window'},
            {label: 'Buyers', value: 22, timeBasis: 'window'},
            {label: 'Sales per buyer (PHP)', value: 446.36, timeBasis: 'window'},
          ],
          recommendations: [
            'Bundle your two best-selling treats into a single listing — with a ₱446 average basket, a "buy 2, save 10%" pack nudges buyers to add one more item without discounting everything.',
            'Add a low-price add-on product (e.g. a ₱99 chew) near checkout so light buyers can top up their cart and lift the per-buyer figure.',
            'Since only 22 people bought, run a 3-day flash voucher to pull hesitant visitors over the line and test whether price is the blocker.',
          ],
        },
        ads: {
          window: {from: '2026-07-20', to: '2026-08-02', label: '20/07/2026 - 02/08/2026'},
          headline:
            'Ads are paying for themselves: every ₱1 spent returned ₱2.30 in sales (a 2.3× return). But ad costs eat 43% of the sales they generate, so the margin left over is thin — the campaign is working, but there is little room to overspend before it stops being profitable.',
          figures: [
            {label: 'Ad spend (PHP)', value: 8177.18, timeBasis: 'window'},
            {label: 'Ad GMV (PHP)', value: 18827, timeBasis: 'window'},
            {label: 'ROAS', value: 2.3, timeBasis: 'window'},
            {label: 'ACOS (%)', value: 43.43, timeBasis: 'window'},
          ],
          recommendations: [
            'Pause or cut bids on the lowest-converting placements first — trimming waste lowers the 43% ad-cost ratio without losing the sales that are actually landing.',
            'Shift a slice of budget to your proven best-sellers, where conversion is highest, so each peso of spend returns more than the current ₱2.30.',
            'Hold total spend flat until ACOS drops below ~35%; only then scale up, so you grow on profit rather than buying unprofitable sales.',
            'Add negative keywords for searches that get clicks but no orders — you are paying for those clicks today with nothing to show for them.',
          ],
        },
        traffic: {
          window: {from: '2026-07-04', to: '2026-08-02', label: '04/07/2026 - 02/08/2026'},
          headline:
            'The shop drew 616 visitors and they stuck around — only about 16 in 100 bounced away immediately, which is good. The weak spot is follower growth: just 28 people followed the shop, so you are not building an audience you can market to again for free.',
          figures: [
            {label: 'Visitors', value: 616, timeBasis: 'window'},
            {label: 'Bounce rate (%)', value: 15.9, timeBasis: 'window'},
            {label: 'New followers', value: 28, timeBasis: 'window'},
          ],
          recommendations: [
            'Add a "follow us for a voucher" banner on your storefront — converting even 10% of the 616 visitors into followers builds a free retargeting audience.',
            'Post to Shopee Feed 2-3× a week so existing followers see your products again, turning one-time visitors into repeat traffic.',
            'Run a follower-only flash deal to reward and grow the base, then message it to everyone who follows.',
          ],
        },
        products: {
          window: {from: '2026-07-04', to: '2026-08-02', label: '04/07/2026 - 02/08/2026'},
          headline:
            'Shoppers like the products — about 18 in every 100 visitors add something to their cart, which is strong interest. But only about 4 in 100 actually complete the purchase, so a lot of full carts are being abandoned right before checkout. The leak is between cart and payment, not in the product appeal.',
          figures: [
            {label: 'Add-to-cart rate (%)', value: 18, timeBasis: 'window'},
            {label: 'Visit-to-buy rate (%)', value: 3.65, timeBasis: 'window'},
            {label: 'Search clicks', value: 2100, timeBasis: 'window'},
          ],
          recommendations: [
            'Send cart-recovery vouchers to shoppers who added items but did not pay — this is the single biggest lever given the strong 18% add-to-cart rate.',
            'Check for surprise costs at checkout (shipping fees, minimum spend) that scare buyers off, and consider a free-shipping threshold just below your average basket.',
            'Highlight stock scarcity or a countdown on hot listings to create urgency and shorten the gap between adding to cart and paying.',
            'With 2,100 search clicks landing on listings, make sure the top 3 products load fast and show clear pricing so that interest converts.',
          ],
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
