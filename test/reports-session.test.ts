import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const h = vi.hoisted(() => ({session: null as {user: {email?: string | null}} | null, throws: false, calls: 0}));

vi.mock('server-only', () => ({}));
vi.mock('../auth', () => ({
  auth: async () => {
    h.calls += 1;
    if (h.throws) throw new Error('boom');
    return h.session;
  },
}));

import {reportsViewerEmail} from '../src/reports-session';

beforeEach(() => {
  h.session = null;
  h.throws = false;
  h.calls = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('reportsViewerEmail (auth() plus the dev bypass)', () => {
  it('returns the session email, lower-cased', async () => {
    h.session = {user: {email: 'Dave@Zoomy.Test'}};
    expect(await reportsViewerEmail()).toBe('dave@zoomy.test');
    expect(h.calls).toBe(1);
  });
  it('returns null with no session, no email, or auth() throwing', async () => {
    expect(await reportsViewerEmail()).toBeNull();
    h.session = {user: {email: null}};
    expect(await reportsViewerEmail()).toBeNull();
    h.session = {user: {}};
    expect(await reportsViewerEmail()).toBeNull();
    h.throws = true;
    expect(await reportsViewerEmail()).toBeNull();
  });
  it('with DEV_AUTH_BYPASS in development the user is dev@localhost and auth() is not needed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    expect(await reportsViewerEmail()).toBe('dev@localhost');
    expect(h.calls).toBe(0);
  });
  it('the bypass can never activate outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_AUTH_BYPASS', 'true');
    expect(await reportsViewerEmail()).toBeNull();
    expect(h.calls).toBe(1);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', '');
    expect(await reportsViewerEmail()).toBeNull();
  });
});
