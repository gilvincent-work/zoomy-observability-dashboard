-- ============================================================================================================
-- NEEDS ZOOMY-POS SIGN-OFF. DO NOT RUN WITHOUT THE OWNER OF THESE FUNCTIONS.
-- ============================================================================================================
-- OPTIONAL. NOT part of the default apply of coop_chat_readonly.sql. The transaction-level hook in that file
-- already makes coop_chat_ro unable to write, even through a callable SECURITY DEFINER function. This sweep is the
-- belt to that braces: it removes the default PUBLIC execute grant from every SECURITY DEFINER function in public and
-- grants execute explicitly to anon, authenticated and service_role, so existing callers keep working and only
-- roles outside that list (such as coop_chat_ro) lose access.
-- Risk: any other role that relied on the PUBLIC grant (a custom role, a pg_cron job running as another role) would
-- break. zoomy-pos must confirm. New functions created later get the PUBLIC grant again unless
-- `alter default privileges in schema public revoke execute on functions from public` is also agreed (not done here).
--
-- DEFAULT IS A DRY RUN: it only prints (NOTICE) what it would do. Set apply := true to execute the statements.

do $$
declare
  apply boolean := false;     -- <<< set to true ONLY after zoomy-pos sign-off
  f record;
  stmt text;
begin
  perform set_config('search_path', 'pg_catalog', true);   -- makes regprocedure print schema-qualified names
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- skip extension-owned
      and (p.proacl is null                                                                   -- null acl = default PUBLIC execute
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
    order by 1::text
  loop
    stmt := format('revoke execute on function %s from public; grant execute on function %s to anon, authenticated, service_role;', f.sig, f.sig);
    if apply then
      begin
        execute stmt;
        raise notice 'APPLIED: %', stmt;
      exception when others then
        raise notice 'FAILED (%): %', sqlerrm, stmt;
      end;
    else
      raise notice 'DRY RUN would run: %', stmt;
    end if;
  end loop;
end $$;

-- Equivalent commented-out dry-run list (run this select alone to get the statements as rows):
-- select format('revoke execute on function %s from public; grant execute on function %s to anon, authenticated, service_role;', p.oid::regprocedure, p.oid::regprocedure) as statement
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prosecdef
--   and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
-- order by 1;

notify pgrst, 'reload schema';
