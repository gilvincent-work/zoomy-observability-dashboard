import {describe, it, expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {mintChatReadJwt, MAX_TTL_SECONDS} from '../src/chat/read/mint-jwt';

const SECRET = 'test-secret-test-secret-test-secret-1234';
const NOW = new Date('2026-10-01T00:00:00Z');
const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

describe('mintChatReadJwt', () => {
  it('has three base64url segments, a header and the expected claims', () => {
    const jwt = mintChatReadJwt({secret: SECRET, now: NOW});
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(parts[0])).toEqual({alg: 'HS256', typ: 'JWT'});
    const iat = NOW.getTime() / 1000;
    expect(decode(parts[1])).toEqual({role: 'coop_chat_ro', iss: 'supabase', iat, exp: iat + 300, sub: 'ask-coop'});
  });

  it('signature verifies by recomputing the HMAC', () => {
    const [h, p, sig] = mintChatReadJwt({secret: SECRET, now: NOW}).split('.');
    expect(sig).toBe(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
    const wrong = createHmac('sha256', `${SECRET}x`).update(`${h}.${p}`).digest('base64url');
    expect(sig).not.toBe(wrong);
  });

  it('exp - iat equals the ttl (default 300) and accepts ms or Date for now', () => {
    const claims = (jwt: string) => decode(jwt.split('.')[1]);
    const d = claims(mintChatReadJwt({secret: SECRET, now: NOW}));
    expect(d.exp - d.iat).toBe(300);
    const c = claims(mintChatReadJwt({secret: SECRET, now: NOW.getTime(), ttlSeconds: 60}));
    expect(c.exp - c.iat).toBe(60);
    expect(c.iat).toBe(NOW.getTime() / 1000);
  });

  it('enforces the 900 second maximum and a positive ttl', () => {
    expect(() => mintChatReadJwt({secret: SECRET, now: NOW, ttlSeconds: MAX_TTL_SECONDS + 1})).toThrow(/ttl/);
    expect(() => mintChatReadJwt({secret: SECRET, now: NOW, ttlSeconds: 0})).toThrow(/ttl/);
    expect(() => mintChatReadJwt({secret: SECRET, now: NOW, ttlSeconds: MAX_TTL_SECONDS})).not.toThrow();
  });

  it('is deterministic for a given now and differs across times', () => {
    const a = mintChatReadJwt({secret: SECRET, now: NOW});
    expect(mintChatReadJwt({secret: SECRET, now: NOW})).toBe(a);
    expect(mintChatReadJwt({secret: SECRET, now: new Date(NOW.getTime() + 5000)})).not.toBe(a);
  });

  it('rejects empty or short secrets without echoing them', () => {
    const short = 'short-secret-value';
    for (const secret of ['', short, 'x'.repeat(31)]) {
      let message = '';
      try {
        mintChatReadJwt({secret, now: NOW});
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/at least 32/);
      if (secret) expect(message).not.toContain(secret);
    }
  });
});
