import {describe, expect, it} from 'vitest';
import {isLocalPostgresUrl} from './support/local-only';
import {loadExploreLimits, resolveExploreAccess} from '../src/chat/explore/config';
import {DEFAULT_EXPLORE_LIMITS, EXPLORE_LIMIT_CEILINGS, EXPLORE_LIMIT_ENV} from '../src/chat/explore/limits';
import type {ExploreEnv} from '../src/chat/explore/types';

// Spec 3.6: Explore is on only if every rule holds. The matrix below flips one rule at a time from a known-good dev env.

const LOCAL_URL = 'postgres://coop_explore_ro:pw@127.0.0.1:54421/postgres';
const DEV: ExploreEnv = {NODE_ENV: 'development', EXPLORE_MODE: 'on', EXPLORE_DATABASE_URL: LOCAL_URL, EXPLORE_ALLOWED_EMAILS: 'dev@localhost'};
const PROD: ExploreEnv = {
  NODE_ENV: 'production',
  EXPLORE_MODE: 'on',
  EXPLORE_DATABASE_URL: 'postgres://coop_explore_ro.abcdefgh:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
  EXPLORE_ALLOWED_EMAILS: 'Owner@Example.com, admin@example.com',
  ALLOWED_EMAILS: 'owner@example.com',
  CHAT_READ_MODE: 'ro_role',
};
const reason = (env: ExploreEnv, email: string | null) => {
  const r = resolveExploreAccess(env, email);
  return r.enabled ? 'ENABLED' : r.reason;
};

describe('EXP-02 resolveExploreAccess: fail closed (spec 3.6)', () => {
  it('the known-good dev and prod envs are enabled', () => {
    expect(reason(DEV, 'dev@localhost')).toBe('ENABLED');
    expect(reason(PROD, 'owner@example.com')).toBe('ENABLED');
  });

  it('1. EXPLORE_MODE must be exactly "on" (unset, off, ON, true, 1, " on" are all off)', () => {
    for (const mode of [undefined, 'off', 'ON', 'On', 'true', '1', ' on', 'on ', 'yes', '']) {
      expect(reason({...DEV, EXPLORE_MODE: mode}, 'dev@localhost'), String(mode)).toBe('mode_off');
    }
  });

  it('2. the URL must exist, parse as postgres://, and log in as coop_explore_ro (or its pooler form)', () => {
    expect(reason({...DEV, EXPLORE_DATABASE_URL: undefined}, 'dev@localhost')).toBe('url_missing');
    expect(reason({...DEV, EXPLORE_DATABASE_URL: '   '}, 'dev@localhost')).toBe('url_missing');
    for (const bad of ['not a url', 'http://127.0.0.1:54421', 'mysql://coop_explore_ro:p@127.0.0.1/db', '127.0.0.1:54421']) {
      expect(reason({...DEV, EXPLORE_DATABASE_URL: bad}, 'dev@localhost'), bad).toBe('url_invalid');
    }
    for (const user of ['postgres', 'supabase_admin', 'service_role', 'authenticator', 'coop_chat_ro', 'coop_explore_rw', 'coop_explore_roX', 'xcoop_explore_ro']) {
      expect(reason({...DEV, EXPLORE_DATABASE_URL: `postgres://${user}:pw@127.0.0.1:54421/postgres`}, 'dev@localhost'), user).toBe('url_role');
    }
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgres://127.0.0.1:54421/postgres'}, 'dev@localhost')).toBe('url_role'); // no user at all
    // accepted forms
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgresql://coop_explore_ro.projref:pw@localhost:5432/postgres'}, 'dev@localhost')).toBe('ENABLED');
  });

  it('2b. an @-trick that hides the role is refused (the user is whatever the parser says, not what the text starts with)', () => {
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgres://postgres:coop_explore_ro@127.0.0.1:54421/postgres'}, 'dev@localhost')).toBe('url_role');
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgres://coop_explore_ro@evil.com@127.0.0.1:54421/postgres'}, 'dev@localhost')).not.toBe('ENABLED');
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgres://coop_explore_ro:pw@127.0.0.1,evil.example/postgres'}, 'dev@localhost')).toBe('url_invalid');
    expect(reason({...DEV, EXPLORE_DATABASE_URL: 'postgres://coop_explore_ro:pw@127.0.0.1/postgres?host=evil.example'}, 'dev@localhost')).toBe('url_invalid');
  });

  it('3. outside production the host must be 127.0.0.1 or localhost (dev and tests can never reach a hosted database)', () => {
    for (const host of ['db.abcdefgh.supabase.co', 'aws-0-ap.pooler.supabase.com:6543', '10.0.0.5', '0.0.0.0', '[::1]', '127.0.0.1.evil.com', 'localhost.evil.com', 'evil.com']) {
      expect(reason({...DEV, EXPLORE_DATABASE_URL: `postgres://coop_explore_ro:pw@${host}/postgres`}, 'dev@localhost'), host).toMatch(/^url_not_local$|^url_invalid$/);
    }
    for (const nodeEnv of [undefined, 'development', 'test', 'staging']) {
      expect(reason({...PROD, NODE_ENV: nodeEnv}, 'owner@example.com'), String(nodeEnv)).toBe('url_not_local');
    }
  });

  it('4. production needs CHAT_READ_MODE=ro_role AND a non-empty ALLOWED_EMAILS', () => {
    for (const mode of [undefined, '', 'service', 'RO_ROLE', 'ro-role']) {
      expect(reason({...PROD, CHAT_READ_MODE: mode}, 'owner@example.com'), String(mode)).toBe('not_ro_role');
    }
    for (const list of [undefined, '', '   ', ' , ,']) {
      expect(reason({...PROD, ALLOWED_EMAILS: list}, 'owner@example.com'), String(list)).toBe('allowed_emails_unset');
    }
  });

  it('5. the signed-in email must be on EXPLORE_ALLOWED_EMAILS (trimmed, lowercased); an empty list is nobody', () => {
    expect(reason({...DEV, EXPLORE_ALLOWED_EMAILS: undefined}, 'dev@localhost')).toBe('list_empty');
    expect(reason({...DEV, EXPLORE_ALLOWED_EMAILS: ''}, 'dev@localhost')).toBe('list_empty');
    expect(reason({...DEV, EXPLORE_ALLOWED_EMAILS: ' , ,, '}, 'dev@localhost')).toBe('list_empty');
    expect(reason(DEV, null)).toBe('user_not_allowed');
    expect(reason(DEV, '')).toBe('user_not_allowed');
    expect(reason(DEV, 'someone@else.com')).toBe('user_not_allowed');
    expect(reason(DEV, 'dev@localhost.evil.com')).toBe('user_not_allowed');
    expect(reason(PROD, 'OWNER@EXAMPLE.COM')).toBe('ENABLED'); // list is mixed case; compare is lowercase
    expect(reason(PROD, ' admin@example.com ')).toBe('ENABLED');
    expect(reason(PROD, 'adm@example.com')).toBe('user_not_allowed');
    // ALLOWED_EMAILS (sign-in) is NOT the Explore list
    expect(reason({...DEV, EXPLORE_ALLOWED_EMAILS: undefined, ALLOWED_EMAILS: 'dev@localhost'}, 'dev@localhost')).toBe('list_empty');
  });

  it('every refusal carries only a reason code: no URL, no email, no secret', () => {
    const r = resolveExploreAccess({...DEV, EXPLORE_DATABASE_URL: 'postgres://postgres:TOPSECRET@db.abcdefgh.supabase.co/postgres'}, 'someone@example.com');
    expect(r.enabled).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/TOPSECRET|abcdefgh|someone|supabase/);
  });

  it('the enabled result carries the trimmed URL and the loaded limits', () => {
    const r = resolveExploreAccess({...DEV, EXPLORE_DATABASE_URL: `  ${LOCAL_URL}  `, EXPLORE_MAX_ROWS: '300'}, 'dev@localhost');
    expect(r.enabled).toBe(true);
    if (!r.enabled) return;
    expect(r.databaseUrl).toBe(LOCAL_URL);
    expect(r.limits.maxRows).toBe(300);
  });

  it('never throws, whatever it is given', () => {
    for (const env of [undefined, null, {}, {EXPLORE_MODE: 'on'}, {EXPLORE_MODE: 'on', EXPLORE_DATABASE_URL: 'postgres://%zz@127.0.0.1/db', EXPLORE_ALLOWED_EMAILS: 'a@b.c'}]) {
      for (const email of [null, 'a@b.c', undefined as unknown as string, 42 as unknown as string]) {
        expect(() => resolveExploreAccess(env as unknown as ExploreEnv, email)).not.toThrow();
        expect(resolveExploreAccess(env as unknown as ExploreEnv, email).enabled).toBe(false);
      }
    }
  });

  it('agrees with the shared local-only guard (scripts/local-only.mjs) on every outside-production URL', () => {
    const urls = [
      LOCAL_URL, 'postgresql://coop_explore_ro:pw@localhost:5432/db', 'postgres://coop_explore_ro:pw@127.0.0.1/db?sslmode=disable',
      'postgres://coop_explore_ro:pw@db.abcdefgh.supabase.co/db', 'postgres://coop_explore_ro:pw@127.0.0.1.evil.com/db',
      'postgres://coop_explore_ro:pw@evil.com@127.0.0.1/db', 'postgres://coop_explore_ro:pw@127.0.0.1,evil.com/db',
      'postgres://coop_explore_ro:pw@[::1]/db', 'postgres://coop_explore_ro:pw@10.0.0.5/db', 'postgres://coop_explore_ro:pw@localhost./db',
      'postgres://coop_explore_ro:pw@127.0.0.1/db?host=evil.example',
    ];
    for (const u of urls) {
      expect(reason({...DEV, EXPLORE_DATABASE_URL: u}, 'dev@localhost') === 'ENABLED', u).toBe(isLocalPostgresUrl(u));
    }
  });
});

describe('EXP-02 loadExploreLimits (spec 3.6 table)', () => {
  it('has the documented defaults and ceilings', () => {
    expect(DEFAULT_EXPLORE_LIMITS).toEqual({maxRows: 200, maxCols: 12, maxBytes: 65536, timeoutMs: 5000, maxSqlChars: 2000, maxCallsPerQuestion: 5, maxPerUserDay: 60, modelRows: 50, maxRelations: 8, maxDepth: 20});
    expect(EXPLORE_LIMIT_CEILINGS).toEqual({maxRows: 500, maxCols: 24, maxBytes: 262144, timeoutMs: 10000, maxSqlChars: 4000, maxCallsPerQuestion: 8, maxPerUserDay: 200, modelRows: 200, maxRelations: 12, maxDepth: 30});
    expect(EXPLORE_LIMIT_ENV).toEqual({
      maxRows: 'EXPLORE_MAX_ROWS', maxCols: 'EXPLORE_MAX_COLS', maxBytes: 'EXPLORE_MAX_BYTES', timeoutMs: 'EXPLORE_TIMEOUT_MS', maxSqlChars: 'EXPLORE_MAX_SQL_CHARS',
      maxCallsPerQuestion: 'EXPLORE_MAX_CALLS_PER_QUESTION', maxPerUserDay: 'EXPLORE_MAX_PER_USER_DAY', modelRows: 'EXPLORE_MODEL_ROWS', maxRelations: 'EXPLORE_MAX_RELATIONS', maxDepth: 'EXPLORE_MAX_DEPTH',
    });
  });

  it('no env gives the defaults', () => {
    expect(loadExploreLimits({})).toEqual(DEFAULT_EXPLORE_LIMITS);
  });

  it('a valid value inside the ceiling is used, for every knob', () => {
    for (const [knobName, envName] of Object.entries(EXPLORE_LIMIT_ENV)) {
      const k = knobName as keyof typeof DEFAULT_EXPLORE_LIMITS;
      const ceiling = EXPLORE_LIMIT_CEILINGS[k];
      expect(loadExploreLimits({[envName]: String(ceiling)})[k], `${envName} at the ceiling`).toBe(ceiling);
      expect(loadExploreLimits({[envName]: '3'})[k], `${envName}=3`).toBe(3);
      expect(loadExploreLimits({[envName]: ` ${ceiling} `})[k], `${envName} padded`).toBe(ceiling);
    }
  });

  it('invalid or out-of-range values fall back to the default and never throw', () => {
    for (const [knobName, envName] of Object.entries(EXPLORE_LIMIT_ENV)) {
      const k = knobName as keyof typeof DEFAULT_EXPLORE_LIMITS;
      const def = DEFAULT_EXPLORE_LIMITS[k];
      for (const bad of ['', ' ', 'abc', '0', '-5', '1.5', '1e3', '0x10', 'NaN', 'Infinity', String(EXPLORE_LIMIT_CEILINGS[k] + 1), '99999999999', '12abc', '٣']) {
        expect(loadExploreLimits({[envName]: bad})[k], `${envName}=${bad}`).toBe(def);
      }
    }
    expect(() => loadExploreLimits(undefined as unknown as ExploreEnv)).not.toThrow();
  });

  it('env can only move a value inside its ceiling: nothing can exceed it', () => {
    const everything = Object.fromEntries(Object.values(EXPLORE_LIMIT_ENV).map((n) => [n, '99999999']));
    const l = loadExploreLimits(everything);
    for (const k of Object.keys(l) as (keyof typeof l)[]) expect(l[k]).toBeLessThanOrEqual(EXPLORE_LIMIT_CEILINGS[k]);
  });
});
