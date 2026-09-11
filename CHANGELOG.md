# Changelog — Coop Dashboard

Notable changes to the Coop / BrandOS dashboard (`zoomy-observability-dashboard`).
The POS app has its own changelog in `../zoomy-pos/CHANGELOG.md`.

Conventions: work flows `feature → develop → staging` (never `main` without
sign-off); Conventional Commits; commits carry `Co-Authored-By: Claude` +
a `Claude-Session` trailer. Reads the shared Coop Supabase (Staging on the
`*-staging` deploy; PROD is the co-worker's project).

Dates are local working dates (GMT+8). Newest first.

---

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
