-- LOCAL ONLY. A minimal digest_archive (same shape as zoomy-observability/supabase/digest_archive.sql) with FICTIONAL rows,
-- so Ask Coop's get_digest can be exercised end to end. Re-runnable. Never apply to a hosted project.
-- The `bundle` column holds a marker on purpose: the E2E proves no chat read ever selects it (grep the results for it).
create table if not exists public.digest_archive (
  id           uuid primary key default gen_random_uuid(),
  window_from  timestamptz not null,
  window_to    timestamptz not null,
  bundle       jsonb not null,
  digest       jsonb not null,
  created_at   timestamptz not null default now(),
  unique (window_from, window_to)
);
alter table public.digest_archive enable row level security;   -- no policies: service role only, like the real table

-- Two weekly digests (latest = Sep 21 to 27, previous = Sep 14 to 20). All figures are invented.
insert into public.digest_archive (window_from, window_to, bundle, digest, created_at) values
(
  '2026-09-21T00:00:00Z', '2026-09-27T23:59:59Z',
  '{"marker": "SHOULD-NEVER-BE-SELECTED", "evidence": [{"quotes": ["SHOULD-NEVER-BE-SELECTED customer@example.test"]}]}'::jsonb,
  $d1${
    "window": {"label": "week of Sep 21 to 27", "from": "2026-09-21T00:00:00.000Z", "to": "2026-09-27T23:59:59.000Z"},
    "degraded": false,
    "headline": "Lazada and Shopee both grew; Lazada led on revenue.",
    "themes": [{"theme": "joints", "displayName": "Joint pain", "quote": "FICTIONAL verbatim quote about stiff hips", "conversationId": "local-1"}],
    "comparison": {
      "shopee":  {"revenue": 18400.5, "orders": 41, "aov": 448.8, "units": 77, "adSpend": 3100, "roas": 2.9},
      "lazada":  {"revenue": 26250, "orders": 52, "aov": 504.81, "units": 96, "adSpend": 4200.25, "roas": 3.4},
      "website": {"revenue": 9120, "orders": 14, "aov": 651.43, "units": 25, "adSpend": null, "roas": null}
    },
    "figures": [
      {"label": "Conversations this week", "value": 37, "timeBasis": "window"},
      {"label": "Joint pain mentions", "value": 8, "timeBasis": "recurring"},
      {"label": "Total conversations (all-time)", "value": 412, "timeBasis": "allTime"}
    ],
    "recommendations": ["Restock Joint Support Chews before the weekend."],
    "sales": {
      "headline": "Website revenue was steady.",
      "figures": [
        {"label": "Net revenue this week (PHP)", "value": 9120, "timeBasis": "window"},
        {"label": "Orders this week", "value": 14, "timeBasis": "window"},
        {"label": "Revenue change vs prior week (%)", "value": 5, "timeBasis": "window"}
      ],
      "topProducts": [{"title": "Joint Support Chews", "revenue": 2400}, {"title": "Freeze Dried Munchies", "revenue": 1750.5}],
      "watch": [], "recommendations": []
    },
    "customers": {
      "headline": "Two new customers.",
      "figures": [
        {"label": "New customers this week", "value": 2, "timeBasis": "window"},
        {"label": "Total customers (all-time)", "value": 64, "timeBasis": "allTime"}
      ],
      "outreach": [{"name": "Maria Santos", "list": "vip", "canEmail": true, "note": "FICTIONAL outreach note"}],
      "recommendations": []
    },
    "shopee": {
      "sales": {
        "headline": "Shopee sales were healthy.",
        "figures": [{"label": "Sales (PHP)", "value": 18400.5, "timeBasis": "window"}, {"label": "Buyers", "value": 38, "timeBasis": "window"}],
        "recommendations": [],
        "window": {"from": "2026-09-21", "to": "2026-09-27", "label": "21/09/2026 - 27/09/2026"}
      },
      "products": {
        "headline": "Two products led.",
        "figures": [{"label": "Active listings", "value": 12, "timeBasis": "window"}],
        "recommendations": [],
        "topProducts": [{"title": "Freeze Dried Munchies", "revenue": 5200, "units": 21}, {"title": "Meaty Treats", "revenue": 3900.5, "units": 15}]
      }
    },
    "lazada": {
      "sales": {
        "headline": "Lazada sales led all channels.",
        "figures": [{"label": "Sales (PHP)", "value": 26250, "timeBasis": "window"}, {"label": "Orders", "value": 52, "timeBasis": "window"}],
        "recommendations": [],
        "window": {"from": "2026-09-21", "to": "2026-09-27", "label": "21/09/2026 - 27/09/2026"},
        "topProducts": [{"title": "Joint Support Chews", "revenue": 7800, "units": 30}, {"title": "Meaty Treats", "revenue": 4100, "units": 16}]
      },
      "ads": {
        "headline": "Ads returned 3.4x.",
        "figures": [{"label": "Ad spend (PHP)", "value": 4200.25, "timeBasis": "window"}, {"label": "ROAS", "value": 3.4, "timeBasis": "window"}],
        "recommendations": []
      }
    }
  }$d1$::jsonb,
  '2026-09-28T01:00:00Z'
),
(
  '2026-09-14T00:00:00Z', '2026-09-20T23:59:59Z',
  '{"marker": "SHOULD-NEVER-BE-SELECTED"}'::jsonb,
  $d2${
    "window": {"label": "week of Sep 14 to 20", "from": "2026-09-14T00:00:00.000Z", "to": "2026-09-20T23:59:59.000Z"},
    "degraded": false,
    "headline": "A quieter week on every channel.",
    "themes": [],
    "comparison": {
      "shopee":  {"revenue": 15900, "orders": 36, "aov": 441.67, "units": 66, "adSpend": 2800, "roas": 2.6},
      "lazada":  {"revenue": 21400.75, "orders": 45, "aov": 475.57, "units": 80, "adSpend": 3900, "roas": 3.1},
      "website": {"revenue": 8700, "orders": 13, "aov": 669.23, "units": 23, "adSpend": null, "roas": null}
    },
    "figures": [{"label": "Conversations this week", "value": 31, "timeBasis": "window"}],
    "recommendations": []
  }$d2$::jsonb,
  '2026-09-21T01:00:00Z'
)
on conflict (window_from, window_to) do update set bundle = excluded.bundle, digest = excluded.digest, created_at = excluded.created_at;

-- Roles PostgREST uses for the service-role key (the hosted project grants these by default).
grant select, insert, update, delete on public.digest_archive to service_role;
