import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {assertLocalRun} from '../scripts/chat-eval.mjs';
import {LOCAL_HOSTS, assertLocalPostgres, assertLocalSupabase, isLocalPostgresUrl, isLocalSupabaseUrl} from './support/local-only';
import {buildsClient, callsLocalGuard, unguardedClient} from './support/local-only-scan';

// Owner rule: the Supabase project in .env is PRODUCTION. Every test and script that can connect must refuse anything that is not
// the throwaway local stack. One helper (scripts/local-only.mjs), unit-tested here, and a scan that fails when an integration
// test builds a Supabase client without calling it. All offline.

describe('assertLocalSupabase', () => {
  it('accepts only 127.0.0.1 and localhost', () => {
    expect(LOCAL_HOSTS).toEqual(['127.0.0.1', 'localhost']);
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54420', 'http://127.0.0.1', 'https://localhost', 'HTTP://LOCALHOST:54321/rest/v1', 'http://127.1:54321']) {
      expect(isLocalSupabaseUrl(url), url).toBe(true);
      expect(() => assertLocalSupabase(url), url).not.toThrow();
    }
  });

  it('refuses a hosted Supabase project', () => {
    for (const url of ['https://abcdefgh.supabase.co', 'https://abcdefgh.supabase.co/rest/v1', 'https://aws-0-ap.pooler.supabase.com:6543', 'https://db.example.com']) {
      expect(isLocalSupabaseUrl(url), url).toBe(false);
      expect(() => assertLocalSupabase(url), url).toThrow(/refusing to run/);
    }
  });

  it('refuses lookalike hosts', () => {
    for (const url of ['http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://evil-127.0.0.1.com', 'http://localhost.', 'http://127.0.0.1.supabase.co:54321', 'http://xlocalhost']) {
      expect(isLocalSupabaseUrl(url), url).toBe(false);
    }
  });

  it('refuses userinfo and backslash tricks, whichever way they point', () => {
    for (const url of ['http://127.0.0.1@evil.com', 'http://localhost:x@evil.com', 'http://evil.com@127.0.0.1', 'http://user:pass@localhost:54321', 'http://evil.com\\@127.0.0.1', 'http://evil.com#@127.0.0.1', 'http://evil.com/@127.0.0.1', 'http://evil.com?@localhost']) {
      expect(isLocalSupabaseUrl(url), url).toBe(false);
    }
  });

  it('refuses IPv6 loopback, other private ranges and non-http schemes (only the two named hosts are allowed)', () => {
    for (const url of ['http://[::1]:54321', 'http://[::ffff:127.0.0.1]', 'http://0.0.0.0:54321', 'http://10.0.0.5:54321', 'http://192.168.1.2', 'file:///127.0.0.1', 'ws://127.0.0.1', 'ftp://localhost']) {
      expect(isLocalSupabaseUrl(url), url).toBe(false);
    }
  });

  it('refuses missing or unparseable input', () => {
    for (const url of [undefined, null, '', '   ', 'not a url', '127.0.0.1:54321', '//127.0.0.1']) {
      expect(isLocalSupabaseUrl(url as string | undefined), String(url)).toBe(false);
      expect(() => assertLocalSupabase(url as string | undefined)).toThrow(/refusing to run/);
    }
  });

  it('never echoes the URL in the error', () => {
    for (const url of ['https://abcdefgh.supabase.co?key=SECRETKEY', 'http://user:SECRETPASS@evil.example']) {
      let message = '';
      try {
        assertLocalSupabase(url);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toMatch(/abcdefgh|supabase\.co|SECRET|evil/);
    }
  });

  it('the live-eval gate shares the same rule', () => {
    const ok = {CHAT_LIVE_EVAL: '1', SUPABASE_URL_ARCHIVE: 'http://127.0.0.1:54420', SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'k', ANTHROPIC_API_KEY: 'k'};
    expect(assertLocalRun(ok).ok).toBe(true);
    for (const url of ['http://127.0.0.1@evil.com', 'http://127.0.0.1.evil.com', 'http://[::1]:54321', 'https://abcdefgh.supabase.co']) {
      expect(assertLocalRun({...ok, SUPABASE_URL_ARCHIVE: url}).ok, url).toBe(false);
    }
  });
});

describe('the integration-test scan', () => {
  it('flags a source that builds a client without the guard', () => {
    expect(unguardedClient("import {createClient} from '@supabase/supabase-js';\nconst sb = createClient(process.env.SUPABASE_URL_ARCHIVE!, k);")).toBe(true);
    expect(unguardedClient("const {client} = chatDigestClient({mode, env});")).toBe(true);
    expect(unguardedClient("const sb = posClient();")).toBe(true);
    expect(unguardedClient("const u = process.env.SUPABASE_URL_ARCHIVE;")).toBe(true);
  });

  it('a comment is not the guard', () => {
    expect(unguardedClient("// assertLocalSupabase(url)\nconst sb = createClient(u, k);")).toBe(true);
    expect(unguardedClient("/* assertLocalSupabase(url) */ const sb = createClient(u, k);")).toBe(true);
    expect(callsLocalGuard('// assertLocalSupabase(url)')).toBe(false);
  });

  it('passes a guarded client and a file with no client at all', () => {
    expect(unguardedClient("import {assertLocalSupabase} from './support/local-only';\nassertLocalSupabase(u);\nconst sb = createClient(u, k);")).toBe(false);
    expect(unguardedClient("const anthropic = new Anthropic({apiKey});")).toBe(false);
    expect(buildsClient("const anthropic = new Anthropic({apiKey});")).toBe(false);
  });

  it('every test/*.integration.test.ts that builds a Supabase client calls assertLocalSupabase', () => {
    const files = readdirSync('test').filter((f) => f.endsWith('.integration.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    const unguarded = files.filter((f) => unguardedClient(readFileSync(path.join('test', f), 'utf8')));
    expect(unguarded).toEqual([]);
  });

  it('the older unguarded live test is gone (the golden live test supersedes it)', () => {
    expect(readdirSync('test')).not.toContain('chat-live.integration.test.ts');
  });

  it('every script that connects to a local stack calls the shared guard', () => {
    for (const f of ['scripts/coop-chat-ro-proof.mjs', 'scripts/spikes/readonly-role.mjs']) {
      expect(callsLocalGuard(readFileSync(f, 'utf8')), f).toBe(true);
    }
    expect(readFileSync('scripts/chat-eval.mjs', 'utf8')).toMatch(/isLocalSupabaseUrl\(raw\)/);
  });
});

// Spec 5.3: the same contract for a Postgres connection string (the Explore role proof and tests open real Postgres connections).
describe('assertLocalPostgres', () => {
  it('accepts a local postgres URL with userinfo, with or without a port or a query', () => {
    for (const url of [
      'postgres://coop_explore_ro:secret@127.0.0.1:54421/postgres',
      'postgresql://coop_explore_ro:secret@localhost:54421/postgres',
      'postgres://u:p@127.0.0.1/db?sslmode=disable',
      'POSTGRES://u:p@LOCALHOST:5432/db',
      'postgres://u@127.0.0.1',
      'postgres://127.0.0.1:54421/postgres',
    ]) {
      expect(isLocalPostgresUrl(url), url).toBe(true);
      expect(() => assertLocalPostgres(url), url).not.toThrow();
    }
  });

  it('refuses hosted databases and the Supabase pooler', () => {
    for (const url of [
      'postgres://coop_explore_ro.abcdefgh:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      'postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://u:p@db.example.com/db',
      'postgres://u:p@10.0.0.5:5432/db',
      'postgres://u:p@[::1]:5432/db',
      'postgres://u:p@0.0.0.0/db',
    ]) {
      expect(isLocalPostgresUrl(url), url).toBe(false);
      expect(() => assertLocalPostgres(url), url).toThrow(/refusing to run/);
    }
  });

  it('refuses the wrong protocol, missing and unparseable input', () => {
    for (const url of ['http://127.0.0.1:54421', 'https://localhost', 'mysql://u:p@127.0.0.1/db', 'ws://127.0.0.1', undefined, null, '', '   ', 'not a url', '127.0.0.1:54421', '//127.0.0.1']) {
      expect(isLocalPostgresUrl(url as string | undefined), String(url)).toBe(false);
      expect(() => assertLocalPostgres(url as string | undefined)).toThrow(/refusing to run/);
    }
  });

  it('refuses @-tricks, host lists, backslashes, lookalikes and a query that sets the host', () => {
    for (const url of [
      'postgres://u:p@evil.com@127.0.0.1/db', // WHATWG says 127.0.0.1, the driver reads the text after the FIRST @
      'postgres://127.0.0.1@evil.com/db',
      'postgres://u:p@127.0.0.1,evil.example/db', // the driver tries every host of a list
      'postgres://u:p@evil.com,127.0.0.1/db',
      'postgres://u:p@evil.com\\@127.0.0.1/db',
      'postgres://u:p@127.0.0.1.evil.com/db',
      'postgres://u:p@localhost.evil.com/db',
      'postgres://u:p@localhost./db',
      'postgres://u:p@127.0.0.1/db?host=evil.example',
      'postgres://u:p@127.0.0.1/db?hostaddr=8.8.8.8',
      'postgres://u:p@evil.com/db#@127.0.0.1',
      'postgres://u:p@evil.com?@127.0.0.1',
      'postgres://u:p@127.0.0.1\t.evil.com/db',
    ]) {
      expect(isLocalPostgresUrl(url), url).toBe(false);
    }
  });

  it('never echoes the URL (it carries a password)', () => {
    for (const url of ['postgres://u:SECRETPASS@db.abcdefgh.supabase.co/postgres', 'postgres://u:SECRETPASS@evil.example/db']) {
      let message = '';
      try {
        assertLocalPostgres(url);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toMatch(/SECRETPASS|abcdefgh|supabase|evil/);
    }
  });
});

describe('the integration-test scan knows about Postgres clients (spec 5.3)', () => {
  it('flags the postgres driver and EXPLORE_DATABASE_URL without a guard; assertLocalPostgres is an accepted guard', () => {
    expect(unguardedClient("import postgres from 'postgres';\nconst sql = postgres(url);")).toBe(true);
    expect(unguardedClient('const url = process.env.EXPLORE_DATABASE_URL;')).toBe(true);
    expect(unguardedClient("import postgres from 'postgres';\nassertLocalPostgres(url);\nconst sql = postgres(url);")).toBe(false);
    expect(callsLocalGuard('assertLocalPostgres(url)')).toBe(true);
    expect(callsLocalGuard('// assertLocalPostgres(url)')).toBe(false);
    expect(buildsClient("import postgres from 'postgres';")).toBe(true);
  });
});
