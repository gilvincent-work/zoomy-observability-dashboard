-- coop_chat_readonly.sql
-- Owner: zoomy-observability-dashboard (Talk to Data / Ask Coop, layer 5: database read-only role).
-- Applied BY HAND in the archive project's SQL editor: staging first, then PROD by the co-worker.
-- Nothing here touches pos_* DDL: it only creates a role, seven dashboard-owned views over pos_* tables, grants on
-- those views, and (optional section 3) one tiny function plus one authenticator setting.
-- Idempotent: safe to re-run. Run supabase/coop_chat_readonly_checks.sql and _proof.sql afterwards.
-- Design: knowledge/architecture/2026-10-01-talk-to-data-design.md (Layer 5). Rule: knowledge/best-practices/chat-read-only.md
--
-- The views are DEFINER views (no security_invoker): they read the RLS-protected pos_* tables as their owner, so the
-- role sees only the columns listed here. Customer-level columns (customer_handle, remarks, phone, email, instagram,
-- customer_name, client_uuid, device_id) and staff/cash columns (created_by, updated_by, changed_by, opening_cash,
-- closing_cash, cash_note, organizer) are never exposed. A later feature may add columns at the END of a view.

-- 1. Role -------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'coop_chat_ro') then
    create role coop_chat_ro nologin noinherit;
  end if;
end $$;

grant coop_chat_ro to authenticator;   -- PostgREST switches to the JWT's role claim, so authenticator must be a member

-- NOTE (spike B, 2026-10-01): role-level settings do NOT apply under PostgREST (it uses SET LOCAL ROLE, which does not
-- load the role's settings). This only matters for a direct Postgres connection (Option B).
alter role coop_chat_ro set statement_timeout = '5s';

-- 2. Views and grants -------------------------------------------------------------------------------------------
create or replace view public.coop_chat_orders as
  select id, subtotal, discount, total, oversold, payment_method, status, created_at, edited_at, event_id, pet_type
  from public.pos_orders;

-- id is included because the reader orders by id even though it does not select it
create or replace view public.coop_chat_order_items as
  select id, order_id, product_id, bundle_id, bundle_group, qty, unit_price, line_total
  from public.pos_order_items;

create or replace view public.coop_chat_products as
  select product_id, name from public.pos_products;

create or replace view public.coop_chat_bundles as
  select bundle_id, name from public.pos_bundles;

-- Price lookups, price-change log and events (Ask Coop F3). No staff, device or cash columns.
create or replace view public.coop_chat_prices as
  select product_id, price from public.pos_prices;

create or replace view public.coop_chat_price_changes as
  select id, product_id, old_price, new_price, changed_at from public.pos_price_changes;

create or replace view public.coop_chat_events as
  select event_id, name, venue, city, starts_on, ends_on, status, created_at from public.pos_events;

revoke all on public.coop_chat_orders, public.coop_chat_order_items, public.coop_chat_products, public.coop_chat_bundles,
  public.coop_chat_prices, public.coop_chat_price_changes, public.coop_chat_events
  from public, anon, authenticated;
grant usage on schema public to coop_chat_ro;
grant select on public.coop_chat_orders, public.coop_chat_order_items, public.coop_chat_products, public.coop_chat_bundles,
  public.coop_chat_prices, public.coop_chat_price_changes, public.coop_chat_events
  to coop_chat_ro;

-- 3. OPTIONAL BUT RECOMMENDED: transaction-level read-only lock ----------------------------------------------------
-- Why: a SECURITY DEFINER write function with the default EXECUTE-to-PUBLIC grant (zoomy-pos RPCs) is callable by
-- coop_chat_ro. This hook makes every request made as coop_chat_ro run in a READ ONLY transaction, so even a callable
-- write function fails with "cannot execute ... in a read-only transaction". It does nothing for any other role.
-- PostgREST calls db_pre_request after it has switched to the request role, inside the request transaction.
-- It is one project-wide setting on authenticator (a project can have only ONE pre-request function). If another one
-- already exists the DO block below skips and prints a notice: merge the line in coop_chat_pre_request() by hand.
create or replace function public.coop_chat_pre_request() returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'coop_chat_ro' then
    perform set_config('transaction_read_only', 'on', true);
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator' and s.setdatabase = 0
      and exists (select 1 from unnest(s.setconfig) c where c like 'pgrst.db_pre_request=%')
      and not exists (select 1 from unnest(s.setconfig) c where c = 'pgrst.db_pre_request=public.coop_chat_pre_request')
  ) then
    raise notice 'SKIPPED: authenticator already has a different pgrst.db_pre_request. Not overwritten. Add the "if current_user = ''coop_chat_ro'' then perform set_config(''transaction_read_only'',''on'',true); end if;" lines to that function by hand.';
  else
    alter role authenticator set pgrst.db_pre_request = 'public.coop_chat_pre_request';
    raise notice 'pgrst.db_pre_request set to public.coop_chat_pre_request';
  end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
