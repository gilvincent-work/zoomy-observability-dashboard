-- Multi-role access (v2) — ADDITIVE. Run on STAGING (syxwixxzmytvhwhkwdvw) first.
-- Adds a membership status and a role-change audit log. Depends on companies.sql
-- (the company_users table + company_role enum). Nothing existing is altered.

-- Membership lifecycle: a Coop Admin can pre-grant a role to an email that signs in
-- later (invited), and suspend access without deleting the row. Suspended grants
-- nothing (src/company.ts fetchMemberships drops them).
alter table public.company_users
  add column if not exists status text not null default 'active';  -- active | invited | suspended

-- Every role write (grant / change_role / revoke / suspend / reactivate) is logged.
-- Since the dashboard reads with the service-role key (RLS bypassed), this audit
-- trail — not RLS — is the accountability layer for access management.
create table if not exists public.company_user_audit (
  id           bigint generated always as identity primary key,
  actor_email  text not null,
  target_email text not null,
  company_id   text,
  action       text not null,
  old_role     public.company_role,
  new_role     public.company_role,
  created_at   timestamptz not null default now()
);
alter table public.company_user_audit enable row level security;
