# Coop — Product Documentation

> **Coop · BrandOS** — the Brand Operating System for Zoomy Treats. Coop turns raw commerce data across **Shopee, Lazada, and the Zoomy website** into a weekly, grounded store-ops brief: what happened, why, and exactly what to do next — plus a data-grounded chat assistant.

---

## 1. Overview

Coop is a small-scale, **batch analytical observability platform** for a multi-channel e-commerce brand. Every reporting period it ingests each channel's numbers, synthesizes them into one grounded digest, archives it, and renders it as an editorial dashboard. On top of that sits **Chat with coop** — an assistant that answers questions strictly from that period's data.

**Who it's for:** a non-technical shop owner who wants one calm answer to *"what should we do today?"* instead of five dashboards.

**What makes it different:**

- **Grounded-or-throw synthesis.** Every figure in the digest traces back to a real source number; the model cannot fabricate metrics (a validation step rejects any ungrounded value).
- **Cross-channel, apples-to-apples.** Shopee, Lazada, and Website are normalized into one comparison (revenue, orders, AOV, units, **ad spend, ROAS**).
- **Action-first.** Every recommendation is a one-click **playbook** — an ordered checklist a non-technical owner can follow.
- **Ask anything.** Coop chat answers from the loaded digest only, cites the metric, and refuses to guess.

### Channels at a glance

| Channel | Source | Sales | Ads (spend / ROAS) | Per-SKU ranking |
|---|---|---|---|---|
| **Shopee** | Manual Seller-Centre CSV/XLSX exports | ✅ | ✅ (Ads Overall export) | ✅ (parent-SKU export) |
| **Lazada** | Open Platform API (auto-refresh token) | ✅ | ✅ (Sponsored Solutions API) | ✅ (GetOrders + GetOrderItems) |
| **Website** | Shopify orders + PawPal chat transcripts | ✅ | ⏳ deferred (Meta) | ✅ |

---

## 2. The Journey — a period in Coop

A typical loop, from the owner's chair:

1. **Sign in** with Google (`Continue with coop`). Access is gated to authorized accounts.
2. **Home brief — "What should we do today?"** A calm landing with a **Sales** card (all three channels) and a **Marketing** card (coming soon). Coop chat here is in *getting-started* mode — it orients you, it doesn't dump numbers.
3. **Open Sales →** the **unified channel overview** for the selected period:
   - **Header band:** the date range, channel filter chips (Shopee / Lazada / Website), and compact KPIs (Total revenue · Orders · Blended AOV) in editorial serif.
   - **Compare Channels chart:** a metric segmented control — **Ad spend · ROAS · Revenue · Orders · AOV · Units** — with vertical, gradient bars per channel.
   - **Top products by revenue:** a tabbed per-channel SKU ranking.
   - **Recommended actions:** a 2-column board of channel-tagged actions, reordered so the ones relevant to the on-screen metric come first.
4. **Act on a recommendation.** Click any action → a **playbook drawer** slides over with an ordered, checkable how-to. Progress is saved; a green **✓ Done** badge appears when every step is checked, and the home "Actions" stat counts done/total.
5. **Ask coop** anything — from the top-bar pill or the bottom-left button. The chat opens on the side you invoked it from, streams a grounded answer, and offers follow-up chips and one-click navigation.
6. **Change the reporting period** from the top-bar picker; the same view reloads for the new window.

---

## 3. Architecture

Coop is two deployed systems sharing one archive.

```
┌─────────────────────────── BATCH (zoomy-observability) ───────────────────────────┐
│  Ingest per channel                Synthesis                     Persist          │
│  • Shopee: Seller-Centre exports   • buildSynthesisPrompt   →     digest_archive   │
│  • Lazada: Open Platform API       • Claude (streaming)          (Supabase, shared)│
│  • Website: Shopify + PawPal       • grounded-or-throw           row = one digest  │
│  → salesSignals / shopeeSignals    • reconcile* stamps FACTS                        │
│    lazadaSignals / customerSignals    (windows, topProducts, comparison, ads)      │
└───────────────────────────────────────────────────────────────────────────────────┘
                                   │  (additive digest shape)
                                   ▼
┌──────────────────────── DASHBOARD (observability-dashboard) ──────────────────────┐
│  Next.js (App Router) on Vercel                                                    │
│  • getDigests()  → PII-masked read of digest_archive                               │
│  • Unified channel overview, playbooks, top products                               │
│  • Chat with coop  → POST /api/chat → Claude (streaming), grounded in the digest   │
│  • Google auth (Auth.js) gates every page + the chat API                           │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Key contracts**

- **One shared archive.** Both this dashboard and a second (Dave's) read the same `digest_archive`. Every synthesis change is therefore **additive-only** — new optional fields, never a changed shape — so an older reader never breaks.
- **Facts are stamped, not generated.** Windows, per-SKU rankings, ad metrics, and the normalized cross-channel `comparison` block are written into the digest **after** synthesis, straight from the source signals. The model narrates; it never invents these numbers.
- **Long-context, not RAG.** At this scale (one digest ≈ a few KB) Coop chat stuffs the whole period's digest into context rather than running a vector store — simpler, cheaper, and exact.

---

## 4. The Engine — data & synthesis

### 4.1 Per-channel signals

Each channel produces a **sibling signal block** that degrades to empty and never throws:

- **`salesSignals`** (Website / Shopify): windowed revenue, orders, AOV, units, top products, rising/declining movers, discount depth.
- **`shopeeSignals`**: `sales`, `ads` (spend, GMV, ROAS, ACOS, impressions, clicks), `traffic`, `products` facets + a per-SKU `productRanking` from the parent-SKU export.
- **`lazadaSignals`**: `sales` (from GetOrders + GetOrderItems, incl. `topProducts`), `finance`, `inventory`, and `ads` (Sponsored Solutions store report).
- **`customerSignals`**: VIP / at-risk / new segments, outreach with masked names and marketing consent.

### 4.2 Synthesis & grounding

`synthesize()` builds a prompt from the signals, calls Claude (**streaming**, adaptive thinking), and then runs a chain of guards:

1. **`validateGrounding`** — every figure the model emits must be a real number from the source block, or the run throws. No fabricated metrics survive.
2. **`reconcileConsent`** — customer email-consent is stamped from the CRM, not the model.
3. **`reconcile*Windows`** — each facet's real date range is stamped from the export/pull.
4. **`reconcileTopProducts`** — per-SKU rankings stamped from signals (Shopee parent rows, Lazada order items), sorted & capped.
5. **`reconcileComparison`** — a normalized cross-channel block (`{revenue, orders, aov, units, adSpend, roas}` per channel) so the dashboard reads structured facts, not label-matched figures.

The result is one **`DigestDocument`** archived as a row. Recommendations are objects — `{action, steps[]}` — where `steps` is the ordered playbook checklist.

### 4.3 Ads integration (the important lever)

| Channel | Mechanism | Notes |
|---|---|---|
| **Shopee** | "Ads Overall" CSV export → `shopee.ads` | Spend / GMV / ROAS / ACOS already parsed. |
| **Lazada** | `getSponsoredReport` → `/sponsor/solutions/report/getReportOverview`, `bizCode: sponsoredMax` | The combined on-platform aggregate (Sponsored Max + Mega Sales Accelerator + Sponsored Discovery). Report table lags the seller-center UI by ~1 day. |
| **Website** | ⏳ Deferred | Needs Meta Marketing API (`/insights` on the ad account) or a manual Ads-Manager CSV. The Shopify Facebook app does **not** expose spend. |

---

## 5. Walkthrough — dashboard features

### Unified channel overview
One view merges all three channels with a filter. Selecting **one** channel drills into its full detail; **two or more** shows the compact comparison layout (recommendations sidebar + comparison chart + top products).

### Compare Channels chart
A segmented metric control with an iOS-style spring-sliding green indicator. Bars are vertical, gradient-filled in each channel's accent (Shopee red · Lazada blue · Website green), over faint gridlines. Ad metrics render every channel (0 bars when a channel has no spend).

### Top products by revenue
A tabbed card (Shopee / Lazada / Website), each a numbered ranking with full product titles (never truncated), proportional bars, revenue and units.

### Recommended actions & playbooks
Channel-tagged action cards, reordered by the active chart metric. Each card shows a step count / live progress; clicking opens the **playbook drawer** — an ordered, checkable how-to whose progress persists (localStorage) and reflects back as badges and the home "Actions" stat.

### Chat with coop
See §6.

### Editorial polish
Coop / BrandOS design language: cream canvas, forest-green accent, Inter for UI + Newsreader for editorial figures; semantic color on unambiguous danger metrics (ACOS, bounce rate); a one-time intro splash; light/dark theme toggle.

---

## 6. Chat with coop

A data-grounded analyst assistant. **Streaming** answers from **Claude Opus 4.8**, grounded in the selected period's digest plus compact trend rows for prior periods.

**Behavior & guardrails**

- **Scope-locked** to the store's own data; off-topic requests get a Coop-voice refusal.
- **Grounded-numbers-only** — cites the metric; if a figure isn't in the data, it says so.
- **PII stays masked**; no medical/legal/financial advice; no live actions beyond the digest.
- **Prompt-injection hardened** — treats user messages as data, refuses role-override / prompt-reveal.
- **Home vs channel mode** — on the home screen Coop has *no* period loaded and orients the user; inside a channel view it's fully grounded.

**UX**

- Two entry points that read as the same action: a top-bar **Ask coop** pill and an always-visible bottom-left button (both with a shine sweep). The drawer **opens on the side you invoked it from** so it never covers the content you're reading.
- **Multi-turn**, persisted across reloads, with a scope line ("Answering about …"), **New chat**, **Copy**, and **markdown** (incl. tables).
- **Stop** streaming (keeps the partial answer) and **Regenerate**.
- **Follow-up chips** and one-click **navigation buttons** (Coop can take you to Sales / a channel / a page — allowlisted routes only).

**Data flow:** `POST /api/chat` (Node runtime) → session check → `getDigests()` (PII-masked) → `buildCoopSystemPrompt(rows, week, {home})` → streamed Claude response.

---

## 7. Ops — running & deploying

### Batch (`zoomy-observability`)
- **Run a digest:** `npm run digest` (env from `.env`; `SINCE_DAYS=30`). Shopee exports live in `data/shopee/`; Lazada pulls via the API with an auto-refreshed token.
- **Output:** synthesizes and writes one row to `digest_archive`. Degrades and reports rather than losing the digest.
- **Tests:** `npx vitest run` (200+ tests; grounding, parsers, reconcilers).

### Dashboard (`observability-dashboard`)
- **Next.js on Vercel.** `getDigests()` reads the archive (service-role, server-side) and masks PII before it reaches the browser.
- **Redeploy after env changes** — Vercel applies new env vars only to builds created after they're added.

### Required environment

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_URL_ARCHIVE` / `SUPABASE_SERVICE_ROLE_KEY_ARCHIVE` | Dashboard + Batch | Read/write the shared archive |
| `ANTHROPIC_API_KEY` | Dashboard + Batch | Synthesis + Chat with coop |
| `AUTH_SECRET` | Dashboard | Auth.js session signing (`openssl rand -base64 33`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Dashboard | Google OAuth client |
| `ALLOWED_EMAILS` | Dashboard | Optional sign-in allowlist (comma-separated) |
| `LAZADA_APP_KEY` / `LAZADA_APP_SECRET` | Batch | Lazada API + token refresh |

---

## 8. Security

- **Authentication.** Google sign-in via Auth.js gates **every page** (middleware → `/signin`) and the **chat API** (401 without a session). Optional `ALLOWED_EMAILS` allowlist.
- **PII masking.** Customer names are masked **server-side** in `getDigests()` before any data reaches the browser or the chat context — fail-closed on every route.
- **Secrets.** API keys and service-role keys are server-side only (never `NEXT_PUBLIC_`). The rotating Lazada refresh token lives only in Supabase.
- **Chat safety.** Scope-locked, grounded-only, prompt-injection-hardened; rate-limited per IP.
- **Shared-archive discipline.** Additive-only digest changes keep a second dashboard reading the same archive from breaking.

---

## 9. Limitations

- **Website ad spend (Meta)** is not yet wired — the ROAS comparison is Shopee + Lazada only.
- **Fixed 30-day window.** A 1-day / 1-week / 1-month selector is future work; the batch currently emits 30-day digests.
- **Lazada ad data lags ~1 day** (the API report table trails the seller-center UI).
- **Shopee & website ads/products need manual exports** for some facets (Seller-Centre files).
- **Chat rate limit is in-memory** (per instance / resets on cold start) — fine for a small team, not yet a shared store.
- **Auth on preview URLs.** Google OAuth only allows the exact production domain + localhost; sign-in won't work on Vercel preview links.

---

## 10. Roadmap

- **Meta ads → Website ROAS** (Marketing API or manual CSV) to complete the ad picture.
- **Flexible time ranges** (1-day / 1-week / 1-month).
- **Text-to-SQL / live querying** so Coop can answer beyond the digest.
- **Proactive alerts** — Coop flags anomalies (ACOS spike, ROAS drop, stockout) on load.
- **Marketing module** — the "coming soon" AI content studio (campaign briefs → production plans → image/video prompts).
- **KPI deltas & dashboard polish** — vs-prior-period trends, action filtering, and building out the Inventory / Customers / Traffic pages.

---

*Coop · BrandOS — a new way to run a brand.*
