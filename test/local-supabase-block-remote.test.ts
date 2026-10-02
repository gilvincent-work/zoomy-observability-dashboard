import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

// The local harness's safety net (scripts/local-supabase/block-remote.cjs): a local run must never reach a hosted
// Supabase project. Offline: the matcher is pure, and the preload is exercised in a child process that never leaves the machine.
const dir = join(process.cwd(), 'scripts', 'local-supabase');
const {isBlockedHost, hostOf, customBlockedHosts} = createRequire(import.meta.url)(join(dir, 'block-remote-match.cjs')) as {
  isBlockedHost: (h: unknown) => boolean;
  hostOf: (a: unknown) => string;
  customBlockedHosts: (env?: Record<string, string | undefined>) => string[];
};

describe('isBlockedHost', () => {
  it.each(['abcd.supabase.co', 'ABCD.Supabase.CO', 'abcd.supabase.co.', 'abcd.supabase.co:443', 'x.y.supabase.in', 'api.supabase.net', 'supabase.co'])('blocks %s', (h) => {
    expect(isBlockedHost(h)).toBe(true);
  });

  it.each(['127.0.0.1', 'localhost', '127.0.0.1:54420', 'api.anthropic.com', 'notsupabase.co', 'supabase.co.evil.com', 'supabase.com', '', 'abc.supabase.io'])('allows %s', (h) => {
    expect(isBlockedHost(h)).toBe(false);
  });

  // GAP-02: the connection pooler and every other *.supabase.com host are hosted Supabase too, and were not covered.
  it.each(['aws-0-ap-southeast-1.pooler.supabase.com', 'AWS-0-US-EAST-1.POOLER.SUPABASE.COM', 'aws-0-eu-west-2.pooler.supabase.com:6543', 'aws-0-ap-southeast-1.pooler.supabase.com.', 'db.abcd.supabase.com', 'api.supabase.com'])('blocks %s (pooler and *.supabase.com)', (h) => {
    expect(isBlockedHost(h)).toBe(true);
  });

  it.each(['supabase.com', 'notsupabase.com', 'supabase.com.evil.example', 'aws-0.pooler.supabase.com.evil.example', 'pooler.supabase.example'])('still allows %s', (h) => {
    expect(isBlockedHost(h)).toBe(false);
  });

  it('allows non-strings', () => {
    expect(isBlockedHost(undefined)).toBe(false);
    expect(isBlockedHost(42)).toBe(false);
  });
});

describe('hostOf', () => {
  it('reads strings, URLs, Requests and request options', () => {
    expect(hostOf('https://abcd.supabase.co/rest/v1/x?select=a')).toBe('abcd.supabase.co');
    expect(hostOf(new URL('https://abcd.supabase.co/x'))).toBe('abcd.supabase.co');
    expect(hostOf(new Request('https://abcd.supabase.co/x'))).toBe('abcd.supabase.co');
    expect(hostOf({hostname: 'abcd.supabase.co'})).toBe('abcd.supabase.co');
    expect(hostOf({host: 'abcd.supabase.co:443'})).toBe('abcd.supabase.co:443');
    expect(hostOf('https://localhost@abcd.supabase.co/x')).toBe('abcd.supabase.co'); // user-info tricks do not hide the host
  });

  it('returns an empty string when it cannot tell', () => {
    expect(hostOf('not a url')).toBe('');
    expect(hostOf(undefined)).toBe('');
  });
});

describe('the preload, in a child process', () => {
  const run = (code: string): string =>
    execFileSync(process.execPath, ['--require', join(dir, 'block-remote.cjs'), '-e', code], {encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']}).trim();

  it('rejects fetch, http.request and https.get to a hosted Supabase host before any connection', () => {
    const out = run(`
      const http = require('node:http'); const https = require('node:https');
      const tries = [
        () => fetch('https://abcd.supabase.co/rest/v1/pos_orders?select=id'),
        () => http.request({hostname: 'abcd.supabase.in', path: '/'}),
        () => https.get('https://abcd.supabase.net/rest/v1/x'),
      ];
      (async () => {
        const r = [];
        for (const t of tries) { try { await t(); r.push('reached'); } catch (e) { r.push(/block-remote/.test(e.message) ? 'blocked' : 'other:' + e.message); } }
        console.log(r.join(','));
      })();
    `);
    expect(out).toBe('blocked,blocked,blocked');
  });

  it('blocks the pooler host, another *.supabase.com host and a COOP_BLOCK_HOSTS domain; an unlisted custom domain is not blocked', () => {
    const out = execFileSync(
      process.execPath,
      [
        '--require', join(dir, 'block-remote.cjs'), '-e',
        `
      const tries = ['https://aws-0-ap-southeast-1.pooler.supabase.com:6543/x', 'https://api.supabase.com/v1/projects', 'https://db.listed.example/rest/v1/x', 'https://db.unlisted.example/rest/v1/x'];
      (async () => {
        const r = [];
        for (const u of tries) { try { await fetch(u, {signal: AbortSignal.abort()}); r.push('reached'); } catch (e) { r.push(/block-remote/.test(e.message) ? 'blocked' : 'passed-through'); } }
        console.log(r.join(','));
      })();
    `,
      ],
      {encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, COOP_BLOCK_HOSTS: 'db.listed.example'}},
    ).trim();
    expect(out).toBe('blocked,blocked,blocked,passed-through');
  });

  it('lets a loopback request through to the real stack (here: a refused connection, not a block)', () => {
    const out = run(`
      fetch('http://127.0.0.1:9/x').then(() => console.log('ok'), (e) => console.log(/block-remote/.test(String(e.message) + String(e.cause)) ? 'blocked' : 'passed-through'));
    `);
    expect(out).toBe('passed-through');
  });
});

// A custom domain in front of a hosted project looks like any other host, so it is blocked only when it is listed (COOP_BLOCK_HOSTS).
describe('COOP_BLOCK_HOSTS: custom domains, blocked only when listed', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('a custom domain is allowed until it is listed, then it and its subdomains are blocked', () => {
    vi.stubEnv('COOP_BLOCK_HOSTS', '');
    expect(isBlockedHost('db.customdomain.example')).toBe(false);
    vi.stubEnv('COOP_BLOCK_HOSTS', 'db.customdomain.example');
    expect(isBlockedHost('db.customdomain.example')).toBe(true);
    expect(isBlockedHost('DB.CustomDomain.Example:5432')).toBe(true);
    expect(isBlockedHost('x.db.customdomain.example')).toBe(true);
    expect(isBlockedHost('customdomain.example')).toBe(false); // the parent of a listed host is not listed
    expect(isBlockedHost('evildb.customdomain.example')).toBe(false);
    expect(isBlockedHost('db.customdomain.example.evil.test')).toBe(false);
  });

  it('several entries, spaces and blanks are tolerated; the variable is read at call time', () => {
    vi.stubEnv('COOP_BLOCK_HOSTS', ' a.example , ,b.example,, ');
    expect(isBlockedHost('a.example')).toBe(true);
    expect(isBlockedHost('b.example')).toBe(true);
    expect(isBlockedHost('c.example')).toBe(false);
    vi.stubEnv('COOP_BLOCK_HOSTS', 'c.example');
    expect(isBlockedHost('a.example')).toBe(false);
    expect(isBlockedHost('c.example')).toBe(true);
  });

  it('an entry may be written as *.host, .host, a URL or host:port', () => {
    expect(customBlockedHosts({COOP_BLOCK_HOSTS: '*.wild.example,.dot.example,https://user:pw@url.example:5432/db?x=1,port.example:6543'})).toEqual(['wild.example', 'dot.example', 'url.example', 'port.example']);
  });

  it('unusable entries are dropped, and the local stack can never be blocked by a typo', () => {
    expect(customBlockedHosts({COOP_BLOCK_HOSTS: 'localhost,127.0.0.1,127.1.2.3,sub.localhost,com,*,.,'})).toEqual([]);
    expect(customBlockedHosts({})).toEqual([]);
    vi.stubEnv('COOP_BLOCK_HOSTS', 'localhost,127.0.0.1');
    expect(isBlockedHost('127.0.0.1')).toBe(false);
    expect(isBlockedHost('localhost')).toBe(false);
  });

  it('the built-in patterns keep working when the variable is set', () => {
    vi.stubEnv('COOP_BLOCK_HOSTS', 'db.customdomain.example');
    expect(isBlockedHost('abcd.supabase.co')).toBe(true);
    expect(isBlockedHost('api.anthropic.com')).toBe(false);
  });
});
