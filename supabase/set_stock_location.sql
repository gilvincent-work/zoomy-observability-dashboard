-- phase4: set_product_stock takes an optional location.
--
-- The recount used by the dashboard's Edit stock was hard-wired to the 'event'
-- (sellable) pool, so Office back-stock could not be corrected. This adds
-- p_location (default 'event', so existing 3-argument callers behave exactly as
-- before) and scopes the lot reads/writes and the ledger row to that location.
--
-- NOT YET APPLIED. Apply to staging first, then prod via the usual promotion.

-- The old 3-argument version must go: with a defaulted 4th parameter, a 3-argument
-- call would match both overloads and fail as ambiguous.
drop function if exists public.set_product_stock(text, integer, text);

create or replace function public.set_product_stock(p_product_id text, p_new_qty integer, p_by text, p_location text default 'event')
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current   integer;
  v_delta     integer;
  v_lot       record;
  v_remaining integer;
  v_take      integer;
  v_target    uuid;
begin
  if p_new_qty < 0 then
    raise exception 'stock cannot be negative';
  end if;

  if not exists (select 1 from pos_locations where code = p_location) then
    raise exception 'unknown location %', p_location;
  end if;

  select coalesce(sum(qty_on_hand), 0) into v_current
    from pos_inventory_lots where product_id = p_product_id and location = p_location;

  v_delta := p_new_qty - v_current;
  if v_delta = 0 then
    return;
  end if;

  if v_delta > 0 then
    select lot_id into v_target
      from pos_inventory_lots where product_id = p_product_id and location = p_location
      order by received_at desc limit 1;
    if v_target is null then
      v_target := gen_random_uuid();
      insert into pos_inventory_lots (lot_id, product_id, location, lot_code, expires_on, qty_received, qty_on_hand, received_at, updated_at)
      values (v_target, p_product_id, p_location, 'adjust', null, v_delta, v_delta, now(), now());
    else
      update pos_inventory_lots set qty_on_hand = qty_on_hand + v_delta, updated_at = now()
        where lot_id = v_target;
    end if;
  else
    v_remaining := -v_delta;
    for v_lot in
      select lot_id, qty_on_hand from pos_inventory_lots
      where product_id = p_product_id and location = p_location and qty_on_hand > 0
      order by expires_on asc nulls last, received_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.qty_on_hand, v_remaining);
      update pos_inventory_lots set qty_on_hand = qty_on_hand - v_take, updated_at = now()
        where lot_id = v_lot.lot_id;
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  insert into pos_stock_movements (product_id, lot_id, location, order_id, delta, reason, created_by, created_at)
  values (p_product_id, null, p_location, null, v_delta, 'recount', p_by, now());
end;
$function$;

grant execute on function public.set_product_stock(text, integer, text, text) to anon, authenticated, service_role;
