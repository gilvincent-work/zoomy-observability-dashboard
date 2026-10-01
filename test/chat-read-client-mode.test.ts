import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {chatDigestClient, chatReadClient, type ChatReadClientOptions} from '../src/chat/read/client';

// Fail closed: a caller that forgets `mode` must not silently get the service-role client.
const env = {SUPABASE_URL_ARCHIVE: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY_ARCHIVE: 'k'.repeat(40), CHAT_RO_JWT_SECRET: 's'.repeat(40)};

describe('the chat read clients require an explicit mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws without a mode (no default to guarded_service), before any client or request exists', () => {
    const stub = vi.fn();
    vi.stubGlobal('fetch', stub);
    const noMode = {env} as unknown as ChatReadClientOptions;
    expect(() => chatReadClient(noMode)).toThrow(/mode is required/);
    expect(() => chatDigestClient(noMode)).toThrow(/mode is required/);
    expect(() => chatReadClient({env, mode: undefined} as unknown as ChatReadClientOptions)).toThrow(/mode is required/);
    expect(() => chatReadClient({env, mode: 'service_role'} as unknown as ChatReadClientOptions)).toThrow(/mode is required/);
    expect(() => chatReadClient(undefined as unknown as ChatReadClientOptions)).toThrow();
    expect(stub).not.toHaveBeenCalled();
  });

  it('builds with an explicit mode', () => {
    expect(chatReadClient({mode: 'guarded_service', env}).mode).toBe('guarded_service');
    expect(chatDigestClient({mode: 'ro_role', env}).mode).toBe('ro_role');
  });

  it('mode is a required property at the type level', () => {
    const typeChecks = () => {
      // @ts-expect-error mode is required
      chatReadClient({env});
      // @ts-expect-error options are required
      chatDigestClient();
    };
    expect(typeChecks).toBeTypeOf('function');
  });
});
