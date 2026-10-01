-- Spike B: SELECT-only role through PostgREST. LOCAL THROWAWAY STACK ONLY. Never apply to a hosted project.
drop view if exists public.coop_chat_orders;
drop function if exists public.fake_write_rpc();
drop table if exists public.pos_orders;

create table public.pos_orders (
  id bigserial primary key,
  created_at timestamptz default now(),
  total numeric,
  pet_type text,
  customer_handle text
);
alter table public.pos_orders enable row level security;  -- no policies
insert into public.pos_orders (total, pet_type, customer_handle) values
  (120,'dog','@a'),(250.5,'cat','@b'),(99,'dog','@c'),(310,'dog','@d'),(75,'cat','@e');

-- definer view (default, NOT security_invoker): reads base table as its owner (postgres)
create view public.coop_chat_orders as
  select id, created_at, total, pet_type from public.pos_orders;

-- simulated zoomy-pos write RPC; default PUBLIC execute left untouched on purpose
create function public.fake_write_rpc() returns void
language sql security definer as $$
  insert into public.pos_orders (total, pet_type, customer_handle) values (1,'spike','@spike');
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='coop_chat_ro') then
    create role coop_chat_ro nologin noinherit;
  end if;
end $$;
grant coop_chat_ro to authenticator;
alter role coop_chat_ro set default_transaction_read_only = on;
alter role coop_chat_ro set statement_timeout = '5s';
revoke all on public.coop_chat_orders from public, anon, authenticated;
grant usage on schema public to coop_chat_ro;
grant select on public.coop_chat_orders to coop_chat_ro;
notify pgrst, 'reload schema';
