-- coop_chat_readonly_proof_grid.sql
-- The same negative proof as coop_chat_readonly_proof.sql, but the result comes back as a ROW GRID (status, check), because the
-- Supabase SQL editor hides RAISE NOTICE output. Paste it into the archive project's SQL editor (staging, then PROD).
-- SAFE ON PROD: it only reads; every write attempt undoes itself (a sub-block that raises) and the role is reset at the end. Every row must say PASS; the first row
-- is a SUMMARY with the number of failures (must be 0). Run supabase/coop_chat_readonly.sql (and coop_chat_digest.sql) first.
-- Results are collected in the session setting proof.log (a custom setting, harmless) and read after the rollback.
select set_config('proof.log', '', false);
set role coop_chat_ro;

do $$ declare r text; n bigint; begin
  foreach r in array array['coop_chat_orders','coop_chat_order_items','coop_chat_products','coop_chat_bundles','coop_chat_prices','coop_chat_price_changes','coop_chat_events','coop_chat_digest'] loop
    begin
      execute format('select count(*) from public.%I', r) into n;
      perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('PASS read view %s (%s rows)', r, n) || E'\n', false);
    exception when others then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL read view %s: %s', r, sqlerrm) || E'\n', false); end;
  end loop;
end $$;

do $$ declare r text; n bigint; begin
  foreach r in array array['pos_orders','pos_order_items','pos_products','pos_bundles','pos_prices','pos_price_changes','pos_events'] loop
    begin
      execute format('select count(*) from public.%I', r) into n;
      perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL base table %s was readable', r) || E'\n', false);
    exception
      when insufficient_privilege then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('PASS base table %s denied (insufficient_privilege)', r) || E'\n', false);
      when others then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL base table %s: unexpected %s %s', r, sqlstate, sqlerrm) || E'\n', false);
    end;
  end loop;
end $$;

do $$ declare c text; begin
  foreach c in array array['customer_handle','remarks','client_uuid','device_id'] loop
    begin
      execute format('select %I from public.coop_chat_orders limit 1', c);
      perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL column %s selectable through coop_chat_orders', c) || E'\n', false);
    exception
      when undefined_column then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('PASS column %s absent from coop_chat_orders', c) || E'\n', false);
      when others then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL column %s: unexpected %s %s', c, sqlstate, sqlerrm) || E'\n', false);
    end;
  end loop;
end $$;

do $$ declare v text; col text; stmt text; begin
  foreach v in array array['coop_chat_orders','coop_chat_order_items','coop_chat_products','coop_chat_bundles','coop_chat_prices','coop_chat_price_changes','coop_chat_events'] loop
    select attname into col from pg_attribute
      where attrelid = ('public.' || v)::regclass and attnum > 0 and not attisdropped order by attnum limit 1;
    foreach stmt in array array[
      format('insert into public.%I default values', v),
      format('update public.%I set %I = %I', v, col, col),
      format('delete from public.%I', v)
    ] loop
      begin
        execute stmt;
        -- If the write was NOT refused it is undone right here (the exception rolls this sub-block back) and reported as FAIL.
        raise exception 'proof_write_allowed';
      exception
        when insufficient_privilege or feature_not_supported or generated_always or read_only_sql_transaction then
          perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('PASS write refused (%s): %s', sqlstate, stmt) || E'\n', false);
        when others then
          if sqlerrm = 'proof_write_allowed' then
            perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL write allowed (undone): %s', stmt) || E'\n', false);
          else
            perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL unexpected %s %s: %s', sqlstate, sqlerrm, stmt) || E'\n', false);
          end if;
      end;
    end loop;
  end loop;
end $$;

-- Staff, device and cash columns of the new views' base tables must not be selectable through the views.
do $$ declare pair text[]; v text; c text; begin
  foreach pair slice 1 in array array[
    ['coop_chat_events','created_by'],['coop_chat_events','organizer'],['coop_chat_events','opening_cash'],
    ['coop_chat_events','closing_cash'],['coop_chat_events','cash_note'],
    ['coop_chat_prices','updated_by'],
    ['coop_chat_price_changes','changed_by'],['coop_chat_price_changes','device_id'],['coop_chat_price_changes','reason']
  ] loop
    v := pair[1]; c := pair[2];
    begin
      execute format('select %I from public.%I limit 1', c, v);
      perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL column %s selectable through %s', c, v) || E'\n', false);
    exception
      when undefined_column then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('PASS column %s absent from %s', c, v) || E'\n', false);
      when others then perform set_config('proof.log', coalesce(current_setting('proof.log', true), '') || format('FAIL column %s of %s: unexpected %s %s', c, v, sqlstate, sqlerrm) || E'\n', false);
    end;
  end loop;
end $$;

reset role;

with t as (
  select line, ord from unnest(string_to_array(trim(trailing E'\n' from coalesce(current_setting('proof.log', true), '')), E'\n')) with ordinality as u(line, ord)
)
select ord, case when line like 'PASS%' then 'PASS' else 'FAIL' end as status, line as "check"
from t
union all
select 0, case when count(*) filter (where line not like 'PASS%') = 0 and count(*) > 0 then 'ALL PASS' else 'FAILURES' end,
       count(*) filter (where line like 'PASS%') || ' pass, ' || count(*) filter (where line not like 'PASS%') || ' fail, ' || count(*) || ' checks'
from t
order by 1;
