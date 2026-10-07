-- coop_chat_default_views.sql: Ask Coop default views (spec 2.4): the business default next to the raw table, so the model reads the
-- right basis by name. Replaces a required-filter lint. Owner: zoomy-observability-dashboard (a VIEW over zoomy-pos tables; no table DDL;
-- the name sits in the pos_ prefix by owner decision, and zoomy-pos is told the name is taken). Hand-applied after
-- coop_chat_explore_direct.sql. Re-runnable. The direct-reads trigger grants it to coop_explore_ro; the grant below makes that explicit.
create or replace view public.pos_orders_completed as
  select o.* from public.pos_orders o
  where o.status = 'completed';
revoke all on public.pos_orders_completed from public, anon, authenticated;
grant select on public.pos_orders_completed to coop_explore_ro;
comment on view public.pos_orders_completed is 'Ask Coop default: completed (not voided) POS orders. Raw table: pos_orders.';
