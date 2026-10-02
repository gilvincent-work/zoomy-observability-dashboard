import {describe, it, expect, vi} from 'vitest';
import {createGuardedFetch} from '../src/chat/read/guarded-fetch';
import {relationsForMode} from '../src/chat/read/relations';

// The guard judges the RAW path (URL parsing silently resolves `..`) but takes the
// host from the parsed URL. These URLs make the two disagree; each must be blocked
// because the parsed pathname no longer equals the raw path.
const BASE = 'https://proj.supabase.co';

function setup() {
  const underlying = vi.fn(async () => new Response('[]', {status: 200})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const g = createGuardedFetch({baseUrl: BASE, relations: relationsForMode('guarded_service').allowed, underlying});
  return {...g, underlying};
}

describe('guarded fetch: parser differentials', () => {
  const urls: Record<string, string> = {
    'backslash before an @ host': `${BASE}\\@evil.example/rest/v1/pos_orders?select=id`,
    'tab inside the path': `${BASE}/rest/v1/pos_or\tders?select=id`,
    'newline inside the path': `${BASE}/rest/v1/pos_orders\n?select=id`,
    'backslash path separator': `${BASE}/rest\\v1/pos_orders?select=id`,
    'userinfo in front of the host': `https://proj.supabase.co@evil.example/rest/v1/pos_orders?select=id`,
    'uppercase relation': `${BASE}/rest/v1/POS_ORDERS?select=id`,
  };
  it.each(Object.entries(urls))('blocks %s', async (_name, url) => {
    const {fetch: f, stats, underlying} = setup();
    await expect(f(url)).rejects.toThrow(/chat read guard/);
    expect(stats.attemptedNonRead).toBe(1);
    expect(underlying).not.toHaveBeenCalled();
  });

  it('still passes a plain, safe read', async () => {
    const {fetch: f, underlying} = setup();
    await f(`${BASE}/rest/v1/pos_orders?select=id,total`);
    expect(underlying).toHaveBeenCalledTimes(1);
  });
});
