# Goldline Cosmetics — Onboarding Plan & Implementation Record

> Durable, version-controlled record of the plan to onboard **Goldline Cosmetics**
> (brand wordmark: **NICHIDO**) as a second, fully walled-off tenant on the Coop /
> BrandOS dashboard — plus the running status of what has actually been built.
>
> This file is the source of truth. The house-style visual plan + UI mockups live in
> a Claude artifact (sections 00–10): `https://claude.ai/code/artifact/f5686e30-61fe-45cf-98d2-f49d3345bacf`.
> If the two ever disagree, **this file wins** and the artifact should be updated.
>
> Last reconciled: **2026-10-06**. Read alongside the workspace `COOP_INTEGRATION_PLAN.md`.

---

## 0. The ask

Coop is single-tenant today (serves only Zoomy pet-treats; there is no company
dimension anywhere, and sign-in was a flat `ALLOWED_EMAILS` allowlist). Onboard
**Goldline Cosmetics** as a second tenant that is **fully walled off** from Zoomy:

- Role-based access so Zoomy people can't see Goldline data and vice versa.
- Goldline's data comes from **scanned/exported files**, not a POS app: a POS **sales
  CSV** and **handwritten semi-monthly inventory PDFs** (6-page NICHIDO form).
- Goldline gets the Coop features that transfer (sales/overview, inventory, a Stores
  page, chat, business health) and **not** the pet-/marketplace-specific ones.
- A data-blind **Coop Admin** manages companies & people but sees no business data.

**Why:** Coop is expanding from one brand to multi-tenant; Goldline has a totally
different data source (scans/forms) and a **store dimension** Zoomy lacks (Zoomy is
event/booth-based).

---

## 1. Locked decisions (the contract)

These are settled. Change them only deliberately.

| # | Decision |
|---|----------|
| **Isolation** | One **shared** Supabase project + a `company_id` tenant dimension. New `gl_*` / `company_*` tables carry `company_id`. **Never** alter Coop's four existing tables or any `pos_*` data. Legacy Zoomy rows are treated as `company_id = 'zoomy'`. |
| **The fence** | The dashboard reads Supabase with the **service-role key, which BYPASSES RLS**. So **app-level scoping by the active company_id is the PRIMARY fence** — enforced on every query. RLS-on-no-policies + the audit log are backstops, not the fence. Honest caveat: this is *not* operator-proof (operator-proof = separate projects, which was considered and **not** chosen). |
| **RBAC (v1)** | Exactly **two roles**: **Coop Admin** (cross-tenant, **data-blind**, manages companies & roles) and **Company User** (own company's data; upload/commit). *Company User = DB role `company_admin`; the UI label is "Company User".* **Analyst** and **Store Manager** exist in the schema/enum but are **deferred** (not provisioned). |
| **Multi-role** | A person can hold several roles (company role(s) and/or Coop Admin) and **switch the active view**. **Powers follow the active view only** (no union of capabilities — no cross-hat privilege bleed). |
| **Who grants roles** | **Only a Coop Admin** grants/changes/revokes roles (no company self-serve in v1). |
| **Sign-in gate** | **Membership-driven only** — you can sign in iff a Coop Admin has granted you a role (`company_users` row, non-suspended). **`ALLOWED_EMAILS` dropped.** The first Coop Admin is seeded directly in the DB. |
| **Scale** | **300 stores, 500 SKUs.** Store is first-class (region → area → store). Stores launch incrementally: ~2 (pilot) → ~20 → ~50 → … → 300. |
| **Ingestion** | No POS app. In-app upload: **CSV** parsed deterministically → `gl_sales`; **handwritten PDF** → Claude Vision → **review queue** (confidence-scored, human confirm) → `gl_inventory`. Idempotent on natural keys. Mobile camera **Capture deferred**. |
| **Infra** | Stay on **Supabase Pro**; compute tier tracks the store ramp (Micro ~$25 pilot → Small → Medium ~$75 near 300). Handwritten-PDF OCR = **Claude Vision** (model `claude-sonnet-5-5`), chosen over Textract/Google/Azure on accuracy, speed-to-build, and cost. |

---

## 2. Tenancy & isolation model

- **`companies`** — the tenant registry (`id` slug PK e.g. `zoomy`/`goldline`, name, status, theme jsonb).
- **`company_users`** — membership map. One row per `(user_email, company_id)`.
  `company_id = NULL` means the cross-tenant **Coop Admin**. Carries `role`
  (`company_role` enum), optional `store_scope text[]`, and `status`
  (`active | invited | suspended`).
- **Active view** — resolved per request from the user's memberships + an `active_view`
  cookie (a *hint*, always re-validated against real memberships → a cookie can never
  grant access). The data-blind Coop Admin is just one selectable view.
- **Zoomy is unaffected.** A single-company Zoomy user gets the exact legacy nav/behaviour;
  the switcher only appears for users holding >1 view.

Key modules: `src/company.ts` (pure: `resolveActive`, `membershipViews`, `viewKey`,
`canEditData`, `canManageRoles`, `outOfScopeStores`), `src/active-context.ts`
(server seam: `getActiveContext` / `getDataContext` / `getNavContext` /
`requireZoomyData`), `src/company-nav.ts` (`shouldRedirectFromZoomy`, `homeFor`).

### Tenant data-isolation guard
The legacy Overview/Health/Inventory/Sales/etc. pages read Zoomy data with **no
company dimension**, so a non-Zoomy viewer must never reach them. `requireZoomyData()`
(in transparent section-guard layouts on every Zoomy-only route + the root page)
redirects a non-Zoomy view to its home (`homeFor`: Coop Admin → `/admin/users`,
company → `/overview`). `/api/chat` 403s a non-Zoomy context; the "Ask Coop" pill is
hidden for non-Zoomy. The root `app/layout.tsx` only fetches Zoomy digests for a
Zoomy viewer (so Zoomy data never ships in the RSC payload to another tenant).

---

## 3. RBAC & role management (multi-role access, §10)

| Active view | Sees data | Edit / commit | Manage roles |
|---|:-:|:-:|:-:|
| **Coop Admin** (cross-tenant, data-blind) | — | — | ✅ |
| **Company User** (own company; DB `company_admin`) | own | ✅ | — |
| *Analyst (deferred)* | own | — | — |
| *Store Manager (deferred)* | own, scoped stores | ✅ (scoped) | — |

- **View switcher** in the top bar (shown when >1 view) + a canonical switcher on the
  shared **`/account`** "Your access" page (not Zoomy-guarded, reachable by all roles).
- **Coop Admin "Users & Roles" console** (`/admin/users`) — the only write surface for
  access: grant / change role / suspend / reactivate / revoke, **every write audited**
  to `company_user_audit`. Guardrails: can't remove/suspend the **last active Coop
  Admin**; can't suspend/revoke your **own** Coop Admin; a new email lands as
  `invited` and flips to `active` on first Google sign-in.
- **Revoke/suspend is authoritative in real time**: admin actions re-read the actor's
  roles from the DB (not the session token); the JWT refreshes memberships ~every 5 min
  with an 8h session cap.

---

## 4. Data model (`gl_*`, `company_*`) — grounded in the real Nichido files

Two source documents:
1. **POS sales** — a digital spreadsheet, store × SKU × period. Columns: Location,
   Location Desc, SKU Code, SKU Desc, Gross Sales Retail TY, Sales Units TY, Net of VAT.
2. **Semi-monthly INVENTORY** — a **handwritten** 6-page NICHIDO form. Per-SKU counts:
   stockroom/steelcab, drawer/module, selling area, delivery, ending-on-hand, total
   amount; + period, beauty consultant, store code. Pre-printed SKU rows. The form
   explicitly says *"Inventory Report hindi Sales report."*

Tables (all additive, `company_id` on every row, RLS on + service-role only):
- **`gl_stores`** — location dimension (numeric store_code + name e.g. `1 = CUBAO`; region/area **assigned**, not in the files).
- **`gl_products`** — catalog + the **crosswalk**: inventory `item_code` (e.g. `FBPP01`) ↔ POS numeric `sku_code` (e.g. `38005997`); product_line, variant/shade, unit_price, is_bestseller.
- **`gl_sales`** — detail, store × SKU × period (gross/units/net). Idempotent on the natural key.
- **`gl_inventory`** — store × SKU × semi-monthly cycle (the 5 handwritten counts; `total_value` is **derived** downstream as ending × price, never OCR'd).
- **`gl_uploads`** — every uploaded file (kind `pos_csv`/`inventory_pdf`, status, storage_path, page_count, reject_reason).
- **`gl_extractions`** — Claude Vision's per-page output, staged for human review before commit.
- **`company_digest_archive`** / **`company_business_health`** — per-company derived analytics (future P3 surfaces).

Key facts that shape the model:
- **No transaction count anywhere** → store summary is a pure **derived rollup**; avg-basket / per-transaction metrics are **not available**.
- Sales vs inventory are **separate sources, reconciled not derived** (ending stock ≠ sales; open counter).
- **Volume is modest**: ~150K rows/cycle max, ~1–2M/yr, ~1 GB/yr — trivial for Postgres.

SQL files: `supabase/companies.sql` (companies + company_users + `company_role` enum,
seeds Zoomy, migrates `pos_dashboard_users`), `supabase/goldline.sql` (the `gl_*`
tables), `supabase/multi_role.sql` (`company_users.status` + `company_user_audit` +
partial unique index: one Coop Admin per email). **All applied to Staging.**

---

## 5. Ingestion & Claude Vision

- **CSV** → `src/goldline-csv.ts` (`parseGoldlinePos`): dependency-free RFC-4180 parser,
  tolerant headers, thousands separators stripped, blank cells → null (not 0), rows
  missing store/SKU skipped. Commits idempotently to `gl_sales` (needs the period).
- **PDF** → Claude Vision (`src/goldline-extract.ts` pure prompt/manifest/schema +
  `src/goldline-extract-run.ts` live call). Same Claude **Messages API** — no separate
  service; the PDF is sent as a base64 `document` block + a **template-aware, prompt-cached**
  system prompt + a per-page **manifest** + `output_config` json_schema. Returns rows
  with per-field **confidence**. No training.
- **Template-aware = slot-filling**, not free reading: for each page we inject the
  printed item codes in order; the model fills a value-or-null per code. Guardrails:
  one row per manifest code (no add/skip), ints only, blank ≠ zero, column discipline,
  **no total math** (total_value null, derived later), footer page-match, ignore
  pre-printed marks (Bestseller/★/price), take the rewrite on strike-outs, fail-loud
  `{error}` if not a Nichido page.
- **Page auto-detection**: a cheap Vision call (`detectPage`) reads the footer
  "PAGE # N" → the route extracts with that page's manifest, so the user uploads any
  single page and it just works. Timeouts sized under the route budget (detect 20s +
  extract 85s < `maxDuration` 160s).
- **Pages 1–5** are inventory item pages (manifests enumerated from the blank
  templates). **Page 6 is the daily Sales Report** (a 31-day logbook), not inventory —
  handled as a clean out-of-scope skip (no manifest).
- **Confidence is a prompted heuristic, not calibrated** → a routing signal only. The
  real safety nets are the **human review queue** + reconciliation. Goal is fewer
  flags, not zero.
- **Upload validation**: only `.csv` / `.pdf` accepted; extension authoritative with a
  MIME-contradiction reject; 25 MB cap; stored in a private `goldline-uploads` bucket.
- **Review workbench** (`/uploads/[id]`): 2-column — a sticky scan preview (~28%,
  click to enlarge in a lightbox; served via a same-origin buffered proxy because the
  app CSP sets `object-src 'none'`) on the left, the editable rows table + document
  header (store/period) + confidence bar + commit on the right (~72%). Low-confidence
  cells flagged (with `alt` candidate); commit gated on valid rows + store scope.

---

## 6. Feature scope

**Included for Goldline:** Sales/Overview, **Stores** page (new), Inventory/forecast,
Business Health (QRR), Chat ("Ask Coop"), Uploads/ingestion.

**Excluded** (pet-/marketplace-specific): offline events, free-taste, prizes/spin-wheel,
marketplace repricer, Lazada/Shopify/website CRM, pet-mix/emoji. The overview
by-region breakdown is **parked** until the store ramp fills regions. Modules are
per-company capability flags.

---

## 7. Scale & cost (artifact §06)

- **Supabase Pro**; compute is the dial: Micro (~$25/mo) pilot → Small (~$30) →
  Medium (~$75) near full 300 → Large (~$125) only if heavy. Disk is a non-issue at
  ~1 GB/yr; the tier is about query speed + concurrency. PITR add-on ~$100/mo at go-live.
- **Claude Vision OCR** ~$0.01–0.05/page → ~43K pages/yr at full 300 ≈ ~$1.3K/yr
  (cents during the pilot). The real cost is review-queue human time, not tokens.
- **Why Claude over alternatives**: Tesseract too weak on handwriting; Textract
  Analyze-Document Forms = $0.05/pg ($0.07 w/ tables) and needs per-form config —
  pricier per page than Claude Sonnet (~$0.03) **and** more wiring. AWS (RDS+S3+glue)
  is roughly a wash on infra but loses on TCO and would mean re-platforming. OLAP
  (ClickHouse/BigQuery/DuckDB) only if 10× stores or interactive full-history analytics.

---

## 8. Implementation status (as of 2026-10-06)

**On `staging`** (everything below shipped feature → develop → staging, each PR CI-green
and regression-reviewed):

| Area | Status | Key files |
|---|---|---|
| Tenancy + RBAC foundation | ✅ shipped | `src/company.ts`, `auth.ts`, `supabase/companies.sql` |
| `gl_*` data model | ✅ applied to Staging | `supabase/goldline.sql` |
| CSV ingestion | ✅ shipped | `src/goldline-csv.ts` |
| Claude Vision extraction, pages **1–5** + auto-detect | ✅ shipped | `src/goldline-extract.ts`, `-run.ts` |
| Upload route (CSV→sales, PDF→vision→review), validation | ✅ shipped | `app/api/goldline/upload/route.ts`, `src/goldline-upload.ts`, `src/goldline-data.ts` |
| Uploads UI (list + review workbench + commit) | ✅ shipped | `app/uploads/**`, `components/analyst/uploads-view.tsx`, `upload-review.tsx` |
| Scanned-file preview (2-column, lightbox, same-origin proxy) | ✅ shipped | `app/api/goldline/uploads/[id]/file/route.ts` |
| Company/view switcher + active-view model | ✅ shipped | `components/analyst/company-switcher.tsx` (ViewSwitcher), `app/actions/company.ts` |
| Tenant data-isolation guard | ✅ shipped | section `layout.tsx` guards + `requireZoomyData` |
| Stores leaderboard (P4) + Overview (P3) | ✅ shipped | `src/goldline-analytics.ts`, `app/stores/**`, `app/overview/**` |
| Multi-role access + `/account` switcher | ✅ shipped | `src/active-context.ts`, `components/analyst/account-view.tsx` |
| Coop Admin "Users & Roles" console + membership-only gate | ✅ shipped | `src/admin-data.ts`, `app/admin/**`, `auth.ts` |
| Human-readable extraction errors | ✅ shipped | `humanizeExtractError` in `src/goldline-extract.ts` |
| Multi-role schema (status + audit + index) | ✅ applied to Staging | `supabase/multi_role.sql` |
| CI: GChat notify + PR template + Claude PR-description hook | ✅ on develop/staging | `.github/**`, `.claude/**` |

**Nothing has been promoted to `main` / PROD yet.**

### Staging DB seed (project `syxwixxzmytvhwhkwdvw`)
- Companies: `zoomy`, `goldline` (Goldline Cosmetics).
- `goldline` catalog seeded: **5 `gl_stores`** (CUBAO, MAKATI, QUEZON CITY, CEBU,
  DAVAO) + **6 `gl_products`** (with the item_code↔sku_code crosswalk).
  **`gl_sales` / `gl_inventory` intentionally left EMPTY** — populated by manual
  CSV/PDF upload testing.
- Test accounts (Google sign-in): `lanceamiel.candelaria@stratpoint.com` =
  **Coop Admin + Zoomy Company User + Goldline Company User** (multi-role). The two
  earlier `@gmail.com` test accounts were removed.

---

## 9. What's left

### Unbuilt (vs plan — real feature gaps)
1. **Goldline Business Health / QRR** surface — not built.
2. **Goldline Inventory / forecast *view*** — PDF review commits to `gl_inventory`, but
   there's no read-back page yet.
3. **Goldline Chat ("Ask Coop")** — the plan wants it, but it's currently **403'd for
   non-Zoomy** (it reads Zoomy digests). Making it real for Goldline needs a
   `gl_*`-backed chat context — a design + build still to do.
4. **Committed inventory → Overview/Stores numbers** — the analytics surfaces read
   `gl_sales`; wiring in committed `gl_inventory` (stock on hand) is open.
5. **Click-to-apply "alt" hints** in the review editor — nice-to-have, not built.

### Caveat (needs live validation)
- **Manifests for pages 2–5** were transcribed from the *blank* templates and have
  **not been validated against a filled page 2–5 live**. Page 1 is proven. The first
  real upload of each of pages 2–5 is the true test; a wrong/missing code is a one-line
  manifest fix in `src/goldline-extract.ts` (`MANIFESTS`).

### Deferred by design (backlog)
- **Analyst** and **Store Manager** roles (store-scope logic is coded via
  `outOfScopeStores`, but the roles aren't provisioned).
- Mobile camera **Capture**.
- Overview **by-region** breakdown (until the store ramp fills regions).

### Pending user / ops actions
- **Set staging auth env** on the `coop-brand-os` Vercel project: `AUTH_SECRET`,
  `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` (and add the staging callback URL to the Google
  OAuth app; allow external emails if any non-stratpoint testers). **This is the current
  blocker to logging in on staging** (the membership-only gate is in).
- **Rotate the Anthropic API key** (the one shared in chat must be treated as
  compromised) and set `ANTHROPIC_API_KEY` in staging Vercel — needed for the PDF
  extraction path *and* Ask Coop Explore.
- Verify staging `SUPABASE_URL_ARCHIVE = syxwixxzmytvhwhkwdvw` (known gotcha: it once
  pointed at prod).
- Promote `companies.sql` + `goldline.sql` + `multi_role.sql` to **PROD** when ready,
  then `staging → main`.

---

## 10. Rollout & safety

- **Branch flow:** feature → `develop` → `staging` → `main`. **Every** merge into a
  shared branch is a PR with **CI green** (no direct pushes). Ask before merging shared
  branches. (Workspace `CLAUDE.md` → Contributing.)
- **Staging-first, additive-only.** New schema (`pos_*`, `gl_*`, `company_*`) lands on
  Staging (`syxwixxzmytvhwhkwdvw`) via a reviewed PR first; **never** alter Coop's four
  existing tables or `pos_*` data.
- Each code slice is regression-reviewed (a `code-reviewer` agent; no dedicated
  `regression-reviewer` agent exists in this environment).
- **Rollback** is a revert of the promotion merge — all schema is additive (new tables /
  columns / indexes), nothing existing is touched.

---

## 11. Risks & open questions (artifact §09)

- **Operator data access** — the shared-DB + service-role design is app-layer + audit
  isolation, **not** operator-proof. Accept, or go operator-proof with separate projects
  per company (not chosen).
- **SKU crosswalk & region** — the POS numeric `sku_code` must be mapped to inventory
  `item_code` in `gl_products`; region isn't in the files and is assigned per store. Both
  need maintenance as the catalog/stores grow.
- **Handwriting accuracy** — what error rate is acceptable, what threshold forces review,
  who staffs the queue.
- **Store hierarchy** — is there a defined region → area → store taxonomy + metadata to
  seed from?
- **Per-company LLM spend** — each brand multiplies digest + vision cost; worth a rough
  budget before heavier P3.

---

## 12. Provenance

- **Plan artifact (visual, mockups):** `https://claude.ai/code/artifact/f5686e30-61fe-45cf-98d2-f49d3345bacf`
- **Auto-memory:** `goldline-onboarding-plan` (session-persistent decision log).
- **Real source files:** workspace `Nichido /` folder (POS sales export, 6-page
  inventory form blanks + scanned examples).
- **Related:** workspace `COOP_INTEGRATION_PLAN.md`; `docs/coop-documentation.md`.
- This record was reconciled against the shipped code on 2026-10-06; keep it updated as
  the remaining items in §9 land.
