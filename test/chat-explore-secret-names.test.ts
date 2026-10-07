import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  EXPLORE_SECRET_COLUMN_EXCEPTIONS, EXPLORE_SECRET_PARTS, EXPLORE_TENANT_PREFIXES, EXPLORE_TENANT_TABLES,
  isClosedRelation, isSecretColumn, isSecretName,
} from '../src/chat/explore/secret-names';

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
