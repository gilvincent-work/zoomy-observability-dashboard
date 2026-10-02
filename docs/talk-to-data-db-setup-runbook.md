# Talk to Data: database setup runbook (staging done, PROD next)

Steps to set up the database side of Ask Coop (Talk to Data) and Coop Reports on one Supabase project. Run it on **staging first**, then repeat it unchanged on **PROD**. About 20 minutes per project. Nothing here changes what users see until the code is deployed with the env vars in step 7.

**Safe to re-run:** every SQL file is idempotent. Nothing here touches `pos_*` tables, only a role, views, two new tables and grants.

| Project | Status | Verified |
|---|---|---|
| Staging | **Done 2026-10-02** | Steps 2 to 5 passed: role `coop_chat_ro` exists with no login; 8 `coop_chat_*` views; both report tables with row-level security on; proof grid **ALL PASS, 49 of 49** (read 145 orders, 313 order lines, 30 products, 3 bundles, 30 prices) |
| PROD | **Not done** | Done by the PROD owner; repeat steps 1 to 8 |

Files (in `supabase/`, on branch `feat/talk-to-data-spikes`): `coop_chat_readonly.sql`, `coop_chat_digest.sql`, `coop_reports.sql`, `coop_chat_readonly_proof_grid.sql`.

## Before you start

1. **Right project?** Open the Supabase dashboard for the project you intend (check the project name top left). The SQL editor acts on whichever project is open. Do staging first; do PROD only after staging passed.
2. **Settings → JWT Keys:** the **legacy JWT secret** must be shown as in use (not revoked). If it was revoked, stop and ask the developer: the plan changes.
3. **Check for an existing pre-request hook** (read-only query):
   ```sql
   select rolname, unnest(rolconfig) as setting from pg_roles where rolname = 'authenticator';
   ```
   If a row mentions `pgrst.db_pre_request`, the apply script skips its own hook section and prints a notice. Then add this to your existing function by hand: `if current_user = 'coop_chat_ro' then perform set_config('transaction_read_only', 'on', true); end if;` (see `coop_chat_readonly.sql` section 3 for the exact lines). If there is no row, do nothing.

## Apply (SQL editor, in this order)

4. Open **SQL Editor → New query**. Paste the **entire** file and click **Run**. After each file you should see **"Success. No rows returned"**: that is the correct result for these files (they only create things, so there are no rows to show).
   1. `supabase/coop_chat_readonly.sql`: the read-only role and 7 views. Needs the `pos_*` tables to exist.
   2. `supabase/coop_chat_digest.sql`: the digest view. Needs step 1 first.
   3. `supabase/coop_reports.sql`: the two report tables.
5. **Verify it applied.** Paste this, run it, and compare:
   ```sql
   select 'role coop_chat_ro' as item,
          coalesce((select 'exists, can_login=' || rolcanlogin from pg_roles where rolname = 'coop_chat_ro'), 'MISSING') as result
   union all
   select 'views coop_chat_*',
          coalesce((select count(*)::text || ': ' || string_agg(table_name, ', ' order by table_name)
                    from information_schema.views where table_schema = 'public' and table_name like 'coop_chat_%'), 'MISSING')
   union all
   select 'table coop_reports', coalesce(to_regclass('public.coop_reports')::text, 'MISSING')
   union all
   select 'table coop_report_versions', coalesce(to_regclass('public.coop_report_versions')::text, 'MISSING')
   union all
   select 'rls coop_reports', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.coop_reports')), 'n/a')
   union all
   select 'rls coop_report_versions', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.coop_report_versions')), 'n/a');
   ```
   **Expected:** `exists, can_login=false`; `8: coop_chat_bundles, coop_chat_digest, coop_chat_events, ...`; both table names (not `MISSING`); both `rls` rows `true`. Any `MISSING`: re-run the file that creates it (step 4) and check again.
6. **Run the proof.** Paste the entire `supabase/coop_chat_readonly_proof_grid.sql` and run it. **Expected:** first row `ALL PASS` with `49 pass, 0 fail, 49 checks`, then 49 `PASS` rows. Any `FAIL` row names the broken check: stop and ask the developer before going on. It only reads; every write it attempts is refused (and undoes itself if not), and it resets the role at the end. (Why a grid: the Supabase editor hides `RAISE NOTICE` output, so the older `coop_chat_readonly_proof.sql` shows only "Success".)

## After the SQL: the app settings (Vercel, the matching deployment)

7. Set these on the deployment that uses this database (staging deploy for staging, production deploy for PROD), **server-side only, never `NEXT_PUBLIC_`**, then **redeploy** (a redeploy is required after env changes):
   - `CHAT_READ_MODE` = `ro_role`
   - `CHAT_RO_JWT_SECRET` = the **legacy JWT secret** from Settings → JWT Keys. Treat it like the service-role key: anyone holding it can mint any role. Do not paste it in chat, tickets or shell history.
   - `ALLOWED_EMAILS` = the comma-separated list of Google accounts allowed in. **Do this before anyone uses saved reports**: when empty, any Google account can sign in.
   - Optional: `CHAT_RO_APIKEY` = the project's anon/publishable key, only if the gateway rejects the minted token without an apikey.
8. **Smoke check after the deploy:** open Ask Coop, ask "how many orders last week?" (the chat should answer from live data, not say live data is unavailable), build a dashboard, click **Save report**, open **Reports** (the list should show it, not "Reports not set up").

If the chat says live data is not available after the deploy, the env vars are missing or the SQL is not applied: it falls back to digest-only on purpose (it never fails open to the service role).

## What can go wrong

| Symptom | Cause | Fix |
|---|---|---|
| "Success. No rows returned" on the proof | You ran the old `coop_chat_readonly_proof.sql` (notices hidden) | Run `coop_chat_readonly_proof_grid.sql` |
| `permission denied to create role` | The SQL editor user cannot create roles | Use the project's `postgres` role in the SQL editor (the default) |
| Proof row `FAIL read view coop_chat_digest` | `coop_chat_digest.sql` not applied (or `digest_archive` missing) | Re-run step 4.2 |
| `Reports not set up` in the app | `coop_reports.sql` not applied on that project | Re-run step 4.3, check step 5 |
| Chat answers digest-only | `CHAT_READ_MODE`/`CHAT_RO_JWT_SECRET` missing or the redeploy was skipped | Step 7 |
| Hook notice says skipped | The project already has a pre-request hook | Add the two lines by hand (before-you-start step 3) |

## Rollback (only if something goes wrong, PROD owner decides)

Nothing here modifies existing tables, so rollback is dropping what was added. Run in the SQL editor, and only on the project that needs it:
```sql
drop view if exists public.coop_chat_digest, public.coop_chat_orders, public.coop_chat_order_items, public.coop_chat_products,
  public.coop_chat_bundles, public.coop_chat_prices, public.coop_chat_price_changes, public.coop_chat_events;
drop table if exists public.coop_report_versions, public.coop_reports;   -- deletes saved reports
-- drop role coop_chat_ro;   -- only if nothing else uses it; revoke its grants first if the drop is refused
```
Also remove the three env vars in Vercel and redeploy: the chat then falls back to digest-only.

## Record when done

Add a line to `CHANGELOG.md` or the PR: the project, the date, who ran it, and the proof result (`ALL PASS, 49 of 49`).

## Later: automating this

`docs/ci-and-migrations.md` (branch `chore/ci-db-migrations`) describes a migration runner that checks or applies the same SQL from GitHub Actions per environment. Until it is merged and configured, this runbook is the process.
