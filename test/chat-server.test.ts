import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn}));

// The read path is fail-closed: where it is not ready the chat degrades to digest-only instead of going down.
describe('getChatMetricDataOrDegrade', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL_ARCHIVE', '');
    vi.stubEnv('CHAT_READ_MODE', '');
    vi.stubEnv('CHAT_RO_JWT_SECRET', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const load = async () => (await import('../src/chat/server')).getChatMetricDataOrDegrade;

  it('production without the read-only role degrades (no data, no read), and logs the reason once', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_URL_ARCHIVE', 'https://proj.supabase.co');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fn = await load();
    const a = await fn();
    const b = await fn();
    expect(a).toMatchObject({ok: false});
    expect(a.ok === false && a.reason).toMatch(/CHAT_READ_MODE=ro_role|unavailable/i);
    expect(b).toEqual(a);
    expect(fetchSpy).not.toHaveBeenCalled(); // nothing was read from the database
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({event: 'chat_degraded'});
  });

  it('production with ro_role but no signing secret degrades too, and the reason never contains a secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_URL_ARCHIVE', 'https://proj.supabase.co');
    vi.stubEnv('CHAT_READ_MODE', 'ro_role');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY_ARCHIVE', 'sb-secret-should-never-appear');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await (await load())();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('sb-secret-should-never-appear');
  });

  it('without Supabase env it serves sample data (mock), flagged as such', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const r = await (await load())();
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.source).toBe('mock');
  });
});
