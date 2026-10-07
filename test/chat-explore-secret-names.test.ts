import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  EXPLORE_SECRET_COLUMN_EXCEPTIONS, EXPLORE_SECRET_PARTS, EXPLORE_TENANT_PREFIXES, EXPLORE_TENANT_TABLES,
  isClosedRelation, isSecretColumn, isSecretName,
} from '../src/chat/explore/secret-names';
import {EXPLORE_VIEW_NAMES} from '../src/chat/explore/views';

const SQL = readFileSync('supabase/coop_chat_explore_direct.sql', 'utf8');
const arrayOf = (fn: string): string[] => {
  const m = new RegExp(`function coop_explore_admin\\.${fn}\\(\\)[\\s\\S]*?array\\[([^\\]]*)\\]`).exec(SQL);
  if (!m) throw new Error(`${fn} not found in the SQL`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
};

describe('EXP secret names (spec 1.3): one rule, SQL and TS copies equal', () => {
  it('parts, tenant prefixes, tenant tables and column exceptions match the SQL', () => {
    expect(arrayOf('secret_parts')).toEqual([...EXPLORE_SECRET_PARTS]);
    expect(arrayOf('tenant_prefixes')).toEqual([...EXPLORE_TENANT_PREFIXES]);
    expect(arrayOf('tenant_tables')).toEqual([...EXPLORE_TENANT_TABLES]);
    expect(arrayOf('column_exceptions')).toEqual([...EXPLORE_SECRET_COLUMN_EXCEPTIONS]);
  });

  it('the SQL splits words and forms plurals exactly like the TS', () => {
    expect(SQL).toContain("regexp_split_to_array(lower(name), '[^a-z0-9]+')");
    expect(SQL).toContain("w.word in (p.part, p.part || 's', p.part || 'es')");
  });

  it('keeps the security-review guards (fix round 1): whole-row views, PG 16+, grant option, trigger timeout', () => {
    expect(SQL).toMatch(/where a2\.attrelid = deps\.oid[\s\S]*?is_secret_column\(t\.relname, a2\.attname\)/);
    expect(SQL).toContain("current_setting('server_version_num')::int < 160000");
    expect(SQL.match(/case when x\.is_grantable then '\*' else '' end/g)?.length).toBe(4);
    expect(SQL).toContain('when query_canceled then');
  });

  it('keeps the round-2 guards: definer-function views closed, a swallowed cancel fails closed', () => {
    // round 3 folded the definer rule into the non-pg_catalog function rule; prosecdef stays explicit
    expect(SQL).toMatch(/when 'pg_catalog\.pg_proc'::regclass then d\.refobjid[\s\S]*?p\.prosecdef or/);
    expect(SQL).toMatch(/when query_canceled then[\s\S]*?pg_event_trigger_ddl_commands\(\)[\s\S]*?revoke all on public\.%I from coop_explore_ro cascade/);
  });

  it('keeps the round-3 guards: any non-pg_catalog function (direct, operator, cast) closes a view; one revoke failing keeps the rest', () => {
    expect(SQL).toContain("when 'pg_catalog.pg_operator'::regclass then o.oprcode::oid");
    expect(SQL).toContain("when 'pg_catalog.pg_cast'::regclass then k.castfunc");
    expect(SQL).toContain("and (p.prosecdef or pn.nspname <> 'pg_catalog'))");
    expect(SQL).toMatch(/loop\s+begin -- one sub-block per relation[\s\S]*?revoke all on public\.%I from coop_explore_ro cascade[\s\S]*?exception when query_canceled or others then[\s\S]*?end;\s+end loop;/);
    expect(SQL).toContain("select jobname from cron.job where jobname = 'coop_explore_reapply'");
    expect(SQL).toContain('select coop_explore_admin.reapply_all();');
  });

  it('fix round 4: views are default-deny, granted only through the one view_allowlist()', () => {
    const allowlist = arrayOf('view_allowlist');
    const chatViews = ['coop_chat_bundles', 'coop_chat_digest', 'coop_chat_events', 'coop_chat_order_items',
      'coop_chat_orders', 'coop_chat_price_changes', 'coop_chat_prices', 'coop_chat_products'];
    const expected = [...chatViews, ...EXPLORE_VIEW_NAMES, 'pos_inventory', 'pos_inventory_by_location'];
    expect([...allowlist].sort()).toEqual([...expected].sort());
    expect(allowlist).toHaveLength(25);
    expect(new Set(allowlist).size).toBe(allowlist.length);
    // the one decision: a view not on the list is closed, and a closed relation gets no table or column grant
    expect(SQL).toContain("or (r.relkind in ('v', 'm') and not (r.relname::text = any (coop_explore_admin.view_allowlist())))");
    expect(SQL).toContain("want_tab := case when closed or mixed then '{}'::text[] else array['SELECT'] end;");
    expect(SQL).toContain("want_cols := case when not closed and mixed then safe_cols else '{}'::text[] end;");
    // no other grant path: the only SELECT grants are apply_grants' two and the trigger-guarded default privileges
    const code = SQL.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    const grants = [...code.matchAll(/\bgrant\s+select\b[^;']*/gi)].map((m) => m[0].replace(/\s+/g, ' '));
    expect(grants).toEqual([
      'grant select on public.%I to coop_explore_ro',
      'grant select (%s) on public.%I to coop_explore_ro',
      'grant select on tables to coop_explore_ro',
    ]);
    expect(code).toMatch(/create event trigger coop_explore_guard_ddl[\s\S]*?alter default privileges for role postgres in schema public grant select on tables to coop_explore_ro;[\s\S]*?exception when insufficient_privilege then\s+[\s\S]*?revoke select on tables from coop_explore_ro;/);
    // the second layer stays, and the drift helper names every view that is not allowlisted
    expect(SQL).toContain('or coop_explore_admin.reads_closed(rel);');
    expect(SQL).toContain("format('view not allowlisted: %s (not readable until added)', c.relname)");
    expect(SQL).toContain('ADD A VIEW');
    expect(SQL).not.toMatch(/pg_sleep/);
  });

  it('matches whole word parts only', () => {
    for (const n of ['api_key', 'password_hash', 'refresh_token', 'marketplace_tokens', 'pin', 'PIN', 'client_secret', 'credentials', 'hashes', 'Api-Key']) {
      expect(isSecretName(n), n).toBe(true);
    }
    for (const n of ['shipping_fee', 'pinned', 'monkey', 'hashtag_count', 'keychain', 'tokenized_at', 'email', 'bundle', 'opening_cash', 'apikey']) {
      expect(isSecretName(n), n).toBe(false);
    }
  });

  it('closes secret and tenant tables, never a Zoomy table', () => {
    for (const t of ['marketplace_tokens', 'api_keys', 'gl_sales', 'gl_stores', 'companies', 'company_users', 'company_user_audit', 'company_user_prefs']) {
      expect(isClosedRelation(t), t).toBe(true);
    }
    for (const t of ['pos_orders', 'pos_settings', 'coop_reports', 'spin_wheel_leads', 'digest_archive', 'lazada_orders', 'company', 'glossary']) {
      expect(isClosedRelation(t), t).toBe(false);
    }
  });

  it('pos_settings.key is the one reviewed exception', () => {
    expect(isSecretColumn('pos_settings', 'key')).toBe(false);
    expect(isSecretColumn('pos_orders', 'key')).toBe(true);
    expect(isSecretColumn('marketplace_tokens', 'access_token')).toBe(true);
    expect(EXPLORE_SECRET_COLUMN_EXCEPTIONS).toEqual(['pos_settings.key']);
  });
});
