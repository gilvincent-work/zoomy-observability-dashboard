-- LOCAL ONLY. Fixture that mimics the shared archive's pos_* tables and two zoomy-pos RPCs, for
-- scripts/coop-chat-ro-proof.mjs. Never apply to a hosted project. Re-runnable (drops and recreates).
drop view if exists public.coop_chat_orders, public.coop_chat_order_items, public.coop_chat_products, public.coop_chat_bundles;
drop function if exists public.fake_write_rpc();
drop function if exists public.fake_read_rpc();
drop table if exists public.pos_order_items, public.pos_orders, public.pos_products, public.pos_bundles;

create table public.pos_orders (
  id bigint generated always as identity primary key,
  client_uuid uuid default gen_random_uuid(),
  subtotal numeric, discount numeric, total numeric,
  oversold boolean default false,
  device_id text, payment_method text, customer_handle text,
  status text default 'completed', remarks text,
  created_at timestamptz default now(), edited_at timestamptz,
  event_id text, pet_type text
);
create table public.pos_order_items (
  id bigint generated always as identity primary key,
  order_id bigint references public.pos_orders(id),
  product_id text, bundle_id text, bundle_group text,
  qty int, unit_price numeric, line_total numeric
);
create table public.pos_products (product_id text primary key, name text, product_line text, category text);
create table public.pos_bundles (bundle_id text primary key, name text, price numeric);

alter table public.pos_orders enable row level security;       -- no policies, like the real tables
alter table public.pos_order_items enable row level security;
alter table public.pos_products enable row level security;
alter table public.pos_bundles enable row level security;

insert into public.pos_products values
  ('P1','Chicken Jerky','jerky','treat'),('P2','Salmon Bites','bites','treat'),
  ('P3','Dental Chews','dental','treat'),('P4','Beef Strips','jerky','treat');
insert into public.pos_bundles values ('B1','Starter Box',499),('B2','Party Pack',899);

insert into public.pos_orders (subtotal,discount,total,oversold,device_id,payment_method,customer_handle,status,remarks,event_id,pet_type) values
  (500,0,500,false,'dev-1','cash','@maria','completed','birthday order','EV1','dog'),
  (250,25,225,false,'dev-1','gcash',null,'completed',null,'EV1','cat'),
  (899,0,899,false,'dev-2','card','@jun','completed','call first','EV2','dog'),
  (120,0,120,true,'dev-2','cash',null,'completed',null,null,'both'),
  (310,0,0,false,'dev-1','cash','@void','voided','customer left',null,'dog'),
  (75,0,75,false,'dev-2','gcash','@kim','completed',null,'EV2','cat');

insert into public.pos_order_items (order_id,product_id,bundle_id,bundle_group,qty,unit_price,line_total) values
  (1,'P1',null,null,2,250,500),
  (2,'P2',null,null,1,250,250),
  (3,null,'B2','g-3',1,899,899),
  (3,'P1',null,'g-3',1,0,0),
  (3,'P3',null,'g-3',2,0,0),
  (4,'P4',null,null,1,120,120),
  (5,'P1',null,null,1,310,310),
  (6,'P3',null,null,1,75,75),
  (1,null,'B1','g-1',1,0,0),
  (1,'P2',null,'g-1',1,0,0),
  (2,'P4',null,null,0,0,0),
  (6,'P2',null,null,0,0,0);

-- Mimic zoomy-pos RPCs. The write one is SECURITY DEFINER with the default PUBLIC execute (the risk).
create function public.fake_write_rpc() returns void
language sql security definer set search_path = public as $$
  insert into public.pos_orders (total, pet_type, customer_handle) values (1,'spike','@spike');
$$;
create function public.fake_read_rpc() returns bigint
language sql stable as $$ select count(*) from public.pos_orders $$;
