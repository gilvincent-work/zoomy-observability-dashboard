-- LOCAL ONLY, SELECT-only. Expected answers on the DUMMY data (dummy-pets-seed.sql) for the owner questions. Run:
--   docker exec -i coop-local-db psql -h 127.0.0.1 -U postgres -d postgres -P pager=off < scripts/local-supabase/dummy-pets-expected.sql
-- Rules: dummy rows only (event_id 'D-%', order ids 100000..199999, campaign 'dummy-%'); voided orders excluded; an event is its name
-- under lower(btrim(name)) so the lowercase / trailing-space respelling merges with the original; days are Manila days; money is orders.total.

\echo '== A. Pet type per event (tagged orders, completed): orders, revenue, rank by orders; NULL pet_type shown as (untagged)'
with ev as (select event_id, lower(btrim(name)) as ev_name from pos_events where event_id like 'D-%'),
t as (
  select e.ev_name, coalesce(o.pet_type, '(untagged)') as pet_type, count(*) as orders, sum(o.total) as revenue
  from pos_orders o join ev e on e.event_id = o.event_id
  where o.id between 100000 and 199999 and o.status = 'completed'
  group by 1, 2)
select ev_name, pet_type, orders, revenue,
       case when pet_type = '(untagged)' then null else rank() over (partition by ev_name order by (pet_type = '(untagged)'), orders desc) end as rank_by_orders
from t order by ev_name, (pet_type = '(untagged)'), orders desc;

\echo '== A2. Top pet type per event (ties would show both)'
with ev as (select event_id, lower(btrim(name)) as ev_name from pos_events where event_id like 'D-%'),
t as (select e.ev_name, o.pet_type, count(*) as orders, sum(o.total) as revenue
      from pos_orders o join ev e on e.event_id = o.event_id
      where o.id between 100000 and 199999 and o.status = 'completed' and o.pet_type is not null group by 1, 2),
r as (select *, rank() over (partition by ev_name order by orders desc) as rk from t)
select ev_name, pet_type as top_pet_type, orders, revenue from r where rk = 1 order by ev_name;

\echo '== B. Breed counts per event from leads (text after the slash, lower, trimmed, spaces collapsed); event = collected_at Manila day inside the window; merged by lower(btrim(name))'
with ev as (select lower(btrim(name)) as ev_name, min(starts_on) as s, max(ends_on) as e from pos_events where event_id like 'D-%' group by 1),
l as (
  select ev.ev_name, nullif(regexp_replace(lower(btrim(split_part(sl.pet, '/', 2))), '\s+', ' ', 'g'), '') as breed
  from spin_wheel_leads sl join ev on (sl.collected_at at time zone 'Asia/Manila')::date between ev.s and ev.e
  where sl.campaign like 'dummy-%' and position('/' in coalesce(sl.pet, '')) > 0),
c as (select ev_name, breed, count(*) as leads from l where breed is not null group by 1, 2)
select ev_name, breed, leads, rank() over (partition by ev_name order by leads desc) as rk from c order by ev_name, leads desc, breed;

\echo '== C. Leads with no breed (null/empty pet, no slash, or nothing after the slash), per event and in total'
with ev as (select lower(btrim(name)) as ev_name, min(starts_on) as s, max(ends_on) as e from pos_events where event_id like 'D-%' group by 1)
select coalesce(ev.ev_name, 'ALL EVENTS') as ev_name, count(*) as leads,
       count(*) filter (where nullif(btrim(split_part(coalesce(sl.pet, ''), '/', 2)), '') is null or position('/' in coalesce(sl.pet, '')) = 0) as leads_no_breed
from spin_wheel_leads sl join ev on (sl.collected_at at time zone 'Asia/Manila')::date between ev.s and ev.e
where sl.campaign like 'dummy-%'
group by rollup (ev.ev_name) order by ev.ev_name nulls last;

\echo '== D. Orders per event: tagged to the event vs attributed by date only (event_id NULL, Manila day in the window); completed only'
with ev as (select lower(btrim(name)) as ev_name, array_agg(event_id) as ids, min(starts_on) as s, max(ends_on) as e from pos_events where event_id like 'D-%' group by 1)
select ev.ev_name,
       count(*) filter (where o.event_id = any (ev.ids)) as tagged_orders,
       coalesce(sum(o.total) filter (where o.event_id = any (ev.ids)), 0) as tagged_revenue,
       count(*) filter (where o.event_id is null) as date_only_orders,
       coalesce(sum(o.total) filter (where o.event_id is null), 0) as date_only_revenue,
       count(*) as total_orders, sum(o.total) as total_revenue
from ev join pos_orders o on o.id between 100000 and 199999 and o.status = 'completed'
  and (o.event_id = any (ev.ids) or (o.event_id is null and (o.created_at at time zone 'Asia/Manila')::date between ev.s and ev.e))
group by ev.ev_name order by ev.ev_name;

\echo '== E. Weekday sales, all dummy completed orders (Manila weekday; 1 = Monday)'
select extract(isodow from o.created_at at time zone 'Asia/Manila')::int as isodow, to_char(o.created_at at time zone 'Asia/Manila', 'Dy') as weekday,
       count(*) as orders, sum(o.total) as revenue
from pos_orders o where o.id between 100000 and 199999 and o.status = 'completed'
group by 1, 2 order by revenue desc;

\echo '== F. Housekeeping: dummy row counts, voided orders, untagged share'
select count(*) as orders, count(*) filter (where status = 'voided') as voided, count(*) filter (where pet_type is null) as pet_null,
       round(100.0 * count(*) filter (where pet_type is null) / count(*), 1) as pet_null_pct, count(*) filter (where event_id is null) as no_event_id
from pos_orders where id between 100000 and 199999;
