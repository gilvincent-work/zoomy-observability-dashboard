import {describe, it, expect} from 'vitest';
import {assertChatReadable, resolveChatReadMode} from '../src/chat/read/mode';

const GOOD = 'test-secret-test-secret-test-secret-1234';

describe('chat read mode (fail closed)', () => {
  it('production without CHAT_READ_MODE=ro_role returns 503', () => {
    for (const mode of [undefined, '', 'guarded_service', 'nonsense']) {
      const r = assertChatReadable({NODE_ENV: 'production', CHAT_READ_MODE: mode});
      expect(r).toMatchObject({ok: false, status: 503});
      expect(() => resolveChatReadMode({NODE_ENV: 'production', CHAT_READ_MODE: mode})).toThrow();
    }
  });

  it('production with ro_role is ok and has no warning', () => {
    expect(assertChatReadable({NODE_ENV: 'production', CHAT_READ_MODE: 'ro_role', CHAT_RO_JWT_SECRET: GOOD})).toEqual({ok: true, mode: 'ro_role'});
  });

  it('non-production defaults to guarded_service with a loud warning', () => {
    for (const env of [{}, {NODE_ENV: 'development'}, {NODE_ENV: 'test'}]) {
      const r = assertChatReadable(env);
      expect(r).toMatchObject({ok: true, mode: 'guarded_service'});
      expect(r.ok && r.warning).toMatch(/guarded_service/);
    }
  });

  it('non-production accepts ro_role without a warning', () => {
    expect(assertChatReadable({NODE_ENV: 'development', CHAT_READ_MODE: 'ro_role', CHAT_RO_JWT_SECRET: GOOD})).toEqual({ok: true, mode: 'ro_role'});
  });

  it('unknown values fail closed everywhere', () => {
    for (const NODE_ENV of ['production', 'development', undefined]) {
      expect(assertChatReadable({NODE_ENV, CHAT_READ_MODE: 'service'})).toMatchObject({ok: false, status: 503});
    }
  });

  it('ro_role without a good CHAT_RO_JWT_SECRET returns 503 naming only the variable', () => {
    for (const NODE_ENV of ['production', 'development']) {
      for (const secret of [undefined, '', 'short-secret']) {
        const r = assertChatReadable({NODE_ENV, CHAT_READ_MODE: 'ro_role', CHAT_RO_JWT_SECRET: secret});
        expect(r).toMatchObject({ok: false, status: 503});
        expect(!r.ok && r.message).toMatch(/CHAT_RO_JWT_SECRET/);
        if (secret) expect(!r.ok && r.message).not.toContain(secret);
      }
      expect(assertChatReadable({NODE_ENV, CHAT_READ_MODE: 'ro_role', CHAT_RO_JWT_SECRET: GOOD})).toEqual({ok: true, mode: 'ro_role'});
    }
  });
});
