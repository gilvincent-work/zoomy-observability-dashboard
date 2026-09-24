# Changelog — Coop Dashboard

Notable changes to the Coop / BrandOS dashboard (`zoomy-observability-dashboard`).
The POS app has its own changelog in `../zoomy-pos/CHANGELOG.md`.

Conventions: work flows `feature → develop → staging` (never `main` without
sign-off); Conventional Commits; commits carry `Co-Authored-By: Claude` +
a `Claude-Session` trailer. Reads the shared Coop Supabase (Staging on the
`*-staging` deploy; PROD is the co-worker's project).

Dates are local working dates (GMT+8). Newest first.

---

## 2026-09-21 — Mobile responsive, phase 2 · Business Health — `feat(mobile)`

Closes the health-view items deferred earlier. All `max-md:`-only; desktop
byte-identical.

- **Padding** — the wrapper `px-6` and its coupled `-mx-6` full-bleed sticky header
  now shrink together under `md` (`max-md:px-4` + `max-md:-mx-4 max-md:px-4`), so the
  scroll-condense header stays aligned edge-to-edge.
- **Chart heights** — the two tall charts (QRR-by-month 420px, buyer-mix 320px) now
  size from a CSS container (`h-[420px] max-md:h-[320px]` / `h-[320px] max-md:h-[260px]`
  with `ResponsiveContainer height="100%"`) instead of a fixed prop — the reviewer's
  sanctioned CSS-container approach, no JS width branching. Desktop keeps the exact
  same heights. Other charts (`charts.tsx`, 200–220px) were already width-responsive
  and modest, so left alone.

Verified: `typecheck` clean, build 19/19 pages.

---

## 2026-09-24 — Mobile: optimize the Lazada + Customers features — `feat(mobile)`

Applies the mobile treatment to the coworker's newly-merged features (Lazada exports,
merged Customers/contacts hub, CRM filters). Same additive `max-md:` / `md:hidden`
pattern — desktop byte-identical.

- **Lazada** (`lazada-view.tsx`) — both tables get a `md:hidden` card view (Customers:
  name/phone/city + spend/orders/pay; Orders-by-product: product + orders/buyers/
  items/revenue) beside the `max-md:hidden` desktop table. Page padding + the search
  field tighten under `md` (drop-zone padding preserved).
- **Customers hub** (`contacts-view.tsx`) — the merged contacts table gets a card view
  (headline + reach details + source pills + orders/spend/city/last-seen), padding and
  search responsive.
- **Mobile nav** (`dashboard-shell.tsx`) — dropped the now-redundant `/crm` "Website
  CRM" entry from the More sheet: `/crm` `permanentRedirect`s into the Customers hub,
  which is already a More-sheet item (with the top-bar source switcher for its lists).
- **CRM filters** — the coworker's new status/fulfillment/tier filter bar is already
  `flex flex-wrap`, so it wraps cleanly on mobile; no change needed.

Verified on the merged Next 16 base: typecheck clean, 286 tests, build green (all
`/lazada` + `/customers/*` routes).

---

## 2026-09-24 — Fix: hide Ask-coop FAB on mobile — `fix(mobile)`

The floating "Ask coop" button (`CoopFab`, `fixed bottom-4 left-3`) is designed to
sit in the desktop nav rail's bottom-left corner. On mobile the rail is hidden and
the new bottom tab bar occupies that space, so the FAB landed on top of the "Home"
tab. Added `max-md:hidden` — the header's `AskCoopPill` (top-right) is the mobile
entry point, so the FAB is redundant there. Desktop unchanged.

---

## 2026-09-21 — Perf: code-split Recharts off Business Health — `perf` (closes #64)

The last chart route. `health-view.tsx` had two Recharts charts inline in an
800-line view, with `CHANNEL_ACCENT`/`CHANNELS`/`shortMonth`/`hexToRgb` shared
between the charts and non-chart UI (channel cards, segmented control, cohort
table) — so a clean split needed a neutral shared module first.

- **`health-view-shared.ts`** (Recharts-free) — the four shared constants, so the
  parent imports them without pulling the Recharts chunk.
- **`health-view-chart.tsx`** — `TrendView` (QRR-by-month ComposedChart) moved whole,
  the buyer-mix BarChart extracted from `HeatmapView` as `BuyerMixChart` (takes
  `data`/`rgb`/`accent` — `rgb` also colours the heatmap cells, so it stays computed
  in the parent), plus the chart-only `TrendTooltip`/`TrendLegend`/`niceScale`/
  `MixTooltip`. Both lazy-loaded via `next/dynamic` (`ssr:false`, height-matched
  skeletons matching the earlier `max-md:` chart heights).
- Parent drops its `recharts` import entirely; verified no static `recharts`
  reference remains in the `/health` chunks (`ComposedChart` now only in async chunks).

Verified: typecheck clean, 201 tests, build green, `/health` 307s (protected) and
`/signin` renders.

**Recharts code-split complete — all 10 chart routes done.** Every route that renders
a chart now loads Recharts (~110 kB gz) as an async chunk after first paint; the
chart routes dropped ~110–117 kB of initial JS each (e.g. `/inventory` 302→185,
`/` 252→135, `/offline-sales` 247→136, `/offline-sales/events` 253→138).

---

## 2026-09-21 — Next.js 14 → 16 upgrade (security) — `chore(deps)` (issue #63)

Upgrades Next.js **14.2.35 → 16.3.5**, clearing the critical + high npm-audit
advisories that were pinned to Next 14 and its bundled postcss (RCE via image
optimizer, RSC DoS, middleware/rewrite SSRF & cache poisoning, postcss XSS). Stays
on **React 18.3** — Next 16 supports React 18.2+, so no React 19 migration needed;
`next-auth@5-beta` and `@serwist/next` both already allow Next 16.

Migration performed:
- **Async request APIs** — ran `@next/codemod next-async-request-api`. `params` /
  `searchParams` are now `Promise`s, awaited at the top of the 8 page files + the
  `pwa-icon` route handler. Logic otherwise unchanged.
- **`revalidateTag`** — Next 16 requires a cacheLife profile as the 2nd arg. Migrated
  the ~25 on-demand invalidation calls in the POS Server Actions to
  `revalidateTag(tag, 'max')` (the documented drop-in; preserves the existing
  `unstable_cache` tag behavior with SWR). They still pair with `revalidatePath` for
  the immediately-viewed routes, so read-your-writes is intact. (`unstable_cache`
  remains supported in 16, now deprecated.)
- **Builder** — Next 16 defaults to Turbopack, which Serwist's webpack-based SW
  injection doesn't support yet, so `dev`/`build` scripts pin `--webpack`.
- **tsconfig** — Next 16 auto-set `jsx: react-jsx` and added `.next/dev/types` (our
  `app/sw.ts` exclusion preserved).

Verified: `typecheck` clean, **201 tests pass**, production build green (all routes),
service worker still generated + served, `/signin` renders, protected routes 307 to
sign-in, manifest/icons public.

**Remaining / follow-ups:** audit now shows 2 high, both `browserslist` (build-time,
transitive via `@serwist/next`; exploit needs an untrusted `browserslist-stats.json`
we don't use — negligible; only "fix" is a Serwist downgrade). The `middleware` file
convention is deprecated in 16 in favor of `proxy` (still functional; codemod exists)
— left as a separate follow-up. **Staging only — needs sign-off + a full manual pass
before prod given it's a major framework bump.**

---

## 2026-09-21 — Perf: code-split Recharts off Event analytics — `perf`

`event-analytics.tsx` (route `/offline-sales/events`) imported Recharts directly for
its two charts (the cumulative-revenue AreaChart + the multi-day pacing LineChart).
Moved both — and the chart-only helpers (`pesoTick`, `axisLabelStyle`, `todLabel`,
`dayLineStyle`, `DAY_COLORS`, `chartConfig`) — into a new `event-analytics-chart.tsx`
exposing one `EventRevenueChart` (it internally switches AreaChart ⇄ pacing on
compare mode), lazy-loaded via `next/dynamic`. `dayShort` was duplicated (the parent
still uses it for the day toggle) so the parent never statically imports the Recharts
module.

- **`/offline-sales/events`: 253 kB → 138 kB** First Load JS (−115). Typecheck clean.

Recharts split now covers **9 of 10 chart routes**. Only `/health` remains (issue #64)
— its two charts are inline in an 800-line view and share `CHANNEL_ACCENT`/`CHANNELS`
with non-chart code, so it needs a small neutral shared-constants module first.

---

## 2026-09-21 — Perf: code-split Recharts off Offline Sales — `perf`

Continues the Recharts split. `offline-sales.tsx` imported Recharts directly for its
one chart (`MethodStackChart`). Moved that chart + its tooltip into a new
`offline-sales-chart.tsx` and lazy-load it via `next/dynamic` (`ssr:false`, skeleton).

- **`/offline-sales`: 247 kB → 136 kB** First Load JS (−111). Typecheck clean, build 19/19.

**Remaining (tracked, not rushed):** `/offline-sales/events` (253 kB) and `/health`
(227 kB) still import Recharts directly, but their charts are entangled with shared
local helpers (`dayShort` is used by non-chart code; `pesoTick`/`axisLabelStyle` feed
two charts; health's charts are inline in an 800-line render). A clean split means
relocating those helpers across the recharts/non-recharts boundary — deferred to its
own pass to avoid a rushed regression. Seams documented in the tracking issue.

Total Recharts split so far: **8 of 10 chart routes** de-Recharted (all tab/overview
routes + Offline Sales), ~−110 kB First Load JS each.

---

## 2026-09-21 — Perf: code-split Recharts off tab/overview routes — `perf`

Measured with the build's First-Load-JS table + chunk inspection: Recharts is a
single **383 kB (uncompressed, ~110 kB gz) chunk** that rode in the initial JS of
~10 routes (`repricer` 106 kB / `inventory/[sku]` 113 kB have no charts, confirming
Recharts was the delta). Root cause: `tabs.tsx` and `sections.tsx` statically import
`./charts` (Recharts), and every Tab/overview route renders them.

- New `components/analyst/charts-lazy.tsx` re-exports the four charts via
  `next/dynamic` (`ssr: false`, height-matched skeleton → no CLS). `tabs.tsx` and
  `sections.tsx` now import from it, so the whole Recharts graph moves to an async
  chunk fetched after first paint.

**Measured First Load JS drop (~−117 kB each):**

| Route | Before | After |
|---|---:|---:|
| `/` | 252 kB | 135 kB |
| `/crm` `/customers` `/settings` `/traffic` | 247–248 kB | 131 kB |
| `/inventory` | 302 kB | 185 kB |
| `/offline-sales/orders` | 301 kB | 184 kB |

Typecheck clean, build 19/19. `/health`, `/offline-sales`, `/offline-sales/events`
still import Recharts directly and are handled next.

---

## 2026-09-21 — Perf: trim Newsreader font weights — `perf`

`Newsreader` (`--font-serif`) was loaded at 4 weights (300/400/500/600) with both
normal and italic. Audit found every `font-serif` usage is `font-normal` (400) and
there is **no serif italic** anywhere (body italics are Inter). Trimmed to
`weight: ['400'], style: ['normal']` in `layout.tsx` — drops ~6 unused self-hosted
woff2 files from the load. Typecheck clean, build 19/19. (The pre-existing "font
override values for Newsreader" next/font warning is unrelated — it's on HEAD too.)

**Deferred — Recharts code-split (measure first):** Recharts (~100 kB+) rides in the
initial JS of chart routes (inventory 302, offline-sales/orders 301, events 266,
health 226 kB). A real split means `next/dynamic` around the chart subtrees in
`charts.tsx`/`health-view`/`offline-sales`/`event-analytics` with SSR skeletons — a
genuine refactor with an LCP tradeoff (charts pop in post-hydration). Worth doing,
but behind a `@next/bundle-analyzer` measurement to size the win and design the
skeletons; not rushed in here. The Serwist SW already precaches these chunks for
repeat visits.

---

## 2026-09-21 — Perf: cache the digest read (TTFB) — `perf`

`getDigests()` (`src/data.ts`) — read by the shell on **every** route — was
`noStore()`, so each page view paid a Supabase round-trip before the layout could
render. The digest archive is written weekly by the batch job (no in-app mutation),
so the per-request freshness wasn't worth the latency.

- Wrapped the Supabase read in `unstable_cache` (`revalidate: 300`, tag
  `digest-archive`); React `cache()` still de-dupes within a request. The shell now
  hits the network at most once per ~5 min instead of every request → lower TTFB on
  all routes. Masked rows only (no unmasked PII cached).
- A newly generated digest appears within 5 min; for instant, the batch job can
  `revalidateTag('digest-archive')` (noted in code for a future cross-repo hook).

Typecheck clean, build 19/19.

---

## 2026-09-21 — Perf: intro splash no longer blocks load — `perf`

Biggest perceived-load win. The intro splash was a fixed ~1.7–2.75s overlay on
**every** full load (hardcoded timers), and `.coop-app-in` held `<main>` at
`opacity: 0` until a **1.55s** animation-delay — so first contentful paint was
gated by animation, not the network.

- **Once per session** — `intro-splash.tsx` now records a `sessionStorage` flag; a
  pre-paint script in `layout.tsx` (beside the theme seed) adds `coop-splash-seen`
  to `<html>` on repeat loads so the overlay is `display:none` before first paint
  (no flash) and unmounts immediately (timers skipped).
- **Faster first show** — on the first load of a session the splash trigger drops
  1700ms → 600ms and the fade 1000ms → 500ms (gone by ~1.1s vs ~2.75s).
- **Content reveal** — `.coop-app-in` delay 1.55s → 0.15s, duration 0.85s → 0.5s, so
  the dashboard paints almost immediately instead of waiting out the splash.
  `prefers-reduced-motion` still disables all of it.

Net: perceived load drops by ~1.5–2s on first visit and the splash is gone entirely
on subsequent in-session loads. Typecheck clean, build 19/19. (TTFB + bundle wins
tracked separately as the next perf tiers.)

---

## 2026-09-21 — Dependency audit — `chore(security)`

Ran `npm audit`. None of the flagged issues came from the new Serwist deps.

- **Fixed (non-breaking, `npm audit fix`)** — `js-yaml` and `qs`, both transitive
  under the `shadcn` CLI (`cosmiconfig`, `@modelcontextprotocol/sdk → express`).
  Build/CLI-time only, not in the app's request path. Only `package-lock.json`
  changed; 9 → 4 advisories. Tests 201 pass, build 19/19.
- **Deferred (breaking)** — the remaining 4 (1 critical + 3 high) are all Next.js
  `14.2.35` and its bundled `postcss`; the only fix path is `next@16` (a major
  upgrade). Pre-existing, unrelated to this work, and several advisories are
  self-hosted-only / Vercel-mitigated. Flagged for a separate, tested upgrade —
  not bundled into the mobile/PWA work.
- Follow-up worth considering: `shadcn` sits in `dependencies` (it's a dev CLI) and
  is the sole source of the js-yaml/qs subtrees — moving it to `devDependencies` (or
  dropping it) would shrink the runtime dep surface.

---

## 2026-09-21 — PWA: service worker (Serwist) — `feat(pwa)`

Adds the offline/app-shell service worker, completing the PWA. Deliberately minimal
and **PII-safe**.

- **`app/sw.ts`** — a Serwist worker that precaches **only** Next's hashed static
  build assets (JS/CSS/fonts/icons — no customer data). **No runtime caching** of
  navigations, `/api`, or Supabase reads: this app is behind Google auth and renders
  PII, so authenticated responses must never touch the cache (leak risk on shared
  devices). Every non-precached request falls through to the network.
- **`next.config.mjs`** — wrapped with `@serwist/next` (`swSrc: app/sw.ts` →
  `public/sw.js`, `cacheOnNavigation: false`, `register: true`, disabled in dev).
  `serwist` + `@serwist/next` added to deps; generated `public/sw.js` is gitignored.
- **`middleware.ts`** — auth matcher also excludes `sw.js` so the worker script is
  publicly fetchable. `app/sw.ts` is excluded from the app `tsconfig` (Serwist bundles
  it; the `webworker` lib would clash with `dom`).

Verified on a production server: `/sw.js` serves as public `application/javascript`
(≈35 KB), the registration is wired into the client bundle (`serviceWorker.register`
→ `/sw.js`), the manifest is public, and protected pages still 307 to `/signin`
(auth intact). With this, Coop is a full PWA: installable, standalone, offline-shell,
and eligible for the automatic install prompt.

---

## 2026-09-21 — PWA: installable (manifest + icons) — `feat(pwa)`

Coop is now installable (Add to Home Screen → standalone window with Coop chrome).
No new dependencies and no binary raster tooling.

- **`app/manifest.ts`** — web manifest (name/short_name, `display: standalone`,
  `start_url`/`scope` `/`, Coop `theme_color`/`background_color`). Next links it
  automatically; inert on desktop.
- **`app/pwa-icon/[size]/route.tsx`** — 192/512 (+ `?maskable=1`) PNG icons rendered
  at request time by `next/og` (ImageResponse) from the existing brand mark
  (`#3F6E56` tile + cream "c"), so no PNG assets or `sharp`/ImageMagick needed.
- **`app/apple-icon.tsx`** — 180×180 iOS home-screen icon (iOS ignores the manifest
  for A2HS), full-bleed tile since iOS rounds corners itself.
- **`middleware.ts`** — the auth matcher now also excludes `manifest.webmanifest`,
  `pwa-icon`, `apple-icon`, `icon.svg`. A manifest that 302s to `/signin` isn't
  installable and browsers fetch icons without credentials; these carry no secrets.
  No app **page** changed protection.

Verified on a production server: `/manifest.webmanifest` serves public JSON and all
four icons return `image/png` (PNG magic `89504e47`, ~2.6–11 KB). Paired with the
phase-1 `viewport`/`themeColor`. **Still to come:** a Serwist service worker for
offline app-shell + the automatic install prompt (separate step — it adds a
dependency + build-config change and needs on-device testing; caching will be
static-shell-only, never the PII/auth data).

---

## 2026-09-21 — Mobile responsive, phase 2 · Offline Sales + padding pass — `feat(mobile)`

The three Offline Sales views (`offline-sales`, `offline-orders`, `offline-events`)
are already grid-based with responsive `md:grid-cols-*` and no tables, so they stack
on mobile as-is; they only needed page padding tightened under `md`. Same `max-md:`
padding applied to `inventory-view` and `home-landing`. All `max-md:`-only → desktop
byte-identical.

- `health-view` padding was left alone on purpose: its wrapper `px-6` is coupled to a
  `-mx-6` full-bleed sticky (scroll-condense) header, so changing one without the
  other would misalign it. Deferred to a dedicated pass.

Verified: `typecheck` clean, build 17/17 pages.

---

## 2026-09-21 — Mobile responsive, phase 2 · Repricer + Sales — `feat(mobile)`

Two more views, both invariance-safe (every change is `max-md:`-only, so ≥ `md`
is byte-identical).

- **Repricer** (`repricer-view.tsx`) — its four dense tables (currently-repriced
  with expandable history, changed, ready-to-reprice, and the history sub-table)
  keep their desktop layout and now scroll cleanly as a unit below `md`
  (`max-md:min-w-[…]` inside the existing `overflow-x-auto` wrappers) instead of
  cramming. Full card transforms were skipped here deliberately — the main table's
  row-expand + inline `InfoTip`s make cards high-effort for a low-traffic review
  page; scroll is the reviewer's sanctioned fallback. Page padding + the `text-[28px]`
  heading also tighten under `md`.
- **Sales / channel compare** (`channel-compare.tsx`) — already structurally mobile
  (no tables; the 2-col layout is `lg:`-gated so it stacks below `lg`; header and
  chips `flex-wrap`). Only the oversized `text-[2.6rem]` hero and page padding
  needed `max-md:` shrinking.

Note: `product-controls.tsx` was **not** touched — `/products` redirects to
`/inventory` and the `ProductControls` component is no longer rendered anywhere
(only referenced in comments), so it's effectively dead code.

Verified: `typecheck` clean, build 17/17 pages.

---

## 2026-09-21 — Mobile responsive, phase 2 · Inventory table — `feat(mobile)`

The inventory table (`components/analyst/inventory-table.tsx`) now has a mobile
card view. Same invariance rule — the desktop `Row`, the `<table>`, and its
`menuFor` state are **untouched**; the only edited line is the scroll wrapper,
which gained `max-md:hidden`.

- **Table → cards** — a new `md:hidden` `RowCard` renders each paged row as a card
  (name/SKU + `⋯` menu on top, status pill + editable price, then a 3-col grid of
  This mo/Last mo/3 mo/Stock/Lasts/Suggested). Reuses the same `RowMenu`, edit,
  add-stock and edit-stock dialogs as the desktop row.
- **Portal safety** — the card list uses its **own** `cardMenuFor` state, not the
  table's `menuFor`. Because `RowMenu` portals to `<body>`, sharing state would let
  the `display:none` breakpoint render a stray menu at (0,0) on the visible side;
  independent state means the hidden side's menu can never open.

Verified: `typecheck` clean, build 17/17 pages.

---

## 2026-09-21 — Mobile responsive, phase 2 · CRM view — `feat(mobile)`

Phase 2 (per-view content density) begins with the freshly-merged Website CRM
page (`components/analyst/crm-view.tsx`). Same invariance rule as phase 1: every
change is additive (`max-md:`/`max-sm:` class or a `md:hidden` sibling), so the
desktop view (≥ `md`) is byte-identical — the four touched classNames only gained
suffixes; nothing was deleted or lowered.

- **Table → cards** — the desktop table is now `max-md:hidden`; below `md` the same
  rows render as scannable cards (one layout per tab: carts, orders, customers)
  with the primary field + status/badge on top, the money figure emphasised, and
  the rest as a compact label/value grid. Reuses the exact same `shown` slice, so
  pagination/search/order match the table.
- **Padding & search** — page padding tightens under `md` (`max-md:p-4`,
  `max-md:space-y-6`); the search field fills the toolbar row on the narrowest
  screens (`max-sm:`) instead of overflowing. The three KPI grids were already
  responsive (`sm:`/`lg:`), so they were left alone.

Verified: `typecheck` clean, build 17/17 pages (`/crm` compiles). Stat grids and
the desktop table unchanged at `md`+.

---

## 2026-09-21 — Mobile responsive, phase 1 (shell) — `feat(mobile)`

First increment of the mobile-responsive pass. **Constraint held throughout: the
desktop view (≥ `md`/768px) must render byte-identically** — so every change is
additive (a `max-md:`/`max-sm:` class, a `md:hidden` sibling, or new state with a
deterministic `false` SSR default). A regression reviewer audited the plan against
the code first; the diff was then audited to confirm no existing desktop-governing
utility was deleted or changed in value.

- **`app/layout.tsx`** — added a `viewport` export (`width=device-width`,
  `initialScale=1`, `viewport-fit=cover`, light/dark `themeColor`). No fixed width
  or `maximum-scale`, so desktop zoom/a11y unchanged; `themeColor`/`viewport-fit`
  are inert on desktop.
- **`components/analyst/dashboard-shell.tsx`** — below `md` the left rail is hidden
  (`max-md:hidden`) and replaced by a **fixed bottom tab bar** (Home · Sales ·
  Inventory · Offline · More) plus a slide-up **"More" sheet** (Business Health,
  Events, Customers, Website CRM, Traffic, Repricer, Settings + account/sign-out).
  Highlight logic reuses `leafActive` so it matches the rail. `<main>` gets `max-md:`
  bottom padding (bar height + safe-area) so content clears the bar; the decorative
  Zoomy brand switcher is `max-sm:hidden` to stop header overflow. Motion per Emil:
  the frequent tab bar only transitions color + press-scale; the occasional sheet
  gets the iOS drawer curve; `motion-reduce` respected.

Verified: `typecheck` clean, 186 tests pass, production build 16/16 pages. Scrolling
scope for Business Health (`#coop-scroll`) unchanged — `<main>` still owns scroll at
all breakpoints. **Deferred to phase 2:** per-view content density (table→card
transforms, chart label density, typography) and the PWA layer (manifest, icons,
service worker).
## 2026-09-24 — All contacts: the three lists merged — `feat(customers)`

`/customers/all` is the hub's new landing view: one row per PERSON across the
website CRM, the booth leads and the Lazada export. First live run — 388 raw
records collapse to **379 people**.

**Why a union-find** (`src/contacts-merge.ts`): the three lists have different
identities. The CRM knows an email, a booth lead knows both, and a Lazada buyer
has **no email at all** — the export never carries one, so a phone number is its
only identity. Matching on email alone would keep every marketplace buyer
permanently separate from their website account. A person is therefore matched
on EITHER key, and a record that bridges two groups (a lead carrying the
website's email and the marketplace's phone) joins them.

Phone matching normalises to the last 10 digits, because the same number arrives
as `09171234567`, `+639171234567`, `639171234567` or `9171234567` depending on
which system typed it.

**Layout choices**, so a merged row is never confusing:
- Source chips (Web / Booth / Lazada) on every row — provenance is visible, not
  inferred. Filtering by list, including "In 2+ lists", uses the same vocabulary.
- Tiles lead with reachability (email / SMS), which is why anyone opens this.
- Contact, email and mobile share one cell: "who is this and how do I reach
  them" is one question.
- Orders and spend are summed across lists, stated in the table footer.

Field precedence follows what each list knows best: the website for names and
tiers, Lazada for the shipping city, any list for contact details.

---

## 2026-09-23 — One Customers hub for every contact list — `feat(customers)`

The three contact lists now live under the **Customers** tab, and the top bar's
reporting-period pill is replaced there by a **source switcher**: Website CRM ·
Event lead contacts · Lazada contacts. A digest week never applied to these —
they are live lists, not a windowed report — so the slot now carries something
that does.

- `/crm` → `/customers/website-crm`, `/lazada` → `/customers/lazada`, both old
  paths kept as permanent redirects so existing links still land.
- **New** `/customers/leads`: every spin-the-wheel lead across events, reusing
  the event page's `LeadCapture` block. With no single event to divide by, its
  "leads per order" stat reads '—'; the per-event slice stays on the event page.
- `/customers` redirects to the CRM, the busiest of the three.
- The nav rail goes back to one **Customers** tab (the separate Website CRM and
  Lazada entries folded in).

**Superseded:** the digest-derived "Customers — who to reach out to" view that
`/customers` used to render. `CustomersTab` is still exported from
`components/analyst/tabs.tsx` if it should come back as a fourth source.

---

## 2026-09-23 — Compact Lazada header — `refactor(lazada)`

The drop zone became an **Import export** button under Refresh, and the amber
PII banner is gone. Both were permanent blocks above the numbers people open the
page to read, for an action taken about once a month. Dropping a file still
works — the whole page is the drop target now, and it outlines while you drag.
The consent wording moved to the button's tooltip, so the reminder still meets
whoever is about to upload.

---

## 2026-09-23 — Lazada customer exports — `feat(lazada)`

The storefront admin's Lazada page moves to Coop, upload and all. Unlike the
CRM (a live proxy over a Worker), this feature **owns data**: `lazada_orders` +
`lazada_uploads` lived in the STOREFRONT Supabase project, which Coop has no
credentials for, so they are created in the shared archive project alongside
`pos_*`. Nothing to migrate — the storefront's prod project never had the table.

- **Transforms ported verbatim** to `src/lazada-export.ts` /
  `-client.ts` (JS → TS, logic untouched) together with their 62 tests, which
  pass unchanged. The rollup stays un-materialised: items collapse by phone at
  read time, as documented in `supabase/lazada_orders.sql`.
- **Upload is a server action** (`src/lazada-actions.ts`). The browser parses the
  `.xlsx` with ExcelJS (dynamically imported, ~900KB off the initial bundle) and
  posts normalised rows; the server upserts on `order_item_id` in chunks of 400,
  so re-uploading the same export — or two overlapping windows — converges
  instead of double-counting. A successful import revalidates the `lazada-orders`
  tag, so the table reflects it immediately.
- `lazada_uploads` is best-effort and optional: the orders are already saved, so
  a missing ledger never reports a good import as failed. It keeps counts only —
  the "13 buyers excluded" figure is knowable at parse time and nowhere else,
  and storing the aggregate keeps the answer without retaining the PII of buyers
  this list will never contact.
- The money columns are typed optional, mirroring the storefront's defensive
  `select *`: an install predating them must still render.

Adds one dependency: `exceljs`.

---

## 2026-09-21 — CRM refresh control, no reporting period — `feat(crm)`

**Refresh beside the title**, with the last read time next to it. The shared
`RefreshControl` gained an optional `beforeRefresh` hook, because the CRM's
readers sit behind a 60s server cache: `router.refresh()` alone would re-render
the same figures while the label reset to "just now" — a refresh that claims to
have worked and did nothing. The button now invalidates the `crm-live` cache tag
(`src/crm-actions.ts`) first, so it genuinely goes back to the Worker. Cache
window and tag moved to `src/crm-cache.ts`, mirroring `pos-cache.ts`.

**The reporting-period pill is hidden on /crm.** The CRM's figures are all-time
or rolling 7-day, read from the live engine; a digest week sitting above them
implied a scope the numbers do not have. Added to the same `showPeriod`
exclusion list as Inventory and Offline Sales.

---

## 2026-09-21 — CRM table filters — `feat(crm)`

Each CRM table gets the filters its storefront-admin counterpart has, so an
admin can reach a subset without scrolling 6 pages: carts by **Progress /
Status / RETURN30**, orders by **Payment / Fulfillment / Reviewed**, customers
by **Tier / Bought**. Filter sets are per-table and survive tab switches; any
change resets to page 1, and a Clear appears only when something is narrowed.

Progress needs Shopify's raw checkout payload, which the reader deliberately
drops at the boundary — so the stage is now derived **server-side** in
`crm-data.ts` and only the label (`Email` / `Shipping` / `Payment`) crosses to
the browser, never the shopper's address. It is also a new table column and CSV
field. As on the storefront, `Shipping` is the furthest step Shopify exposes:
payment-form engagement lives in its secure iframe and is never persisted
unless the payment completes.

---

## 2026-09-21 — Website CRM page (live proxy) — `feat`

New `/crm` tab: website customers, orders and cart recovery, read **live** from the
Zoomy CRM Worker — the same API the storefront admin at
`zoomyforpets.com/admin/crm` reads. Chosen over archiving into Supabase because
the Worker is the system of record (Shopify webhooks land there), so a copy could
disagree with the storefront; `src/crm-data.ts` caches reads for 60s the way
`pos-data.ts` does and fails soft, so an unreachable Worker empties the page
instead of breaking the route.

Two supporting changes in `zoomy-crm`: a **read-only token**
(`CRM_API_READ_TOKEN`) that opens `/api` but not `/admin` — the full token can
start a real customer email batch, which a Vercel app should never hold — and a
new `GET /api/membership-config` serving the Platinum threshold from the Shopify
metafield, so the threshold shown here cannot drift from the storefront's.

Deliberately **read-only**: reminder and win-back sends stay in the storefront
admin. Numbers verified against the storefront admin on the same data (totals,
revenue, tiers and recovery all matched).

---

## 2026-09-21 — v1.2.6: spin-the-wheel leads to prod — `chore(release)`

**Version bumped to 1.2.6** (was 1.2.5). Ships the Lead capture block below, plus
its contacts filters and pagination. The `spin_wheel_leads` table was created on
prod (`qkxbwzdxhwcbwgriwipi`) from `supabase/spin_wheel_leads.sql` and seeded with
the Sep 18–20 export (113 rows, 108 inside the event window) via
`scripts/import-spin-leads.mjs` — additive only, nothing existing touched. No POS
app change; this is dashboard-only.

---

## 2026-09-21 — Contacts filters + pagination — `feat`

The contact list gained a prize filter, a collection-date filter, and the shared
`Pagination` component in place of "Show all N". The copy-emails button follows
the filters, so a segmented follow-up list (one prize, one day) is two clicks and
a copy. Filters scope the table only — the stat tiles and prize bars stay on the
event totals so the summary holds still while the list is sliced.

Lead **analytics** (capture-over-time, per-day capture rate, wheel-fairness check)
were scoped and deliberately deferred — the data supports them, but nothing was
built. Worth noting the one finding from that pass: Sep 19 was the biggest order
day (50 orders) but the worst capture rate (0.64 leads/order vs 0.87 and 0.82),
which reads as the wheel being unmanned at peak.

---

## 2026-09-21 — Spin-the-wheel leads on the event card — `feat`

The storefront's Spin the Wheel booth game (`zoomyforpets.com/admin/spin-wheel`)
collected 113 leads at the Sep 18–20 bazaar. Those now show up in Coop as a
**Lead capture** block inside each event card's analytics on `/offline-sales/events`:
lead count, how many left a mobile number, leads per order, the prize payout
tally, and the contact table (with a copy-all-emails button for follow-up).

**Why it sits on the event card, not its own page.** The leads' collection days
(Sep 18/19/20 — 26/32/50) line up exactly with *The Gourmet Pet Pantry* event, so
they are booth data, not a separate channel. They scope to the same day pills as
the sales blocks, so picking "Sep 19" narrows sales *and* leads together. The five
stray rows in the export (three June/July test entries, two with no event tag)
fall outside every event's dates and are simply never shown.

**Where the data lives.** `spin_wheel_leads` (new table, `supabase/spin_wheel_leads.sql`)
in the shared archive project, read service-role like `pos_*`. The storefront's own
spin-wheel table sits in the **storefront** Supabase project, which Coop has no
credentials for (confirmed 404 against `SUPABASE_URL_ARCHIVE`), so finished events
are imported from the admin's CSV export with `scripts/import-spin-leads.mjs`
(upserts on `email + collected_at`, so re-running an export is a no-op). The CSV
itself is **never committed** — this repo is public and the export is raw contact
data; `.gitignore` blocks it. RLS is on with no policies, so the anon key sees nothing.

PH timestamps in the export have no timezone, so `parsePhTimestamp` pins them to
`+08:00` rather than trusting server-local time — Vercel runs UTC, which would
have slid every evening lead back a day.

---

## 2026-09-18 — v1.2.5: pet-type editing to prod — `chore(release)`

**Version bumped to 1.2.5** (was 1.2.4). Ships the pet-type edit control below, and
the `edit_pos_order` RPC's `pet_type` patch was applied to the Coop prod DB. Paired
with POS 1.2.3.

## 2026-09-18 — Edit an order's pet type from Coop — `feat(orders)`

The offline-orders edit modal gains a Pet type control (Dog / Cat / Both, click the
active chip to clear back to untagged), matching the POS cart chips. It threads
`pet_type` through `editOrderAction` into the shared `edit_pos_order` RPC, which now
patches `pet_type` (same partial-patch pattern as payment method / handle; `''`
clears to untagged). Colors match the Pet mix legend. Paired with the POS-side edit
in `../zoomy-pos`. Verified end-to-end on Staging (set + clear, total preserved).

## 2026-09-18 — v1.2.4: event Top sellers bundle breakdown to prod — `chore(release)`

**Version bumped to 1.2.4** (dashboard only). Promotes the event Top sellers bundle
breakdown + reconciliation below. Presentational only — no schema or data-layer
change, consistent with features-only production promotion (no stock/product sync).

## 2026-09-18 — Event Top sellers: bundle breakdown + reconciliation — `feat(events)`

The per-event **Top sellers** list now mirrors the Offline Sales "Top products"
card. Each product shows a `{n} individual · {n} bundled` breakdown under its name
(individual = total units minus bundle-picked units), so it's clear how many units
moved on their own vs. inside a bundle. Below the list, a **Bundle deals** row
(order count + set price) plus the reconciliation line "Itemized … plus bundles …
matching Revenue above" ties the itemized per-product total back to the event's
Revenue KPI. Purely presentational — reuses the existing `topProducts` (`bundledUnits`
was already computed) and `bundleSalesSummary` helpers, scoped to the event's orders
(and the selected day). No schema or data-layer change.

## 2026-09-17 — v1.2.3: distinct per-day colors to prod — `chore(release)`

**Version bumped to 1.2.3** (dashboard only; POS unchanged at 1.2.2). Ships the
per-day color fix below. Distinct hues for up to 7 days before the earlier-day
palette repeats; latest day always the ochre accent.

## 2026-09-17 — Compare-days chart: distinct color per day — `fix(events)`

Earlier days were all drawn from one gray at different opacities, so a 3-day event
read as basically two colors. Each earlier day now gets its own distinct hue (cool
palette that holds up on light + dark); the latest/live day stays on the ochre accent
and thicker line so "today" still stands out. Legend + tooltip pick up the new colors.

## 2026-09-17 — v1.2.2: ship compare-days event chart to prod — `chore(release)`

**Version bumped to 1.2.2** (was 1.2.0). Promotes the event "Revenue over time"
compare-days overlay (per-day pacing on one hourly-sampled chart) and the low-stock
email STAGING tagging to prod. POS bumped to 1.2.2 in lockstep.

## 2026-09-17 — Compare-days chart: hourly hover points — `fix(events)`

Follow-up to the compare-days overlay. The lines were plotted at each order's exact
minute, so hovering jumped between sparse times (10 AM, then 3 PM) and the tooltip
could only resolve the day that owned that minute. `eventDayPacingSeries` now samples
on an even **hourly grid** across the event window: each hour holds every day's running
total through that hour's end (null outside a day's own selling hours). Hovering now
steps hour by hour and shows every active day's pace at that clock hour. Tests updated.

## 2026-09-17 — Event revenue: compare each day's pace on one chart — `feat(events)`

The event detail "Revenue over time" chart gets a **Combined / Compare days** toggle
(multi-day events only, on "All days"). Combined keeps the familiar single cumulative
line. Compare days overlays one line per event day, each resetting to ₱0 and aligned by
**time of day**, so you can see at a glance whether today is pacing ahead of or behind
the previous days at the same clock time.

- The latest (usually live) day draws in the ochre accent (`--chart-4`); earlier days
  recede into graduated muted gray, oldest faintest. A small legend labels each day and
  marks the latest.
- New pure helpers in `pos-sales-compute.ts`: `manilaMinuteOfDay` (time-of-day in Manila
  minutes) and `eventDayPacingSeries` (per-day intraday cumulative, aligned by time of
  day, voided excluded, each day resetting). Covered by unit tests.
- Single-day events are unchanged; the toggle only appears when two or more days have sales.

## 2026-09-17 — v1.2.0: align with POS prod promotion — `chore(release)`

**Version bumped to 1.2.0** (`package.json`; was 1.1.0) in lockstep with the POS
app, marking the prod cutover of the shared `pos_*` features the dashboard reads
and writes: events/cash/pet-tag, Coop stock intake, stock-forecast config, order
edit/void, and low-stock email alerts. No dashboard code change in this bump; the
schema promotion is driven from `../zoomy-pos/supabase/prod_promotion_2026-09-17.sql`
(prod `qkxbwzdxhwcbwgriwipi`, additive-only, existing sales data untouched). Prod
deploy of `main` is the co-worker's Vercel project.

## 2026-09-16 — Stock Forecast (Phase 4): low-stock email alerts — `feat(alerts)`

The email half of the Stock Forecast. Immediate alerts are **event-driven**; the
daily digest is a scheduled recap. Alert code lives in `zoomy-observability`
(job + Edge Function); this dashboard's role is capturing recipients (below) and
being the deep-link target. Verified end-to-end on Staging (real POS sale ->
email in seconds, to two captured recipients).

- **Immediate alerts are instant, not polled.** A DB trigger on
  `pos_stock_movements` calls a Supabase Edge Function (`stock-alert`) via
  `pg_net` the moment a sale crosses a product into low/out. The function
  recomputes that product's band, dedupes against `pos_stock_alert_log` (fire
  once per crossing, escalate low->out, resolve on recovery), and emails via
  Resend. Trigger is fail-soft + async, so alerting can never block or break a
  POS sale. Resend key is a **function secret**, never in the DB.
- **Daily digest** stays on the GitHub Actions cron (08:00 Manila) as the full
  recap + surge-shortfall summary. The old hourly cron was removed (the trigger
  replaces it).
- **Recipients** = captured dashboard sign-ins (`pos_dashboard_users`) unioned
  with an `EMAIL_TO` fallback. **Environments** emulated with suffixed secrets
  (`*_STAGING` / `*_PRODUCTION`) since native GitHub Environments need a paid
  plan on this private repo; production leg scaffolded but dormant.
- **Verified on Staging:** a live POS sale of Yoghurt Cubes fired the low email,
  then out (escalation) at 0; Cat Grass Cubes fired low then auto-resolved on
  restock. All via the trigger, no manual calls. Poppins email template (system
  fallback in Gmail), no em/en dashes.

## 2026-09-17 — Bundles: create + edit scope from Coop — `feat(inventory)`

Coop could co-edit a bundle's emoji, name, price, and listing, but not its
**scope** (which product lines it covers and the "Buy any N" count), and couldn't
**create** one at all. Both added, reusing the existing `apply_pos_bundle` RPC and a
direct `pos_bundles` update, so **no schema change**.

- **Edit scope** (`setBundleScopeAction`): the scope summary on each Buy-Any-N row
  ("Buy any 3 · Freeze Dried, Meaty Treats, Tasty Treats") is now a click target
  that opens a scope editor, pick count + eligible-line chips. Writes `pick_count` +
  `line_categories`; the POS mirrors it on its next catalog pull.
- **New bundle** (`createBundleAction`): a header button opens a create dialog
  (name, emoji, price, pick count, eligible lines) that mints a bundle_id and calls
  `apply_pos_bundle`. Buy-Any-N only for now (fixed item-list bundles stay POS-built).
- Emoji, name, price, and listing stay inline-editable in the row as before.
- Copy updated to reflect that bundles can now be created in Coop too. tsc clean,
  183 tests green, build compiles, design detector clean.

## 2026-09-17 — Cache the hot pos_* reads (faster navigation) — `perf(pos)`

Navigations felt slow because every page is dynamic and every data reader called
`noStore()`, so each navigation **and every Next link prefetch** re-ran the full
Supabase query set (the `getPosOrders` whale fetches all orders + items + products
+ bundles). The trace was dominated by RSC round-trips waiting on those queries
(and inflated further by a Fast 4G devtools throttle).

- **Short-lived Data Cache with tag invalidation.** The heavy readers
  (`getPosProducts`, `getPosBundles`, `getPosOrders`, `getPosOrdersPage`,
  `getPosEvents`, `getSaleMovements`) are wrapped in `unstable_cache` with a **30 s**
  revalidate and coarse tags (`pos-orders` / `pos-catalog` / `pos-events`), replacing
  `noStore()`. Repeat navigations and prefetches now serve cached data instead of
  re-querying.
- **Writes stay instant.** Every mutation action (`revalidateTag`) busts the
  relevant tag, so a Coop edit shows immediately; POS-originated writes (new sales,
  POS stock/event edits) heal within the 30 s window. New shared config in
  `src/pos-cache.ts`.
- **Not changed on purpose:** `getPosOrders` is *not* bounded to a recent window,
  because YoY / vs-last-year / "all time" need full history. Pages stay
  `force-dynamic` (the data cache is the win); making routes themselves cacheable is
  a possible later step.
- **Infra note (separate):** if the Vercel function region differs from the Supabase
  region, each DB round-trip pays cross-region latency, worth matching them.
- tsc clean, 183 tests, build compiles.

## 2026-09-17 — Fix row ⋯ menu clipping on bottom rows — `fix(inventory)`

The per-row actions menu was absolutely positioned inside the table's
`overflow-x-auto` container (which also clips vertically), so on the last rows it
was cut off at the card's edge. Render it in a **portal with fixed positioning**
anchored to the ⋯ button instead: it escapes the overflow container and **flips
above the button** when there isn't room below. Closes on outside-click, scroll, or
resize. Two-pass measure so it never flashes in the wrong spot. tsc clean, 183 tests.

## 2026-09-17 — Edit stock (set to an exact count) + traceable history — `feat(inventory)`

Add an **Edit stock** action alongside Add stock: set a product's on-hand to an
absolute number, not just add. No schema change (the `set_product_stock` RPC and
`setStockAction` already existed, just unwired from the revamped page).

- **Edit stock** in the row ⋯ menu opens a dialog prefilled with the current count;
  saving writes the exact on-hand via `set_product_stock`, which logs one `recount`
  movement carrying the signed delta (previous vs new).
- **Traceable Stock history.** The detail page's Stock history is now built from the
  movement ledger (adds, reversals, **and edits**), reconstructing the running
  on-hand so an edit reads **"Edited stock  50 → 45  (−5)"** — previous, new, and
  difference — with who and when. `getProductDetail` returns a `history` list; the
  chart's delivery markers now read the same ledger.
- **Audit "who".** `setStockAction` now stamps the signed-in Coop user (like
  add-stock) instead of a constant, so edits are attributable.
- Verified on Staging: a 50 -> 45 edit logged a `recount` of −5 by the actor; ledger
  sum equals on-hand (reconstruction is exact). tsc clean, 183 tests, build + detector clean.

## 2026-09-17 — Forecast cover reads "selling days", not "events" — `fix(inventory)`

PO feedback: "~23 events" in the Lasts column is unintuitive (and "event" collides
with the bazaar `pos_events` concept). Since the unit is really event-*days* (the
Fri/Sat/Sun the store sells), relabel it to **"selling days"** everywhere it means
cover. **Pure wording change, no math or config conversion** (a selling day is an
event-day, so ~23 stays ~23 and stored settings are unchanged).

- Lasts column badge, detail-chart footer, and the settings hints (Target cover,
  Early warning) now say "selling days". Lead time stays plain "days" (real
  calendar lead time). The low-stock email's "event-day sell through" line updated
  to match (`zoomy-observability`).
- **Left alone (correctly):** bazaar "events" wording, the Events page/nav, and
  internal names (`coverEventDays`, `EVENT_WEEKDAYS`) — those mean an actual bazaar.
- The engine stays event-day based (sales cluster on weekends; a per-calendar-day
  rate would be wrong). tsc clean, 183 tests, build compiles.

## 2026-09-17 — vs-last-year as "same month last year" bars — `fix(inventory)`

The vs-last-year overlay was a muted dashed line; the PO mockup wants **grey bars**
("Same month last year") behind each month's bar. Replaced the line with a grey bar
per month (`soldLastYear`), drawn behind this year's solid/dashed bar and a touch
wider so a **hoverable sliver** always peeks out even where they overlap. Hovering
it shows **"JUN last year / 40 pcs sold"**. Added the matching **legend entry**
(shown only when the toggle is on). tsc clean, 183 tests, build + detector clean.

## 2026-09-17 — Product detail chart rebuilt to the PO mockup — `feat(inventory)`

Replaced the single overlaid recharts chart with a bespoke two-panel SVG built to
the PO's mockup (`components/analyst/stock-sales-chart.tsx`). Recharts dropped from
this route (First Load JS 222 kB to 111 kB).

- **Window: last 3 real + next 3 forecast months** (was 6 real + 3). A dotted
  "forecast" divider splits them; the current month is boxed on the axis.
- **Top panel: pieces sold** as bars (solid = real, dashed hollow = forecast) with a
  connecting line (solid then dashed) and value labels (`34`, `~32`). Forecast now
  follows last year's monthly pattern when data exists, else recent pace.
- **Bottom panel: stock on hand** as a blue line + area, with delivery ▲ markers
  (`+qty`, from `receipt` movements), hollow forecast circles, a "last counted ~N
  wks ago" note (from `recount` movements), and a red "runs out" marker.
- **Rich hover tooltips** per element: real/forecast sold, real/projected stock
  points, and deliveries ("Delivery May 20 / 62 pcs arrived").
- **vs last year toggle** overlays last year's sold as a muted comparison line;
  **greyed and non-clickable when the product has no last-year data** (so on Staging,
  which has no 2025 history, it's disabled).
- **"Counts matched the register" footer** derived from `recount` deltas over the
  last 3 months (hidden when the product was never counted).
- Data layer (`pos-product-detail.ts`) reworked for the 3+3 window, per-month
  deliveries, last-year series, and the count-reconciliation facts. Light + dark via
  theme tokens. tsc clean, 183 tests green, build compiles; design detector clean.

## 2026-09-17 — Inventory rows are fully clickable — `feat(inventory)`

The whole product row now opens the detail page (not just the name), with a subtle
hover highlight so it reads as clickable. `onClick` on the `<tr>` routes to
`/inventory/[sku]`; `cursor-pointer` + `hover:bg-muted/50`. The inner controls keep
their own behavior via `stopPropagation` — the name link (still a real anchor for
open-in-new-tab / keyboard), the editable Price, the ⋯ button, and the ⋯ menu.

## 2026-09-17 — Event attribution: persist to DB + overlap UX — `feat(events)`

Follow-ups to the read-time attribution below, so the DB (and the POS app) agree,
and so date clashes are caught earlier and more clearly.

- **Persist the fold-in** (`attribute_untagged_orders_to_event` RPC, mirrored to
  `pos_schema.sql`): saving an event now stamps `event_id` onto untagged sales whose
  Manila date falls in its range, in the DB. **Fills blanks only** (never re-tags a
  POS-stamped sale, never un-stamps), idempotent, SECURITY DEFINER granted to
  `service_role` (Coop-only; the POS never calls it). Wired into `upsertEventAction`
  (best-effort after the event saves) + revalidates `/inventory`. Verified on
  Staging: "Sample Event" attaches 1 then 0 (15 -> 16 tagged). The read-time resolver
  still backs Coop's own views; this makes the stored data match.
- **Overlap handling, upgraded** (was: generic error only on Save):
  - **Names the culprit** — the message now reads *Those dates overlap "Bazaar A"
    (Sep 17 to Sep 18)* instead of a generic line, both live and from the server
    guard (parsed from the RPC's `check_violation`).
  - **Live inline warning** — `overlappingEvent` (same rule as the DB guard) flags a
    clash the moment the dates are entered, shows an amber warning, and disables Save
    before it ever hits the server. Events passed into `EventForm` from the events view.

## 2026-09-17 — Retroactive event attribution (automatic, read-time) — `feat(events)`

Answers "a sale was logged on a normal day; the team later decides that day was
part of an event — does Coop count it?" Now: **yes, automatically.** Before, a
sale's `event_id` was frozen by the POS at checkout and no dashboard path could
change it, so extending an event's dates never reached already-logged sales.

- **Fill-the-blanks resolver** (`pos-sales-compute.ts`): `effectiveEventId` /
  `resolveOrderEvents`. A POS-stamped `event_id` stays **authoritative**; only an
  **untagged** (null) sale is attributed — by its Manila date landing inside a
  dated event's `starts_on..ends_on` (single-bound = that one day, later-starting
  wins on overlap — same rule as `featuredEvent` / the POS's `pickEventForDate`).
  Decisions locked with the PO: automatic (no confirm gate), POS tag wins / dates
  only fill blanks, silent (totals just widen).
- **Read-time only, Coop-side.** Nothing writes `pos_orders.event_id`; the DB row
  and the POS app still show the original stamp. Applied where Coop groups by
  event/venue: the **Events dashboard** (`/offline-sales/events` rollups + per-event
  analytics) and the **Inventory venue filter**. The forecast is unaffected (it
  keys off the Fri/Sat/Sun event-day calendar, not per-order `event_id`). The
  "No venue (walk-in)" bucket shrinks accordingly. **No schema change, no POS change.**
- **Caveat:** cash reconciliation on a multi-day event can look off if opening/
  closing cash was recorded for only some of the days now in range.
- **Verified:** 6 new unit tests (182 total, all green), tsc clean, build compiles.
  On Staging, "Sample Event" (Sep 15-16) picks up 1 previously-untagged sale
  (15 -> 16 orders), confirming the fold-in against real data.

## 2026-09-17 — Numbered pagination + inventory polish — `feat(inventory)`

- **Bundles → its own tab.** It was buried under *Summary* beneath the forecast
  settings, reading as unrelated. Now `All products · Bundles · Summary`, so the
  bundle catalog is a separate concern.
- **Lasts pill no longer wraps.** The cover badge ("~26.4 events") wrapped and
  clipped its background in the narrow column; `whitespace-nowrap` on the badge +
  cell keeps it on one line.
- **Numbered pager `‹ [1] [2] [3] … ›`.** New shared `components/analyst/pagination.tsx`
  — clickable page numbers (jump straight to a page) with `…` ellipses (always
  first/last + current±1) and prev/next arrows disabled at the ends. Works both
  URL-driven (server tables, renders `<Link>`) and client-state-driven (renders
  `<button>`). Keyboard-focusable, `aria-current` on the active page.
  - **Inventory table** now paginates client-side (12/page) with a "Showing X–Y of
    Z" line; page snaps back to 1 on any filter/search/sort change and clamps when
    a filter shrinks the set.
  - **Offline Sales → Orders** retrofitted from arrow-only ("Previous / Next /
    Page X of Y") to the same numbered pager (still `?page=N` server-driven, 10/page).
    Removed the file-local `PageLink` helper.

## 2026-09-17 — Inventory revamp Phase 2b: year-over-year comparison — `feat(inventory)`

Closes the last doable Phase 1 deferral: same-month-last-year context, so a busy
month reads against its own seasonality, not just the trailing three. Pure
frontend + compute, no schema change; both data layers already load full order
history so the baseline is a free lookup.

- **Compute** (`pos-inventory-compute.ts`, +4 tests): `monthKeyOffset` /
  `monthKeyLabel` (YYYY-MM math + a "Sep '25" label), `soldInMonth` (units for one
  arbitrary Manila month, venue-filterable, same counting rules as the 3-month
  rollup), and `yoyDeltaPct` — **null when last year sold zero** so we never show a
  fake "+100% from nothing".
- **Table** (`inventory-table.tsx`): a small ▲/▼ **"…% YoY"** under the *This month*
  number (green up / red down), with a hover title spelling out `vs Sep '25: 38`.
- **Detail** (`/inventory/[sku]`): a **Year-over-year** strip under the KPIs —
  `this month 50 vs Sep '25 38  ▲32%`.
- **Fail-soft / dormant on Staging.** Shown only when a real baseline exists;
  Staging currently has just 2026-09 data (no 2025-09), so it renders nothing until
  12 months accrue — verified against the DB. Active path covered by unit tests.
- **Verified:** typecheck clean, **176 tests** green (+4), build compiles
  `/inventory` (12.7 kB), `/inventory/[sku]` (5.02 kB).

## 2026-09-17 — Inventory revamp Phase 2: forecast overlay + per-row stock — `feat(inventory)`

Closes the two deferrals from Phase 1's ⋯ — the detail chart now looks forward,
and stock is addable/undoable per row without leaving the table. Pure frontend:
no schema change, reusing the existing `add_pos_stock` / `void_last_stock_add`
RPCs (Phase 3) and the movement ledger the chart already reads.

- **Forward forecast on the detail chart** (`pos-product-detail.ts` +
  `product-detail.tsx`): the six real months now extend three months out. Monthly
  **pace** = mean of the months that actually sold (recent burst, not diluted by
  dead months); stock runs down from today's on-hand if nothing is ordered. Drawn
  as **dashed** forecast bars (hollow) + a **dashed projected-stock line**, seeded
  at the last real point so it connects. A red **"Runs out ~<month>"** label
  appears when the projection hits zero.
- **Per-row Add stock + Undo** (`inventory-table.tsx`): the ⋯ menu gains **Add
  stock** (a small qty popover calling `addStockAction([{sku, qty}])`, optimistic
  on-hand bump + `router.refresh()`) and **Undo last add** (`voidLastAddAction`).
  The header **Add stock** action stays for batch adds; this is the single-SKU
  path. Demo-mode guarded, logged to the stock ledger like the header flow.
- **Verified:** typecheck clean, **172 tests** green, production build compiles
  `/inventory` (12.5 kB), `/inventory/[sku]` (4.82 kB).

## 2026-09-17 — Inventory revamp Phase 1: merge Products + Inventory — `feat(inventory)`

Merges the Products and Inventory pages into one, restyled after the PO's mockup.
Plan + 13 locked decisions + a regression review are in the artifact and
`../COOP_INTEGRATION_PLAN.md`. On `feat/inventory-revamp`; Staging-verified data.

- **One page, two tabs.** `/inventory` now hosts **All products** (the merged
  table) and **Summary**. The `Products` nav item is removed and `/products`
  redirects in (D9). No feature is lost.
- **All products table** (`inventory-table.tsx`): Product · Status · editable Price ·
  Trend · This mo / Last mo / 3mo · Stock Qty · Lasts · Suggested · ⋯. **Sortable
  columns**, default **Category** order (Freeze Dried + subcategories first,
  matching the filter pills; uncategorized sorts last — guardrail 4). Line/Status
  filters + search. Catalog edits (rename, reprice, list/unlist) live in a per-row
  **⋯ menu** reusing the existing server actions (D5); price edits log to
  `pos_price_changes` so past sales keep their price (D6).
- **Summary tab** (`inventory-summary.tsx`): status counts, the interactive
  next-event surge planner, stock forecast settings, and bundle controls.
- **Channel + venue.** Stratpoint (Offline) / BoxMe (Online) segment; a **venue
  dropdown** (from `pos_events.venue`) scopes the monthly-sold columns. The
  **Online scope keeps** the existing marketplace analytics and **adds** a BoxMe
  stub (D13). The `channel` param keeps `offline`/`online` as aliases (D12), so the
  low-stock email CTA + Offline Sales "View all" links work with **zero cross-repo
  change** (guardrail 1).
- **Per-product detail** `/inventory/[sku]` (`product-detail.tsx`): KPI cards, a
  six-month **sales + stock chart** (recharts; green bars = units sold, blue line =
  end-of-month Stock Qty reconstructed from the movement ledger), sold-by-month
  table, and stock history.
- **New compute** `src/pos-inventory-compute.ts` (monthly rollup, venue filter,
  category sort — 9 unit tests) + data layers `pos-inventory-data.ts` /
  `pos-product-detail.ts` (fail-soft). Guardrails 2 (nav-chrome exclusion) + 3
  (repoint 15 `revalidatePath('/products')` → `/inventory`) wired. Dead
  `inventory-forecast.tsx` removed.
- **Verified:** typecheck clean, **172 tests** green (+9), production build compiles
  `/inventory` (12.1 kB), `/inventory/[sku]` (4.72 kB), `/products` (redirect);
  monthly-sold numbers reconciled against real Staging orders.
- **Deferred (Phase 2/3):** the forward-looking forecast overlay on the detail
  chart, real BoxMe online stock, last-year comparison, and per-row Add-stock/Undo
  in the ⋯ menu (Add stock stays a header action; Undo lives on the detail history).

## 2026-09-16 — Capture dashboard sign-ins for alert recipients — `feat(auth)`

Supports the low-stock email (in `zoomy-observability`): the alert needs to reach
the people who use Coop, but Google SSO stores no user list (JWT sessions, no DB
adapter). So we now record each sign-in.

- **`auth.ts` `events.signIn`** upserts the signer's email into a new
  `pos_dashboard_users` table (Staging; service-role only; mirrored to
  `../zoomy-pos/supabase/pos_schema.sql`). Fail-soft: a logging hiccup never blocks
  login. Uses a direct PostgREST upsert with the archive service-role key (no
  server-only import, so the edge middleware bundle stays clean). The upsert sends
  only `{email, last_seen}`, so `first_seen` is preserved across logins (verified on
  Staging). The email job unions this list with its `EMAIL_TO` fallback.
- Typecheck + build clean (middleware unaffected).

## 2026-09-16 — Stock Forecast (Phase 3): Add stock + history + undo — `feat(inventory)`

Adds a first-class, traceable way to receive stock into Coop, with a stock-in
history and a one-click undo. Additive schema on Staging (mirrored to
`../zoomy-pos/supabase/pos_schema.sql`, **not on prod**). Landed on `develop`.

- **Schema (Staging):** two new SECURITY DEFINER RPCs — `add_pos_stock(p_lines, p_by)`
  receives several products in **one transaction** (all-or-nothing, Q18), each line a
  `receipt` movement stamped with the signed-in Coop user; `void_last_stock_add(sku,
  p_by)` reverses a product's latest receipt with an **offsetting `add-void` row**
  (history preserved, clamped to what's still on hand — Q20). `receive_lot` untouched;
  advisor shows only the same expected SECURITY DEFINER WARN as the other pos_* RPCs.
- **Add-stock form** (`add-stock-button.tsx`): a button on **both** the Inventory
  forecast and Products. Click **Add product** → a line with its own product picker
  (chosen products drop out of the other lines' menus — no duplicates); qty takes
  numbers-only keyboard input plus −20/−10/−5/−1 / +1/+5/+10/+20 quick-steps.
  **Update** commits the batch all-or-nothing via `addStockAction`.
- **Stock history** (`stock-history.tsx`, Q19): a **global panel** under the forecast
  (recent adds: product · +qty · who · when) and a **per-product drawer** opened by
  clicking any forecast row (that SKU's adds, running total, and **Undo last add** on
  the most recent receipt). Reads `pos_stock_movements` (receipt / add-void); stock-ins
  only.
- **Data layer:** `src/pos-stock-intake.ts` (fail-soft receipts reader + mock) and
  `src/pos-stock-intake-actions.ts` (`addStockAction` all-or-nothing, `voidLastAddAction`;
  actor = signed-in Coop email, revalidates inventory/products/offline-sales).
- **Verified on Staging:** batch add of 2 lines (atomic — a bad SKU rolled the whole
  batch back), the actor recorded on each receipt, void posted the offsetting row and
  restored on-hand, and the history query returns real receipts with names. All test
  artifacts cleaned up. Typecheck clean, **163 tests green**, build compiles `/inventory`
  (7.79 kB) + `/products` (12.6 kB).
- **Deferred:** the low-stock email job (`run-stock-check.mjs` + Resend + cron) is the
  next phase — separate repo (`zoomy-observability`), needs a Resend key + cron config.

## 2026-09-16 — Stock Forecast (Phase 2): configurable + surge planner — `feat(inventory)`

Makes the forecast configurable and adds the next-event surge planner. Additive
schema on Staging (mirrored into `../zoomy-pos/supabase/pos_schema.sql`, **not on
prod**). Landed on `develop`.

- **Schema (Staging):** two new `pos_settings` keys — `stock_forecast_config`
  (threshold, per-SKU `threshold_overrides`, target cover, lead time, early-warning,
  velocity mode, event days) and `next_event_plan` (event-this-weekend, global
  multiplier, per-category + per-product overrides) — each with a SECURITY DEFINER
  upsert RPC (`set_pos_stock_config` / `set_pos_next_event_plan`), same anon-grant
  posture as `set_pos_daily_target`. Advisor: no new findings.
- **Config is live, threshold 10 is now editable.** `src/pos-stock-settings.ts`
  reads both keys **fail-soft to the Phase-1 defaults**; `getStockForecast` feeds
  the config into the compute so bands/reorder honor it. A **Stock forecast
  settings** panel on the Products page (`stock-settings-form.tsx`) edits the global
  threshold + cover/lead/early-warning via `set_pos_stock_config`.
- **Next-event surge planner** on the Offline forecast: an "event this weekend?"
  check (off → forecasts the next weekend) + an expected-volume **× multiplier**,
  and a per-product **Next event · needs** column — the multiplier pre-fills each
  cell, or type a product's absolute expected units (amber = manually set). Shows
  **"N products won't sustain · restock by <date>"**. Recomputed **client-side** for
  instant what-if; each committed change persists via `set_pos_next_event_plan`
  (actor = signed-in Coop email, Q22).
- **Compute** `src/pos-forecast-compute.ts` gains `effectiveThreshold` (per-SKU),
  `effectiveMultiplier` (category vs global), `nextEventDay` (this vs next weekend),
  and `computeSurge`. **8 new unit tests** (overrides, multiplier resolution,
  weekend roll, shortfall/sustain) — **163 tests green**.
- **Verified on Staging:** config + plan with a per-SKU threshold override, category
  multiplier, and per-product absolute all round-trip in the exact parser shape;
  seed defaults restored after. Typecheck clean, production build compiles
  `/inventory` (4.8 kB) + `/products` (11.1 kB).
- **Deferred:** per-product low-threshold override has a UI-less data path for now
  (RPC + compute support it; the global panel covers the main ask). Add-stock form +
  history + email is Phase 3.

## 2026-09-16 — Stock Forecast (Phase 1): Offline scope on `/inventory` — `feat(inventory)`

First slice of the Stock Forecast feature (full plan + 22 PO decisions in
`../COOP_INTEGRATION_PLAN.md` and the plan artifact). **Dashboard-only, no schema
change** — reads existing `pos_*` data. Landed on `develop`.

- **`/inventory` gains an All / Online / Offline channel toggle.** Default landing
  is **All** (Q8); **Online** keeps the existing marketplace/digest `InventoryTab`
  untouched (Q7); **Offline** is the new forecast. `?channel=offline` deep-links
  straight to it (used by the Offline Sales snapshot).
- **Offline stock forecast** (`components/analyst/inventory-forecast.tsx`): per-SKU
  on-hand, **event-aware** sold/day (÷ distinct selling days, not calendar days),
  **event-day** cover, weekend-snapped run-out, suggested reorder + "reorder by",
  and **Healthy / Low / Out** status (Q16 — Critical dropped). Line + (Freeze-Dried)
  subcategory filter pills mirroring the Products page.
- **Pure engine** `src/pos-forecast-compute.ts` (unit-tested, 11 cases) — the same
  module the low-stock email will reuse in Phase 3. Config (threshold 10, 14-day
  cover, 3-day lead, Fri/Sat/Sun) is constants this phase; Phase 2 makes it
  `pos_settings`-backed.
- **Data layer** `src/pos-forecast-data.ts` reads `pos_stock_movements`
  (`reason='sale'`, trailing 60 days) → velocity; **fail-soft** (any read error
  renders an empty state, never 500s); deterministic mock when the Supabase env is
  unset.
- **Offline Sales page**: the low-signal **"Recently synced"** panel is replaced by
  a **Stock snapshot** (most-urgent SKUs, worst-first, + `18 healthy · N low · N out`
  line) with a **View all →** to `/inventory?channel=offline`.
- **Verified on Staging** against real `pos_stock_movements`: the compute reproduces
  a sane mix (2 out · 2 low · 26 healthy of 30), velocity/cover math matches the
  TypeScript exactly. Typecheck clean, **155 tests green**, production build compiles
  `/inventory` (2.6 kB) and `/offline-sales`.
- **Deferred to later phases:** the surge planner + configurable settings (Phase 2),
  Add-stock form + history + low-stock email (Phase 3), real Online inventory +
  prod promotion (Phase 4). Near-expiry stays deferred (Q13).

## 2026-09-15 — Offline Sales: Pet mix + Events — `feat(offline-sales)`

- **Pet mix card on the Offline Sales home.** New card directly below the KPI row
  showing a 4-way split (Dog / Cat / Both / Untagged) with revenue and order count
  per segment, rendered as a revenue-proportional split bar plus a legend. It reads
  from the same range- and payment-method-filtered orders the KPIs use, so it
  reacts to the method toggle client-side. Colors are deliberately distinct from
  the ochre accent and the payment-method hues (dog = blue, cat = purple,
  both = green, untagged = neutral). Empty/all-zero renders a friendly note.
  Reason: the owner wanted to see which pet drives sales at a glance.
- **Events view + scheduler.** New `/offline-sales/events` page (linked from the
  home header) listing `pos_events` with per-event sales rollups (revenue, orders)
  and a cash reconciliation line (opening float + cash sales = expected till;
  over/short once a closed event's counted cash is recorded). Friendly empty state
  when no events exist. `event_id` (null = normal non-event day) and `pet_type`
  were added to the `pos_orders` read/type; new `getPosEvents()` read and `PosEvent`
  type.
- **Coop event scheduling form** (added later 2026-09-15). "New event" +
  per-event "Edit" open an inline form (name, venue, city, organizer, start/end
  dates, opening cash, note; edit adds status + counted-cash), writing through the
  new `upsertEventAction` / `closeEventAction` server actions over the
  `upsert_pos_event` / `close_pos_event` RPCs. This is the primary way Coop
  schedules a bazaar's dates so the POS auto-detects and tags that day's sales.
  Overlapping date ranges are rejected (the RPC's guard; surfaced as a plain
  "those dates overlap another event" message). Date fields: the whole field
  opens the native picker on click (`showPicker`), and the picker icon follows
  dark mode (`color-scheme`) so it isn't black-on-black.
- **Payment filter shows all methods, only enabled ones filter.** The Offline
  Sales payment dropdown now lists every known method: those with sales in range
  ("enabled") at the top and clickable, the rest greyed, unclickable, and tagged
  "No sales", separated by a divider. New pure helper `paymentMethodOptions`
  (enabled-first, canonical order), unit-tested.
- **Sales over time card no longer stretches empty.** The two-column rows
  (Sales/Top, Recent orders/Recently synced) top-align (`items-start`) so a
  shorter card keeps its natural height instead of stretching to match the taller
  column and leaving dead space below.
- **Offline Sales layout: breathing room + 2-column top.** The event spotlight
  (left) and the daily-goal card (right) now sit side by side in a two-column row
  (stacked on mobile). The event card is a proper vertical tile (status icon +
  "All events" on top, event identity anchored at the bottom) so it fills its
  column height cleanly instead of floating centered. The daily-goal card gets the
  same fill-height treatment (header pinned at top, metrics anchored at the bottom)
  so the two tiles read as a balanced pair. Bumped section rhythm
  throughout (page padding, header, KPI/pet/panel gaps) so the increasingly dense
  page reads more comfortably. The per-event analytics panel also got looser
  spacing (section gaps, KPI cards, legends, top-sellers rows, taller trend).
- **Event spotlight on the Offline Sales home.** Replaced the small "Events"
  button with a banner card that shows the event running today ("Happening now"),
  else the next upcoming one, else an empty "No events scheduled" prompt. The
  whole card links to the Events page. New pure helper `featuredEvent(events,
  todayKey)` (current, else nearest upcoming, else null), unit-tested.
- **Events page: live spotlight + per-event analytics.** The event running today
  floats to the top as a "Happening now" spotlight (ring accent, analytics
  expanded). Every other event card is collapsed to its summary + cash line with
  a "Show analytics" toggle. Analytics per event: headline KPIs (revenue, orders,
  units, avg basket), an aesthetic cumulative-revenue trend line (area chart),
  a payment split, the pet mix, and top sellers. New pure helpers
  `paymentBreakdown` and `eventRevenueSeries` (both exclude voided), unit-tested;
  the panel reuses `computeKpis` / `petMix` / `topProducts` scoped to the event.
  The trend chart now has labelled X ("Order time") and Y ("Cumulative revenue",
  with peso ticks) axes. The cash reconciliation block clarifies that card /
  e-wallet sales settle separately and aren't in the till, so "expected in till"
  (opening + cash-method sales) reads distinctly from total revenue.
- **Per-event day granularity.** Multi-day events get a day toggle on their
  analytics (default "All days", then one pill per event day). The selected day
  scopes every metric: KPIs, trend, payment split, pet mix, and top sellers (by
  the order's Manila day). Single-day events show no toggle. New pure helper
  `datesInRange`, unit-tested. The event header total and cash reconciliation
  stay event-level (opening float is one per-event value).
- **Events in the drawer nav.** Added an "Events" tab under the Overview group,
  right below Offline Sales (both the expanded accordion and the collapsed
  flyout). Active detection split so `/offline-sales` and `/offline-sales/events`
  never both highlight: Offline Sales owns its page + non-events subpaths, Events
  owns the events subtree, so the highlight transfers to Events when opened from
  the Offline Sales "Events" button. The Overview group stays active/open on the
  events page.
- **Data layer + pure helpers.** `petMix(orders)` and `eventRollups(events, orders)`
  added to `pos-sales-compute` (both exclude voided sales); unit-tested (6 new
  cases). Mock path updated: mock orders carry `pet_type`/`event_id` and two
  `MOCK_POS_EVENTS` (one active, one closed) so both features render in mock mode.
  Additive only, no schema changes here (the `pos_events` table, the two new
  `pos_orders` columns, and the `upsert_pos_event`/`close_pos_event` RPCs shipped
  to Staging separately). **Staging only.**

## 2026-09-14 — Offline Sales: Top products + Top bundles share one column — `style(offline-sales)`

- **Merged the standalone full-width "Top bundles" card into the right column**,
  stacked directly under Top products. The overview second row is now cleanly two
  columns: Sales over time (left) and the Top products / Top bundles stack (right).
- **One Revenue/Units toggle drives both.** Lifted the toggle into a shared
  `TopSellersColumn`; switching it re-ranks products and bundles together. In Units
  mode bundles rank by orders (their unit analog: one order == one bundle sold) and
  emphasize the orders figure; in Revenue mode they rank by revenue. No data or
  totals changed, purely layout + the shared control. **Staging only.**

## 2026-09-14 — Offline Sales: bundles show pre-populated on edit (no empty prompt) — `fix(offline-sales)`

- **On first load, the editor shows the order's real content** — two bundles show
  as two, each with its picks already filled, never an empty "Select bundle…"
  prompt. Each `bundle_group` reconstructs as its own bundle (no merging); a group
  with no header is auto-identified by matching its pick quantity to a bundle's
  `pick_count`, and any unattributed premium is defaulted onto the ₱0 bundles (a
  matched bundle takes its list price first, the remainder lands on the first).
- **Custom (unlinked) bundles are now valid and saveable** — a group that matches
  no bundle keeps its picks + an editable price and no longer blocks Save or forces
  a selection. The RPC stores it via a **custom-bundle premium line** (both ids
  null, tied to the group); the `pos_order_items` check constraint was relaxed to
  allow that third line shape. A bundle selector still lets you link it to a real
  bundle to get its rules.
- **Sales always record a bundle header now** (`buildBundleOrderItems`): a
  resolvable Coop id makes a linked header, an unresolvable one a custom premium
  line — so a bundle's price + grouping are never lost to an orphan group again.
- **Staging only — not promoted to prod.**

## 2026-09-14 — Offline Sales: legacy bundle orders edit as bundles — `fix(offline-sales)`

- **A pre-grouping bundle sale now opens as a bundle, not loose ₱0 rows.** When an
  order carries a bundle premium (its total exceeds the entry sum) with ₱0 picks,
  `orderToEntries` folds those picks into a bundle card carrying the premium as its
  price (so it shows ₱570, not ₱0), auto-linked to the bundle whose `pick_count`
  matches the pick quantity. Editing then shows only that bundle's picks, and
  **saving self-heals the order into the proper grouped shape**.
- **Pick options are restricted to the bundle's eligible categories** (already the
  rule for grouped bundles; now applies to folded legacy ones too). Each bundle
  card has a **bundle selector** to link/relink; an unlinked bundle blocks Save
  until you choose which bundle it is.
- Corrected a stale Staging `pick_count` on "Buy Any 4" (was 3) so it enforces and
  auto-matches as 4. **Staging only — not promoted to prod.**

## 2026-09-14 — Offline Sales: bundle-aware order editing — `feat(offline-sales)`

- **Bundles are editable again (correctly).** The Edit action is back on every
  non-voided order, including bundles. The editor shows an order as entries:
  individual items and bundle groups. A "Buy Any N" bundle renders N pick slots
  restricted to its eligible categories with a live `X / N` counter and an
  editable price; a fixed bundle shows its components with an editable price. You
  can add items or add a bundle to any order, and Save is blocked until each
  bundle meets its rule. This supersedes the 2026-09-14 fix that hid Edit for
  bundles.
- **Enforced server-side.** Saving calls the reworked `edit_pos_order`, which
  takes structured entries, checks each bundle's pick_count + pick eligibility,
  re-derives stock FEFO, and recomputes the total (`Σ item totals + Σ bundle
  prices`) — rejecting an invalid or voided order before anything mutates.
- **Reconstruction.** Orders now carry `bundle_group` on their lines; the new
  tested `orderToEntries` rebuilds groups from it (a legacy fixed-bundle header
  becomes a bundle with no picks; orphan picks degrade to loose items). The
  Orders page fetches active bundle definitions + product categories for the
  editor.
- **Schema (Staging, mirrored in `../zoomy-pos/supabase/pos_schema.sql`):**
  `pos_order_items.bundle_group`; `edit_pos_order` takes `p_entries`;
  `apply_pos_order` persists `bundle_group`. **Staging only — not promoted to prod.**

## 2026-09-14 — Offline Sales: don't corrupt bundles on edit + show line subtotals — `fix(offline-sales)`

- **Fix: bundle orders were editable and editing them wiped the bundle price.**
  A "Buy Any N for ₱X" sale records its picks as ₱0 component lines with the ₱X
  premium living only on the order total. The old Edit guard looked for a line
  with no `product_id` (a `bundle_id` line) to spot a bundle, but the POS never
  writes one, so the guard never fired and bundle orders showed an Edit button.
  Editing recomputes the total from the line totals, which zeroed the premium
  (e.g. a ₱570 "Cat Grass Cubes ×4" became ₱0). Now bundles are detected the
  reliable way, `total > Σ product-line totals` (new tested `isBundleOrder`), and
  the Edit action is hidden for them (matching the POS). To change a bundle, void
  it and re-ring.
- **Line subtotals in the edit modal.** Each item row now shows a read-only
  `qty × unit price` subtotal, so a ×2 line at ₱210 visibly reads ₱420 instead of
  looking like it ignored the quantity. The ₱ field stays the editable unit price
  (auto-filled from the catalog on pick).
- **Data repair (Staging):** restored the one bundle order a buggy edit had
  corrupted (back to ₱570 / ×4) and corrected its cat-grass stock.
- **Staging only — not promoted to prod.**

## 2026-09-14 — Offline Sales: unvoid a voided order (Staging only) — `feat(offline-sales)`

- **Voided orders now show an Unvoid action** in the Orders table
  (`/offline-sales/orders`), the inverse of Void. It confirms first, then calls
  the shared `unvoid_pos_order` RPC (restores the order to completed and re-applies
  its inventory FEFO server-side), and revalidates the Orders and Offline Sales
  views so the sale returns to the KPIs, payment-method breakdown, and stock.
- **Online-only.** Rejects an order that isn't voided; errors surface inline.
  Void's confirm copy updated ("You can unvoid it later") now that it's reversible.
- **Schema (Staging, mirrored in `../zoomy-pos/supabase/pos_schema.sql`):** new
  `unvoid_pos_order(text)`; `void_pos_order`'s audit now reverses the full net
  footprint so repeated void↔unvoid cycles stay ledger-consistent.
  **Staging only — not promoted to prod.**

## 2026-09-14 — Offline Sales: edit an order in place (Staging only) — `feat(offline-sales)`

- **The Orders table (`/offline-sales/orders`) now has an Edit action per order.**
  A modal lets you change the payment method, IG handle, and the product lines
  (pick a catalog product, set qty and unit price, add/remove lines) with a live
  running total. Saving calls the shared `edit_pos_order` RPC, which reverses and
  re-applies inventory and recomputes the total server-side, then revalidates the
  Orders and Offline Sales views so KPIs, the payment-method breakdown, and stock
  all reflect the change.
- **Guards mirror the POS:** voided orders show no Edit action (terminal);
  **bundle/component-only orders are not editable** (Edit is hidden when any line
  has a null `product_id`). An order line whose product has since been unlisted
  still shows its product in the picker (labeled "(unlisted)") instead of a blank
  select, so editing it doesn't silently drop the line.
- **Data plumbing:** `PosOrder` gained `client_uuid`, `customer_handle`, and
  `edited_at`; the Orders view surfaces an "edited" marker on changed orders. New
  `editOrderAction` server action + `PosCatalogItem` slim catalog fetched on the
  Orders page.
- **Staging only — not promoted to prod.** The `edit_pos_order` / `void_pos_order`
  schema changes live on Staging Supabase (mirrored in
  `../zoomy-pos/supabase/pos_schema.sql`); prod is unchanged.

## 2026-09-12 — Offline Sales: Manila "Today" fix + payment-method breakdown — `feat(offline-sales)`

- **Fix: "Today" (and the sales chart's day buckets) now use Asia/Manila (UTC+8)**
  instead of UTC. Previously, after Manila midnight the "Today" KPI kept showing
  the previous day's sales until 8 AM (e.g. ₱51,482 while the Daily target, which
  was already Manila-based, showed ₱0). `rangeStart('today')` and `salesByDay` now
  bucket by the Manila calendar day, so the KPIs match the Daily target and how an
  owner thinks of a bazaar day. (`manilaDayStart` moved into `pos-sales-compute`
  and is shared; 7d/30d are rolling windows, effectively unchanged.)
- **New color-coded payment-method dropdown** (top-left of the header, default
  "All payment options"). Picking a method makes the four KPI cards (Revenue /
  Orders / Units / Oversells) show **that method's** numbers. Only methods present
  in the current range are listed. Colors match the transaction badges (Cash green,
  QRPH violet, GCash blue, Maya teal, Card amber, BPI rose, Bank slate).
- **"Sales over time" is now a stacked bar chart by payment method.** Default shows
  every method in full color; selecting one **highlights its segments and greys the
  rest** (still visible). Hovering a day shows a **mini tooltip** with each payment
  option's amount, plus a color legend under the chart. New `orderMethod`,
  `presentMethods`, `salesByDayAndMethod` in `pos-sales-compute`; the breakdown is
  computed client-side from the range's orders so switching is instant.
- Verified: typecheck clean, 118 tests pass (+4), production build green;
  Manila-vs-UTC "today" gap confirmed against Staging (₱51,482 UTC vs ₱0 Manila).

## 2026-09-12 — Top products: sort by revenue or units (pill toggle) — `feat(offline-sales)`

- **Top products can now be ranked by units sold**, not just revenue. A small
  Revenue/Units pill in the panel header toggles the sort instantly (client-side,
  no reload); the active metric's column is emphasized. Both lists are computed
  server-side so "top by units" is the true top 5 by units, not the revenue top 5
  re-ordered. `topProducts` gained a `sortBy` argument; the Bundle deals
  reconciliation row is unaffected by the toggle.
- Verified: typecheck clean, 114 tests pass (+1), production build green.

## 2026-09-11 — Top bundles panel + reads real bundle lines (Phase 5 Surface F, step 3, Staging only) — `feat(offline-sales)`

- **New "Top bundles" panel** on `/offline-sales` — bundles ranked by revenue
  (name, orders, revenue), fed by real `bundle_id` order lines now that the POS
  records them (see the POS changelog, step 2). Appears once bundle sales flow
  through the updated POS; hidden when there are none.
- **Order reads now resolve bundles.** `getPosOrders` / `getPosOrdersPage` select
  `bundle_id` and join `pos_bundles` for the name, so bundle lines show the bundle
  name instead of "Unknown" in the orders list; `PosOrderLine` gained `bundle_id`.
- **Reconciliation is now era-proof.** `bundleSalesSummary` sums itemized revenue
  from **product lines only**, so `bundleRevenue = total − product-line revenue`
  is correct whether bundle money sits on a real bundle line (new sales) or only
  on the order header (pre-fix / offline-retried sales). New `topBundles` compute.
- Pre-fix and offline-retried bundle sales carry no `bundle_id`, so they stay in
  the "Bundle deals" reconciling total but are not listed by name in "Top bundles"
  (documented in the panel's info tip). No backfill.
- Verified: typecheck clean, 113 tests pass (+3), production build green. A mock
  "Buy Any 4" sale was added so the panel renders in mock mode.

## 2026-09-11 — Honest bundle reporting in Top products (Phase 5 Surface F, Staging only) — `feat(offline-sales)`

- **Fixes a misleading "Top products" panel.** A row like "Cat Grass Cubes,
  9 units, ₱850" looked wrong. Root cause (verified on prod, read-only):
  "Buy Any N" bundles are recorded as ₱0 component line items with the bundle
  price sitting only on the order header, so per-product **units** count bundle
  picks while per-product **revenue** (`Σ line_total`) excludes them. The two
  columns were on different bases, and the panel summed to far less than the
  Revenue KPI (on prod, ₱6,300 of a ₱17,130 total; the ₱10,830 gap = 19 bundles).
- **Presentation-only fix (no schema or write-path change, dashboard is
  read-only).** `topProducts` now also reports `bundledUnits` (units from ₱0
  lines), and a new `bundleSalesSummary` reconciles itemized product revenue with
  the KPI (`itemizedRevenue + bundleRevenue = totalRevenue`, by construction).
  The panel now: carries an info tip that the money column is itemized only;
  annotates rows whose units include bundle picks ("N of these units were
  bundled"); and adds a **"Bundle deals"** row plus a reconciliation line so the
  panel ties back to Revenue.
- **Heuristic + scope.** A ₱0 line is treated as a bundle pick (true on prod
  today; genuine freebies would be misattributed until the write path is fixed).
  **Not** backfilling the historical ₱0-component orders, and **rejected**
  splitting a bundle's price across its picks (fabricates a false-precise figure).
  The root-cause POS write-path fix (emit a real `bundle_id` line) and a future
  "Top bundles" panel are deferred follow-ups. Full RCA + sequencing in
  `COOP_INTEGRATION_PLAN.md` ("RCA + FIX" block).
- Verified: typecheck clean, 110 tests pass (+3), production build green, and the
  reconciliation invariant confirmed against live Staging data.

## 2026-09-11 — Gamified daily-target health bar (Phase 5 Surface E, Staging only) — `feat(offline-sales)`

- **New "Daily target" health bar** showing **today's POS revenue vs an owner-set
  peso goal**, with a fill that escalates red → amber → lime → emerald as the day
  closes on the target, a `%`, and a `₱X of ₱Y · ₱Z to go` readout. **Full bar
  (with an inline goal editor)** sits atop `/offline-sales`; a **compact,
  read-only strip** leads the home landing. v1 is progress + color tiers only
  (no milestones, streaks, or levels).
- **"Today" is the Asia/Manila calendar day** (resets at local midnight), computed
  in a new `src/pos-target-compute.ts` module. This is deliberately independent of
  the Offline Sales range tabs, which still use UTC, so the bar and the "Today"
  tab can differ for sales between 00:00 and 08:00 Manila (accepted for v1).
- **Editable target, DB-backed.** New additive `pos_settings` table (key/value) +
  `set_pos_daily_target` RPC on Staging (RLS on, anon-read policy; writes flow
  through the SECURITY DEFINER RPC like every other `pos_*` write). Seeded at
  ₱5,000. `set_pos_daily_target` is the only new schema; the four Coop tables and
  the ten existing `pos_*` tables are untouched. `zoomy-pos/supabase/pos_schema.sql`
  mirrors it. **Not applied to prod.**
- **Fail-soft by construction.** Both page reads wrap the target/progress fetch in
  try/catch → `null` → the bar is simply omitted, so a missing or failing
  `pos_settings` can never 500 a page that otherwise renders (matches the offline
  isolation already used on the home Overview). `pos-sales-compute.ts` and
  `getPosOrders` are reused (not modified); the landing shares the React-cached
  orders fetch, adding no extra query.
- New files: `src/pos-target-types.ts`, `src/pos-target-compute.ts`,
  `src/pos-target.ts`, `src/pos-target-actions.ts`,
  `components/analyst/daily-target-bar.tsx`. Verified: typecheck clean, 107 tests
  pass (+11 for the Manila-day boundary, tiers, and overflow math), production
  build green, and the target read/write round-tripped live against Staging.

## 2026-09-11 — Offline Sales: IG handle, color-coded methods, void + restock — `feat(offline-sales)`

- **IG / furbaby handle** now shows on each transaction (a 🐾 chip) when set.
  Requires the cross-repo change: `pos_orders` gained a `customer_handle`
  column, `apply_pos_order` persists it, and the POS pushes it (see the POS
  changelog). Only appears on sales made *after* that ships — past synced sales
  have none. Remarks were already displayed; both now read clearly.
- **Payment method badges are color-coded** (`paymentMethodBadgeClass`): Cash
  green, QRPH violet, GCash blue, Maya teal, Card amber, BPI rose, Bank slate —
  muted tints, readable in both light and dark themes.
- **Void a sale from Coop** (new `voidOrderAction` → the shared `void_pos_order`
  RPC), with a confirm. **Voiding now restocks**: `void_pos_order` was
  redefined to reverse the sale's FEFO inventory decrements (add each qty back
  to the lot it came from) and log compensating stock movements — idempotent, so
  a re-void never double-restocks. This applies to POS-side voids too, since
  both call the same RPC (previously no void restored stock anywhere).
- Verified end-to-end against Staging in a real browser: a sale decremented
  stock, the in-app Void restored it exactly, and the row flipped to voided.
  `tsc`, 96 tests, and the production build all pass.

## 2026-09-10 (develop only — not yet promoted to staging)

### Product Controls: breathing room in the header and table — `fix(products)`
- The header row (product count + description, "Updated Xs ago" + Refresh +
  New product) had no gap between the two sides — at some viewport widths the
  description text ran right up against "Updated just now". Switched to
  `flex-wrap` with an explicit gap (matching the pattern already used on the
  Offline Sales header), so the two sides always keep a clear gap and wrap
  onto their own line on narrow viewports instead of colliding.
- The 8-column table (SKU/Emoji/Name/Line/Category+Subcategory/Price/Stock/
  Listed) was being squeezed by the page's `max-w-5xl` container: Name wrapped
  onto 3+ lines and the Listed toggle sat flush against the card's right edge
  with no margin. Widened Product Controls (and Bundles below it, kept in
  sync so the two sections still line up) to `max-w-6xl`, gave the table and
  its Name column sensible minimum widths, and added extra right padding on
  the Listed column. At typical desktop widths this now fits with real
  breathing room and no horizontal scroll; on genuinely narrow viewports the
  existing `overflow-x-auto` still scrolls the table horizontally instead of
  squishing columns unreadable. Verified in a real browser at 1897px (no
  scroll, comfortable spacing) and 900px (table correctly scrolls).

### Live Refresh + filters on Product Controls — `feat(products)`
- Product Controls (and the Bundles section below it) previously only showed
  what was loaded on the initial page request — a POS-side edit (reprice,
  stock, listing) wasn't visible until a full browser reload. Added the same
  `RefreshControl` pattern the Offline Sales transactions page already uses:
  a button that calls `router.refresh()` to re-fetch server data in place,
  with an "Updated Xs/mins ago" label. `BundleControls` gained the matching
  `useEffect` re-sync (it was missing one, so a refresh silently wouldn't
  have updated it) so one Refresh button covers both sections.
- Added a filter bar above the Product Controls table: a name/SKU search,
  Category pills (mirroring the POS's own tabs), a Subcategory pill row
  (Freeze Dried only), a Listed/Unlisted status pill, and a stock-range
  popover. Unlike the transactions filter bar (which is URL-param-driven
  because it's server-paginated), this is local component state — the whole
  catalog is already loaded in one request, so narrowing it is a pure
  in-memory filter with no extra round-trip. New `src/pos-product-filter.ts`
  holds the pure filter logic + types (unit tested, 12 new tests) and
  `components/analyst/product-filters.tsx` holds the UI, both following the
  existing `pos-sales-compute.ts` / `transaction-filters.tsx` split.

### QRPH payment label + filter — `feat(offline-sales)`
- Added **QRPH** to `paymentMethodLabel` and `ORDER_METHOD_FILTERS`, matching
  the new POS payment method (a generic QR tap). Old GCash/Maya/Card records
  are unaffected — this only adds a label/filter for the new value going
  forward.

### Chopsticks + ice cube added to the emoji palette — `feat(products)`
- Added 🥢 and 🧊 to `PRODUCT_EMOJIS` in `pos-format.ts`, matching the POS's
  palette (`constants/emoji.ts`).

## 2026-09-09 (develop only — not yet promoted to staging)

### Bundles section on Product Controls — `feat(bundles)`
- Added a **Bundles** component under Product Controls that reads the bundles
  synced from the POS (`pos_bundles`): shows each bundle's emoji (tap-only
  picker), name, type (Buy Any N / Fixed), price, listed toggle, and delete.
  Editing writes to `pos_bundles` (emoji/name/price/active via direct update,
  delete via the shared RPC) so changes mirror back to every POS device.
  Bundle creation stays in the POS. Added `getPosBundles`, `PosBundleRow`, the
  bundle actions, mock bundles, and 🍐 to the emoji palette.

## 2026-09-09

### Emoji picker is tap-only (no typing) — `fix(products)`
- The emoji column and New Product field were plain text inputs — you can't type
  an emoji on a desktop keyboard. Replaced both with a **tap-only picker**
  (`EmojiPicker`): a popover with a curated emoji grid, a live preview, and a
  backspace; tap up to 3. Curated set lives in `pos-format.ts`.

### Product Controls: emoji on create + edit — `feat(products)`
- Product Controls gains an **Emoji** column (editable inline, 1 to 3 emoji) and
  an emoji field on the New Product form. Written directly to the new
  `pos_products.emoji` column (service role). The POS reads it to seed a new
  tile; existing POS emoji edits are preserved on sync.
- Added `clampEmoji` / `parseEmoji` helpers (grapheme-aware, capped at 3) and a
  `setEmojiAction`. `PosProductRow` + reads + mock carry the emoji.

### Design critique follow-ups: edit safety, tile consistency, home & footer — `feat(ui)`
Acting on the Impeccable UI critique (30/40; "authored, not slop") — four of the
five priority fixes (compare-view overload deferred):
- **P0 · Product Controls edit safety.** Price/unlist edits no longer apply
  silently. Each row now flashes a **"Saved"** chip on success, unlisting asks
  for **inline confirmation** first (it hides a product from the POS), an
  **Undo toast** reverses an unlist, and edit **errors anchor under the offending
  row** instead of a single bar at the top of the table. Decision: match the
  repricer's existing reassurance (confirm/undo/guardrails) on the one surface
  that writes to a live catalog.
- **P1 · One canonical metric tile.** Added `components/analyst/metric.tsx`
  (`Metric`, `metricValueClass`, `MetricDelta`) and pointed the six divergent KPI
  dialects (`KpiTile`, `FigureTiles`, `CombinedKpis`, offline `Kpi`, repricer
  `StatCard`, and the home stat) at it, so every value renders in the house serif
  face. Removed the now-dead `Delta` in `sections.tsx`. Fixes the inconsistency
  that dragged heuristic #4 (Consistency) to 2/4.
- **P3 · Home leads with the verdict.** `home-landing.tsx` now opens with the
  real synthesized `digest.headline` (not a generic "Coop Intelligence" panel),
  retired the `animate-ping` live-dot and the `Sparkles` "AI analyst" bullets —
  the only AI-slop signifiers the critique flagged.
- **P3 · Health footer is no longer a text wall.** The trailing 200-word "how
  it's calculated" prose on Business Health is now a collapsed
  **`<details>` disclosure**, so the view resolves on its charts/cards, not a wall
  of caveats. (The other two views' "footers" were already one-liners.)

Verified: `tsc --noEmit` clean, 84 tests pass, Impeccable detector clean on all
changed files. No schema/data changes. Deferred: P2 (channel-compare overload).

### Offline Sales: status (voided) filter — `feat(offline-sales)`
- Added a **Status** filter (All / Completed / Voided) to the transactions bar,
  so you can show voided sales only. Applies server-side alongside the other
  filters (count + rows), URL-driven, and is cleared by "Clear filters".

### Offline Sales: refresh control + last-loaded time — `feat(offline-sales)`
- Added a **Refresh** control on the Offline Sales overview and the orders
  subpage. It re-fetches the server data in place via `router.refresh()` (no
  full page reload, spins while pending) and shows a relative **"Updated …"**
  timestamp of when the data was last loaded (stamped server-side per render).

### Reflect POS voids + remarks — `feat(offline-sales)`
- Read `status` / `remarks` from `pos_orders`. **Voided sales are excluded from
  revenue and every aggregation** (KPIs, daily sales, top products, and the
  offline Business Health / Compare Channels metrics that derive from them).
- Voided orders still appear in the orders list and Recent orders panel, shown
  **struck-through with a "voided" badge**; a POS **remark** renders inline
  under the order.
- **Decision:** a void means the sale didn't count, so it drops out of Coop
  revenue; it stays visible (struck-through) for audit.

### Offline Sales: cap "Recent orders" at 5 — `fix(offline-sales)`
- The "Recent orders" panel on the Offline Sales overview listed up to 12 rows,
  making it very long. Capped it at 5 (the full history is behind "View all").

### Offline Sales: date-range calendar picker — `feat(offline-sales)`
- Replaced the Today/7d/30d date presets with a **date-range calendar popover**
  on the All-transactions list (two-pick inclusive range, future days disabled,
  Apply/Reset). Added a themed `Calendar` primitive.
- **Timezone fix:** picked calendar days convert to absolute instants in the
  viewer's timezone (start-of-day → end-of-day) before hitting the URL, so a
  range matches the local times shown in the list (e.g. a Philippine morning
  sale that is the previous day in UTC). Verified with `TZ=Asia/Manila`.
- **Decision:** custom themed calendar rather than native `<input type=date>`
  (renders unthemed on dark UI) or a date library (unneeded dependency).

## 2026-09-08

### Offline Sales: filter + paginate transactions — `feat(offline-sales)`
- Added a filter bar above the "All transactions" list: payment-method pills
  (All / Cash / GCash / Maya / Card), a date filter, and a **price range**
  popover (two-thumb Base UI slider + min/max inputs).
- Filters live in the URL and apply **server-side to both the count and the row
  query**, so pagination stays correct; the pager preserves active filters.
- **Page size set to 10**, newest first (was 25).
- **Decision:** URL-search-param filters (shareable, refresh-safe) matching the
  existing pill pattern; added a `RangeSlider` primitive on `@base-ui/react`.

### Surface the POS payment method — `feat(offline-sales)`
- Read `payment_method` from `pos_orders` and show a method badge next to each
  transaction on the Offline Sales orders list (null legacy rows read as Cash).
  Depends on the POS-side `pos_orders.payment_method` column (see the POS
  changelog).

## 2026-09-07

### Product controls + navigation — `feat(products)` / `feat(nav)` / `feat(brand)`
- Product controls: editable stock, product-line dropdown, new-product stock
  field, and Category/Subcategory controls (Coop drives the POS tab).
- Navigation: expandable drawer nav with labels; Overview accordion with a
  collapsed-rail flyout submenu and a rest-state chevron affordance; Business
  Health back button; centered rail toggle; snappier interactions.
- Added the Coop favicon.

### Offline reporting (Phase 5) — `feat(offline-reporting)`
- Offline (POS) sales data layer + aggregation helpers; Offline Sales page;
  stock-alerts card; Offline channel card on Overview; Offline as a 4th Business
  Health channel; Offline in the Overview Compare Channels chart (shown by
  default); paginated transactions subpage. Regression-review findings
  addressed; em-dashes removed from UI copy per review.

---

_Earlier history predates this changelog; see the git log._
