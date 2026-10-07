import {describe, expect, it} from 'vitest';
import {COOP_ENVS, envForHost, prodConfirmOk, switchHref} from './coop-env';

describe('coop environments', () => {
  it('has exactly Staging and Production', () => {
    expect(COOP_ENVS.map((e) => e.key)).toEqual(['staging', 'production']);
  });

  it('recognises production only by its own host; everything else is Staging', () => {
    expect(envForHost('coop-brand-os.vercel.app').key).toBe('production');
    expect(envForHost('COOP-BRAND-OS.vercel.app:443').key).toBe('production');
    expect(envForHost('coop-brand-os-staging.vercel.app').key).toBe('staging');
    expect(envForHost('localhost:3000').key).toBe('staging');
    expect(envForHost('coop-brand-os-git-feat-x.vercel.app').key).toBe('staging'); // previews read Staging
    expect(envForHost(null).key).toBe('staging');
    expect(envForHost('evil.coop-brand-os.vercel.app').key).toBe('staging');
  });

  it('links to the same page on the other environment', () => {
    expect(switchHref('production', '/stock', '?store=1')).toBe('https://coop-brand-os.vercel.app/stock?store=1');
    expect(switchHref('staging', 'admin/users', 'q=a', 'x')).toBe('https://coop-brand-os-staging.vercel.app/admin/users?q=a#x');
    expect(switchHref('production', '/')).toBe('https://coop-brand-os.vercel.app/');
  });

  it('requires typing PRODUCTION only in production', () => {
    expect(prodConfirmOk('staging', undefined)).toBe(true);
    expect(prodConfirmOk('production', undefined)).toBe(false);
    expect(prodConfirmOk('production', 'production')).toBe(false);
    expect(prodConfirmOk('production', ' PRODUCTION ')).toBe(true);
  });
});
