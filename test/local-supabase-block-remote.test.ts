import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// The local harness's safety net (scripts/local-supabase/block-remote.cjs): a local run must never reach a hosted
// Supabase project. Offline: the matcher is pure, and the preload is exercised in a child process that never leaves the machine.
const dir = join(process.cwd(), 'scripts', 'local-supabase');
const {isBlockedHost, hostOf} = createRequire(import.meta.url)(join(dir, 'block-remote-match.cjs')) as {
  isBlockedHost: (h: unknown) => boolean;
  hostOf: (a: unknown) => string;
};

describe('isBlockedHost', () => {
  it.each(['abcd.supabase.co', 'ABCD.Supabase.CO', 'abcd.supabase.co.', 'abcd.supabase.co:443', 'x.y.supabase.in', 'api.supabase.net', 'supabase.co'])('blocks %s', (h) => {
    expect(isBlockedHost(h)).toBe(true);
  });

  it.each(['127.0.0.1', 'localhost', '127.0.0.1:54420', 'api.anthropic.com', 'notsupabase.co', 'supabase.co.evil.com', 'supabase.com', '', 'abc.supabase.io'])('allows %s', (h) => {
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

  it('lets a loopback request through to the real stack (here: a refused connection, not a block)', () => {
    const out = run(`
      fetch('http://127.0.0.1:9/x').then(() => console.log('ok'), (e) => console.log(/block-remote/.test(String(e.message) + String(e.cause)) ? 'blocked' : 'passed-through'));
    `);
    expect(out).toBe('passed-through');
  });
});
