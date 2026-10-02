import {describe, it, expect} from 'vitest';
import {buildChatReadConfig} from '../src/chat/read/config';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const SERVICE = 'LEAKED-SERVICE-ROLE-KEY-DISTINCTIVE-9f8e7d';
const URL_ = 'https://example-ref.supabase.co';
const NOW = new Date('2026-10-01T00:00:00Z');
const base = {SUPABASE_URL_ARCHIVE: URL_, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: SERVICE, CHAT_RO_JWT_SECRET: SECRET};

describe('buildChatReadConfig', () => {
  it('guarded_service reads the service key and url', () => {
    expect(buildChatReadConfig({mode: 'guarded_service', env: base})).toEqual({url: URL_, key: SERVICE, mode: 'guarded_service'});
  });

  it('guarded_service ignores CHAT_RO_APIKEY', () => {
    const c = buildChatReadConfig({mode: 'guarded_service', env: {...base, CHAT_RO_APIKEY: 'anon-key'}});
    expect(c.apikey).toBeUndefined();
  });

  it('ro_role mints a token and never uses or leaks the service key', () => {
    const c = buildChatReadConfig({mode: 'ro_role', env: base, now: NOW});
    expect(c.mode).toBe('ro_role');
    expect(c.url).toBe(URL_);
    expect(c.key.split('.')).toHaveLength(3);
    expect(JSON.stringify(c)).not.toContain(SERVICE);
    // works with no service key in env at all
    const {SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: _omit, ...noService} = base;
    expect(buildChatReadConfig({mode: 'ro_role', env: noService, now: NOW}).key).toBe(c.key);
  });

  it('ro_role passes CHAT_RO_APIKEY through as apikey', () => {
    expect(buildChatReadConfig({mode: 'ro_role', env: {...base, CHAT_RO_APIKEY: 'anon-key'}, now: NOW}).apikey).toBe('anon-key');
    expect(buildChatReadConfig({mode: 'ro_role', env: base, now: NOW})).not.toHaveProperty('apikey');
  });

  it('missing variables throw naming the variable, never a value', () => {
    expect(() => buildChatReadConfig({mode: 'guarded_service', env: {...base, SUPABASE_URL_ARCHIVE: undefined}})).toThrow(/SUPABASE_URL_ARCHIVE/);
    expect(() => buildChatReadConfig({mode: 'guarded_service', env: {...base, SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: undefined}})).toThrow(/SUPABASE_SERVICE_ROLE_KEY_ARCHIVE/);
    expect(() => buildChatReadConfig({mode: 'ro_role', env: {...base, CHAT_RO_JWT_SECRET: undefined}})).toThrow(/CHAT_RO_JWT_SECRET/);
    expect(() => buildChatReadConfig({mode: 'ro_role', env: {...base, SUPABASE_URL_ARCHIVE: ''}})).toThrow(/SUPABASE_URL_ARCHIVE/);
    // ro_role must not fall back to the service key when the secret is missing
    let message = '';
    try {
      buildChatReadConfig({mode: 'ro_role', env: {...base, CHAT_RO_JWT_SECRET: undefined}});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(SERVICE);
  });

  it('a short ro_role secret throws without echoing it', () => {
    const short = 'too-short-secret';
    let message = '';
    try {
      buildChatReadConfig({mode: 'ro_role', env: {...base, CHAT_RO_JWT_SECRET: short}});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/CHAT_RO_JWT_SECRET/);
    expect(message).not.toContain(short);
  });
});
