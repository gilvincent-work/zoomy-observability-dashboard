-- coop_reports.sql
-- Owner: zoomy-observability-dashboard (Coop Reports, F9: saved, versioned dashboards).
-- Applied BY HAND in the archive project's SQL editor: staging first, then PROD by the co-worker. Never run by the app.
-- Idempotent: safe to re-run. No pos_* DDL, no functions, no policies, no grants.
-- Design: knowledge/architecture/2026-10-01-talk-to-data-design.md § 5b. Rule: knowledge/best-practices/chat-read-only.md (layer 7).
--
-- What is stored: only the RECIPE of a report (filters plus up to 12 blocks), never data and never model-written prose.
-- The app reads and writes these two tables with the service role through src/reports-client.ts, which allows only these
-- two tables and only GET/POST/PATCH. The service role bypasses RLS, so ALL access rules (who may view, edit, delete)
-- live in code (src/reports-access.ts). RLS is on with NO policies, so the anon and authenticated keys read nothing.
--
-- Write ordering (no RPC, no transaction, by design; the write client forbids /rpc):
--   save:    1. insert coop_reports (current_version = 1)   2. insert coop_report_versions (version 1)
--            if step 2 fails the report row is soft-deleted (best effort).
--   update / restore (optimistic, PostgREST PATCH with filters, Prefer: return=representation):
--            1. update coop_reports set current_version = N+1 where id = $id and current_version = N and deleted_at is null
--               zero rows returned = a stale expected_version (or deleted): NO version row is written.
--            2. insert coop_report_versions (report_id, N+1, ...)
--            if step 2 fails the bump is rolled back (set current_version = N where id = $id and current_version = N+1).
--   rename, pin, visibility, delete (soft): update coop_reports only; they create no version.
-- The composite primary key (report_id, version) is the last line of defence: two writers can never both create version N+1.
--
-- Verify after applying (read-only):
--   select to_regclass('public.coop_reports'), to_regclass('public.coop_report_versions');          -- both non-null
--   select relname, relrowsecurity from pg_class where relname in ('coop_reports', 'coop_report_versions');  -- both t
--   select count(*) from pg_policies where tablename in ('coop_reports', 'coop_report_versions');   -- 0
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name in ('coop_reports', 'coop_report_versions') and grantee in ('anon', 'authenticated');  -- no rows
-- Then open /reports in the dashboard: it shows "Reports not set up" until both tables exist.

create table if not exists public.coop_reports (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text not null,                                    -- from the signed-in session, lower-cased by the app
  title           text not null check (char_length(title) between 1 and 120),
  visibility      text not null default 'team' check (visibility in ('team', 'private')),
  pinned          boolean not null default false,                   -- pinned to the top of the gallery (not "Pin dates")
  current_version int not null default 1,
  deleted_at      timestamptz,                                      -- soft delete
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.coop_report_versions (
  report_id     uuid not null references public.coop_reports (id) on delete cascade,
  version       int not null,
  spec_version  int not null default 1,
  spec          jsonb not null check (pg_column_size(spec) < 32768),
  source_prompt text check (char_length(source_prompt) <= 2000),    -- plain text, shown in the version list, never fed to a model
  created_by    text not null,
  created_at    timestamptz not null default now(),
  primary key (report_id, version)
);

create index if not exists coop_reports_list_idx
  on public.coop_reports (deleted_at, pinned desc, updated_at desc);

-- No policies: service role only. Revoking the default Supabase grants is belt and braces on top of RLS.
alter table public.coop_reports enable row level security;
alter table public.coop_report_versions enable row level security;
revoke all on public.coop_reports from anon, authenticated;
revoke all on public.coop_report_versions from anon, authenticated;
