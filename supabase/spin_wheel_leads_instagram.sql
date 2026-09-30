-- Spin-the-wheel v2 (Sep 27 event onwards): the admin now collects an email OR
-- an Instagram handle, plus the pet's name/breed. Additive only — every existing
-- column and row is left as it is; email just stops being mandatory when a
-- handle is given instead.
--
-- Run once per environment in the Supabase SQL editor, AFTER spin_wheel_leads.sql.
-- Safe to re-run.
alter table public.spin_wheel_leads
  add column if not exists instagram text,  -- handle, lowercased, no leading "@"
  add column if not exists pet       text;  -- as typed, e.g. "Mimi / Puspin"

alter table public.spin_wheel_leads alter column email drop not null;

-- Handle-only leads dedupe the same way email ones do (re-import = no-op).
-- Postgres treats NULLs as distinct, so email rows never collide on this.
alter table public.spin_wheel_leads drop constraint if exists spin_wheel_leads_instagram_collected_at_key;
alter table public.spin_wheel_leads add constraint spin_wheel_leads_instagram_collected_at_key unique (instagram, collected_at);

-- A lead still has to be reachable somehow.
alter table public.spin_wheel_leads drop constraint if exists spin_wheel_leads_contact_check;
alter table public.spin_wheel_leads add constraint spin_wheel_leads_contact_check check (email is not null or instagram is not null);
