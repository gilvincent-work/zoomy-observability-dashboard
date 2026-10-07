-- coop_chat_explore_direct.sql
-- Owner: zoomy-observability-dashboard (Ask Coop direct reads, Train 3). Best practice: knowledge/best-practices/chat-direct-read-access.md
-- Applied BY HAND in the archive project's SQL editor, as postgres: staging first. PROD only after zoomy-pos revokes PUBLIC/anon/
-- authenticated execute on its write RPCs (spec 5.3). Re-runnable. Afterwards run supabase/coop_chat_explore_direct_checks.sql.
-- Rollback: supabase/coop_chat_explore_direct_rollback.sql, then re-run supabase/coop_chat_explore.sql.
--
-- RUNBOOK (after every apply, as postgres):
--   select jobname from cron.job where jobname = 'coop_explore_reapply';   -- must return ONE row; none = only the trigger guards new objects
--   select evtname, evtenabled from pg_event_trigger where evtname = 'coop_explore_guard_ddl';   -- expect coop_explore_guard_ddl|O
-- Recover by hand (grants look wrong, the cron job is missing, or a guard warning mentions a cancel):
--   select coop_explore_admin.reapply_all();   -- idempotent; returns how many relations it changed
--
-- WHAT THIS DOES
--   1. coop_explore_ro (created by coop_chat_explore.sql) gets BYPASSRLS: every archive table has RLS on and no policies.
--   2. One secret-name rule in the private schema coop_explore_admin (never public: PostgREST exposes public functions to anon).
--      TS copy: src/chat/explore/secret-names.ts; test/chat-explore-secret-names.test.ts fails when they differ.
--   3. apply_grants(rel): SELECT on an open relation; column grants on the safe columns of a relation with a secret column; nothing on
--      a closed relation (secret or tenant name) or on a view that reads one at any depth. Idempotent: no change when the ACL is right.
--   4. Default privileges for relations postgres creates, then reapply_all() for the existing ones.
--   5. Event trigger coop_explore_guard_ddl re-applies on DDL; pg_cron re-applies every 5 minutes as well, because Supabase skips user
--      event triggers for superusers and reserved roles (https://supabase.com/blog/event-triggers-wo-superuser).
-- The coop_explore_* views of coop_chat_explore.sql stay (aliases during the switch). Not touched: coop_chat_ro, the coop_chat_* views,
-- any pos_* DDL.

-- 0. Prerequisites ----------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'coop_explore_ro') then
    raise exception 'apply supabase/coop_chat_explore.sql first (it creates the login coop_explore_ro)';
  end if;
  if current_setting('server_version_num')::int < 160000 then
    raise exception 'coop_chat_explore_direct.sql needs PostgreSQL 16 or newer (this server is %): before 16 only a superuser may ALTER ROLE ... BYPASSRLS. Hosted: check `show server_version_num`.', current_setting('server_version');
  end if;
  if not (select rolbypassrls from pg_roles where rolname = current_user) then
    raise exception 'run this as a role that has BYPASSRLS (postgres in the SQL editor): only such a role may grant it';
  end if;
end $$;

-- 1. Role -------------------------------------------------------------------------------------------------------
alter role coop_explore_ro bypassrls;

-- 2. The name rule ----------------------------------------------------------------------------------------------
create schema if not exists coop_explore_admin;
revoke all on schema coop_explore_admin from public;

create or replace function coop_explore_admin.secret_parts() returns text[] language sql immutable set search_path = '' as $$
  select array['password', 'token', 'secret', 'key', 'pin', 'hash', 'credential']::text[]
$$;
create or replace function coop_explore_admin.tenant_prefixes() returns text[] language sql immutable set search_path = '' as $$
  select array['gl_', 'company_']::text[]
$$;
create or replace function coop_explore_admin.tenant_tables() returns text[] language sql immutable set search_path = '' as $$
  select array['companies']::text[]
$$;
create or replace function coop_explore_admin.column_exceptions() returns text[] language sql immutable set search_path = '' as $$
  select array['pos_settings.key']::text[]
$$;

create or replace function coop_explore_admin.is_secret_name(name text) returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1
    from unnest(regexp_split_to_array(lower(name), '[^a-z0-9]+')) as w(word),
         unnest(coop_explore_admin.secret_parts()) as p(part)
    where w.word in (p.part, p.part || 's', p.part || 'es'))
$$;

create or replace function coop_explore_admin.is_closed_table(name text) returns boolean language sql immutable set search_path = '' as $$
  select coop_explore_admin.is_secret_name(name)
      or lower(name) = any (coop_explore_admin.tenant_tables())
      or exists (select 1 from unnest(coop_explore_admin.tenant_prefixes()) as t(prefix) where left(lower(name), length(t.prefix)) = t.prefix)
$$;

create or replace function coop_explore_admin.is_secret_column(tbl text, col text) returns boolean language sql immutable set search_path = '' as $$
  select coop_explore_admin.is_secret_name(col) and not ((lower(tbl) || '.' || lower(col)) = any (coop_explore_admin.column_exceptions()))
$$;

-- A view (or materialized view) is closed when it reads, at ANY depth, a closed relation, a secret column, another schema, or ANY
-- relation that has a secret column. The last clause fails closed on whole-row reads (to_jsonb(x), row_to_json(x), x::text): Postgres
-- records those as a column-0 dependency, so the per-column check alone would grant a view that returns the secret column.
-- Trade-off: a view over only the safe columns of a mixed table is closed too (read the table's column grants instead).
-- It is also closed when the view, or any view under it, calls a function that lives outside pg_catalog (directly, through an operator's
-- oprcode, or through a cast's castfunc), or any SECURITY DEFINER function. pg_depend records only the function a view names, never what
-- the function reads: `to_jsonb(f) from sd_fn() f`, an INVOKER wrapper around sd_fn() (the login has EXECUTE on definer RPCs), and an
-- operator over sd_fn all returned the secret. The prosecdef clause is kept on purpose: only a superuser can put a function in
-- pg_catalog, so it is redundant today, but it costs nothing and keeps the definer rule explicit.
-- No coop_chat_* or coop_explore_* view calls a user function (checked locally), so there is no allowlist.
create or replace function coop_explore_admin.reads_closed(rel oid) returns boolean language sql stable set search_path = '' as $$
  with recursive deps(oid, att) as (
    select d.refobjid, d.refobjsubid
    from pg_catalog.pg_rewrite rw
    join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = rw.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
    where rw.ev_class = rel and d.refobjid <> rel
    union
    select d.refobjid, d.refobjsubid
    from deps
    join pg_catalog.pg_rewrite rw on rw.ev_class = deps.oid
    join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = rw.oid and d.refclassid = 'pg_catalog.pg_class'::regclass
    where d.refobjid <> deps.oid
  )
  select exists (
    select 1
    from deps
    join pg_catalog.pg_class t on t.oid = deps.oid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    left join pg_catalog.pg_attribute a on a.attrelid = deps.oid and a.attnum = deps.att and deps.att > 0
    where n.nspname <> 'public'
       or coop_explore_admin.is_closed_table(t.relname)
       or (a.attname is not null and coop_explore_admin.is_secret_column(t.relname, a.attname))
       or exists (select 1 from pg_catalog.pg_attribute a2
                  where a2.attrelid = deps.oid and a2.attnum > 0 and not a2.attisdropped
                    and coop_explore_admin.is_secret_column(t.relname, a2.attname)))
  or exists (
    select 1
    from pg_catalog.pg_rewrite rw
    join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = rw.oid
    left join pg_catalog.pg_operator o on d.refclassid = 'pg_catalog.pg_operator'::regclass and o.oid = d.refobjid
    left join pg_catalog.pg_cast k on d.refclassid = 'pg_catalog.pg_cast'::regclass and k.oid = d.refobjid
    join pg_catalog.pg_proc p on p.oid = case d.refclassid
                                           when 'pg_catalog.pg_proc'::regclass then d.refobjid
                                           when 'pg_catalog.pg_operator'::regclass then o.oprcode::oid
                                           when 'pg_catalog.pg_cast'::regclass then k.castfunc
                                         end
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where (rw.ev_class = rel or rw.ev_class in (select deps.oid from deps))
      and (p.prosecdef or pn.nspname <> 'pg_catalog'))
$$;

-- 3. apply_grants: decide ONE relation. Never raises (a failure in the event trigger would abort someone else's DDL).
create or replace function coop_explore_admin.apply_grants(rel oid) returns text language plpgsql set search_path = '' as $$
declare
  ro oid := (select oid from pg_catalog.pg_roles where rolname = 'coop_explore_ro');
  r record;
  closed boolean;
  mixed boolean;
  safe_cols text[];
  have_tab text[];
  have_cols text[];
  want_tab text[];
  want_cols text[];
begin
  select c.oid, c.relname, c.relkind, n.nspname into r
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.oid = rel;
  if not found or ro is null or r.nspname <> 'public' or r.relkind not in ('r', 'p', 'v', 'm', 'f') then
    return 'skipped';
  end if;
  closed := coop_explore_admin.is_closed_table(r.relname) or coop_explore_admin.reads_closed(rel);
  select coalesce(array_agg(a.attname::text order by a.attnum) filter (where not coop_explore_admin.is_secret_column(r.relname, a.attname)), '{}'),
         coalesce(bool_or(coop_explore_admin.is_secret_column(r.relname, a.attname)), false)
    into safe_cols, mixed
  from pg_catalog.pg_attribute a
  where a.attrelid = rel and a.attnum > 0 and not a.attisdropped;
  -- a WITH GRANT OPTION privilege is encoded as 'SELECT*', so it never equals the wanted ACL and is always reset
  select coalesce(array_agg(distinct x.privilege_type || case when x.is_grantable then '*' else '' end
                            order by x.privilege_type || case when x.is_grantable then '*' else '' end), '{}') into have_tab
  from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
  where c.oid = rel and x.grantee = ro;
  -- column ACLs compared as 'column:PRIVILEGE', so a hand-made `grant update (label)` is a difference, not 'ok'
  select coalesce(array_agg(distinct a.attname::text || ':' || x.privilege_type || case when x.is_grantable then '*' else '' end
                            order by a.attname::text || ':' || x.privilege_type || case when x.is_grantable then '*' else '' end), '{}') into have_cols
  from pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
  where a.attrelid = rel and a.attnum > 0 and not a.attisdropped and x.grantee = ro;
  want_tab := case when closed or mixed then '{}'::text[] else array['SELECT'] end;
  want_cols := case when not closed and mixed then safe_cols else '{}'::text[] end;
  if have_tab = want_tab
     and have_cols = (select coalesce(array_agg(c || ':SELECT' order by c || ':SELECT'), '{}') from unnest(want_cols) as c) then
    return 'ok';
  end if;
  -- also revokes every column privilege and grant option; cascade drops anything the role re-granted with a grant option
  execute format('revoke all on public.%I from coop_explore_ro cascade', r.relname);
  if want_tab <> '{}'::text[] then
    execute format('grant select on public.%I to coop_explore_ro', r.relname);
    return 'granted';
  elsif want_cols <> '{}'::text[] then
    execute format('grant select (%s) on public.%I to coop_explore_ro', (select string_agg(format('%I', c), ', ') from unnest(want_cols) as c), r.relname);
    return 'columns';
  end if;
  return 'closed';
exception when others then
  raise warning 'coop_explore_admin.apply_grants(%): % (%)', rel, sqlerrm, sqlstate;
  return 'error';
end $$;

create or replace function coop_explore_admin.reapply_all() returns integer language plpgsql set search_path = '' as $$
declare
  was text := coalesce(current_setting('coop_explore.in_guard', true), '');
  r record;
  changed integer := 0;
begin
  perform set_config('coop_explore.in_guard', 'on', true);
  for r in
    select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by c.oid
  loop
    if coop_explore_admin.apply_grants(r.oid) not in ('ok', 'skipped') then
      changed := changed + 1;
    end if;
  end loop;
  perform set_config('coop_explore.in_guard', was, true);
  return changed;
end $$;

-- 4. Grants ------------------------------------------------------------------------------------------------------
grant usage on schema public to coop_explore_ro;
alter default privileges for role postgres in schema public grant select on tables to coop_explore_ro;
select coop_explore_admin.reapply_all() as relations_changed;

-- 5. Event trigger (SECURITY INVOKER on purpose: a definer event-trigger function fires even for superusers, supautils issue #140)
create or replace function coop_explore_admin.guard_ddl() returns event_trigger language plpgsql set search_path = '' as $$
declare
  r record;
begin
  if coalesce(current_setting('coop_explore.in_guard', true), '') = 'on' then
    return; -- our own GRANT/REVOKE: never recurse
  end if;
  -- GRANT/REVOKE rows carry no usable objid, and a change to one relation can close or open the views over it (a table renamed to a
  -- secret name, a column renamed to api_key): re-apply the whole schema (tens of relations, milliseconds; idempotent).
  if tg_tag in ('GRANT', 'REVOKE', 'ALTER DEFAULT PRIVILEGES')
     or exists (select 1 from pg_catalog.pg_event_trigger_ddl_commands() c
                where c.classid = 'pg_catalog.pg_class'::regclass and c.schema_name = 'public') then
    perform coop_explore_admin.reapply_all(); -- sets and restores the in_guard flag itself
  end if;
exception
  -- A statement_timeout (or a cancel) firing while this trigger runs would abort the user's DDL. `set local statement_timeout = 0`
  -- cannot prevent that: the timer is armed when the statement starts and a SET inside it does not disarm it (verified locally, PG 17),
  -- and WHEN OTHERS does not catch query_canceled. So catch it by name: the DDL completes, and the 5-minute cron job re-applies.
  -- Fail closed: the DDL may have opened a secret on a relation the login can already read (add column api_key, a rename to token, a
  -- GRANT). Revoke the login's privileges on every relation the commands touched and on every view over them, at any depth; GRANT,
  -- REVOKE and ALTER DEFAULT PRIVILEGES carry no objid, so for those revoke on every public relation. The cron job re-grants the right
  -- ones. The timer has already fired, so this runs to the end; a second cancel is caught too (warning, nothing more).
  when query_canceled then
    begin
      perform set_config('coop_explore.in_guard', 'on', true);
      for r in
        with recursive hit(oid) as (
          select c.objid from pg_catalog.pg_event_trigger_ddl_commands() c
          where c.classid = 'pg_catalog.pg_class'::regclass and c.schema_name = 'public'
          union
          select rw.ev_class
          from hit
          join pg_catalog.pg_depend d on d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = hit.oid
                                     and d.classid = 'pg_catalog.pg_rewrite'::regclass
          join pg_catalog.pg_rewrite rw on rw.oid = d.objid
        )
        select c.relname
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and (c.oid in (select hit.oid from hit) or tg_tag in ('GRANT', 'REVOKE', 'ALTER DEFAULT PRIVILEGES'))
      loop
        begin -- one sub-block per relation: a failing revoke must not roll back the others (that would fail OPEN)
          execute format('revoke all on public.%I from coop_explore_ro cascade', r.relname);
        exception when query_canceled or others then
          raise warning 'coop_explore_guard_ddl: could not revoke the login on public.%: % (%)', r.relname, sqlerrm, sqlstate;
        end;
      end loop;
      perform set_config('coop_explore.in_guard', '', true);
      raise warning 'coop_explore_guard_ddl: cancelled (statement timeout?): revoked the login on the touched relations; the coop_explore_reapply cron job re-grants';
    exception when query_canceled or others then
      perform set_config('coop_explore.in_guard', '', true);
      raise warning 'coop_explore_guard_ddl: cancelled, and failing closed also failed: % (%)', sqlerrm, sqlstate;
    end;
  when others then
    perform set_config('coop_explore.in_guard', '', true);
    raise warning 'coop_explore_guard_ddl: % (%)', sqlerrm, sqlstate;
end $$;

revoke execute on all functions in schema coop_explore_admin from public; -- defence in depth: the schema is already private

do $$
begin
  drop event trigger if exists coop_explore_guard_ddl;
  create event trigger coop_explore_guard_ddl on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE', 'CREATE VIEW', 'ALTER VIEW', 'CREATE MATERIALIZED VIEW',
                 'ALTER MATERIALIZED VIEW', 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE', 'GRANT', 'REVOKE', 'ALTER DEFAULT PRIVILEGES')
    execute function coop_explore_admin.guard_ddl();
  raise notice 'event trigger coop_explore_guard_ddl installed';
exception when insufficient_privilege then
  raise notice 'event trigger NOT installed (%): the 5-minute pg_cron job below is the only guard for new objects', sqlerrm;
end $$;

-- 6. pg_cron backstop (skipped triggers: superuser or reserved-role DDL) ------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron could not be enabled here (%): enable it in Database > Extensions, then re-run this file', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('coop_explore_reapply', '*/5 * * * *', 'select coop_explore_admin.reapply_all()');
    raise notice 'pg_cron job coop_explore_reapply scheduled (every 5 minutes)';
  else
    raise notice 'pg_cron is not enabled: new objects rely on the event trigger alone until it is';
  end if;
end $$;
