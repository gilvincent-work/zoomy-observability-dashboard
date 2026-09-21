-- Spin-the-wheel booth leads, collected by the storefront admin
-- (zoomyforpets.com/admin/spin-wheel). That app writes to the STOREFRONT
-- Supabase project; Coop has no credentials for it, so finished events are
-- imported here with scripts/import-spin-leads.mjs from the admin's CSV export.
--
-- Run once per environment in the Supabase SQL editor (Staging, then PROD).
create table if not exists public.spin_wheel_leads (
  lead_id      uuid primary key default gen_random_uuid(),
  email        text not null,
  mobile       text,
  prize        text not null,
  campaign     text,                    -- the admin's event slug, e.g. modern-market-sept2026
  collected_at timestamptz not null,
  consent_at   timestamptz,
  created_at   timestamptz not null default now(),
  -- One person can spin at more than one event, but not twice in the same second:
  -- this makes re-importing the same export a no-op instead of a duplicate.
  unique (email, collected_at)
);

create index if not exists spin_wheel_leads_collected_at_idx
  on public.spin_wheel_leads (collected_at desc);

-- Contact data. RLS on with NO policies: the anon key can read nothing, and
-- only the service role (Coop server-side, same as pos_*) gets through.
alter table public.spin_wheel_leads enable row level security;
