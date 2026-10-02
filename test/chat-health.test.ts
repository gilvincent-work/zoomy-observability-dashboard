import {describe, expect, it} from 'vitest';
import {describeChatEnv} from '../src/chat/health';

const SECRET = 'v4MuXO/q4wdW7uZqAg0UgHIn+5tJI6vCuzxuBi7A5nKaMwF8rxV2yt7AhrT9N6L7+3RDcHcDRDXeknNY1Io1gg==';
const KEY = 'sb_publishable_FICTIONAL0123456789abcdef';
const good = {NODE_ENV: 'production', VERCEL_ENV: 'preview', CHAT_READ_MODE: 'ro_role', CHAT_RO_JWT_SECRET: SECRET, CHAT_RO_APIKEY: KEY, SUPABASE_URL_ARCHIVE: 'https://abc.supabase.co', ANTHROPIC_API_KEY: 'x'};

describe('describeChatEnv: what a deployment sees, never a value', () => {
  it('reports a good setup as set, clean and in ro_role', () => {
    const d = describeChatEnv(good);
    expect(d.mode).toBe('ro_role');
    expect(d.projectHost).toBe('abc.supabase.co');
    expect(d.CHAT_RO_JWT_SECRET).toMatchObject({set: true, length: SECRET.length, hasNamePrefix: false, hasQuotes: false, hasEdgeWhitespace: false});
    expect(d.CHAT_RO_APIKEY).toMatchObject({set: true, kind: 'publishable'});
  });
  it('never contains a secret or key value anywhere in its output', () => {
    const json = JSON.stringify(describeChatEnv(good));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(KEY);
    expect(json).not.toContain('supabase.co/');
  });
  it('catches the paste mistakes: NAME= prefix, quotes, edge whitespace, wrong key kind', () => {
    const d = describeChatEnv({...good, CHAT_RO_JWT_SECRET: `CHAT_RO_JWT_SECRET=${SECRET}`, CHAT_RO_APIKEY: ' sb_secret_abc ', SUPABASE_URL_ARCHIVE: '"https://abc.supabase.co"'});
    expect(d.CHAT_RO_JWT_SECRET.hasNamePrefix).toBe(true);
    expect(d.CHAT_RO_APIKEY).toMatchObject({hasEdgeWhitespace: true});
    expect(d.SUPABASE_URL_ARCHIVE).toMatchObject({hasQuotes: true});
    expect(describeChatEnv({...good, CHAT_RO_APIKEY: 'sb_secret_abc'}).CHAT_RO_APIKEY.kind).toBe('SECRET (wrong key)');
  });
  it('shows missing variables and the production rule', () => {
    const d = describeChatEnv({NODE_ENV: 'production'});
    expect(d.mode).toMatch(/production requires CHAT_READ_MODE=ro_role/);
    expect(d.CHAT_RO_JWT_SECRET).toEqual({set: false});
    expect(d.projectHost).toBeNull();
  });
});
