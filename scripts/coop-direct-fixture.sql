-- LOCAL FIXTURE ONLY (Train 3 direct reads). Never apply to a hosted project. Re-runnable.
-- scripts/local-supabase/up.sh --explore applies it AFTER supabase/coop_chat_explore_direct.sql, so every object here also
-- exercises the event trigger. Secret-shaped values are BUILT at apply time (concatenation, md5), so no secret-looking literal is
-- committed (this repo is public).
alter table public.pos_orders enable row level security; -- RLS on, no policy (like the hosted tables): proves BYPASSRLS

drop view if exists public.explore_fixture_token_view, public.explore_fixture_alias_view, public.explore_fixture_row_view;
drop table if exists public.marketplace_tokens, public.explore_fixture_mixed, public.explore_fixture_notes, public.gl_fixture_stores;

create table public.marketplace_tokens (marketplace text primary key, access_token text, refresh_token text, updated_at timestamptz default now());
insert into public.marketplace_tokens (marketplace, access_token, refresh_token) values ('lazada', 'fixture-token-' || md5('a'), 'fixture-token-' || md5('b'));
alter table public.marketplace_tokens enable row level security;

create table public.explore_fixture_mixed (id int primary key, label text, api_key text);
insert into public.explore_fixture_mixed values (1, 'safe label', 'fixture-token-' || md5('c'));

create table public.explore_fixture_notes (id int primary key, note text, payload jsonb);
insert into public.explore_fixture_notes values
  (1, 'sk-' || repeat('x9', 12), jsonb_build_object('lazada', jsonb_build_object('access_token', 'fixture-token-' || md5('d')))),
  (2, 'eyJ' || repeat('a', 12) || '.' || repeat('b', 12) || '.' || repeat('c', 12), '{}'::jsonb),
  (3, 'plain note 12345, nothing secret', '{"price": 129.5, "sku": "P1"}'::jsonb);

-- Innocent names over a closed table and over a secret column: must NOT be granted (Review Focus 1)
create view public.explore_fixture_token_view as select m.marketplace, m.updated_at from public.marketplace_tokens m;
create view public.explore_fixture_alias_view as select x.id, x.api_key as label2 from public.explore_fixture_mixed x;
-- Whole-row read (pg_depend records column 0, no per-column dependency): must NOT be granted either
create view public.explore_fixture_row_view as select to_jsonb(x) as j from public.explore_fixture_mixed x;

-- Tenant fence
create table public.gl_fixture_stores (store_code text primary key, name text);
insert into public.gl_fixture_stores values ('S1', 'Fixture store');
create table if not exists public.companies (id text primary key, name text);
insert into public.companies (id, name) values ('zoomy', 'Zoomy') on conflict do nothing;

-- pos_settings: the reviewed exception pos_settings.key (Task 8 moves this block to scripts/coop-stock-fixture.sql)
create table if not exists public.pos_settings (key text primary key, value jsonb, updated_at timestamptz default now());
insert into public.pos_settings (key, value) values
  ('stock_forecast_config', '{"threshold": 5, "target_cover_events": 6, "lead_time_days": 3, "early_warning_events": 3}')
on conflict (key) do update set value = excluded.value;
