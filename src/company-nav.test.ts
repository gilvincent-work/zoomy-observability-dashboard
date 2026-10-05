import {describe, it, expect} from 'vitest';
import {showUploadsFor, shouldRedirectFromZoomy} from './company-nav';

describe('showUploadsFor', () => {
  it('hides Uploads for Zoomy and for the single-tenant/unknown fallback', () => {
    expect(showUploadsFor('zoomy')).toBe(false);
    expect(showUploadsFor(null)).toBe(false); // nav absent → 'zoomy'
    expect(showUploadsFor(undefined)).toBe(false);
  });
  it('shows Uploads for any other company', () => {
    expect(showUploadsFor('goldline')).toBe(true);
    expect(showUploadsFor('acme')).toBe(true);
  });
});

describe('shouldRedirectFromZoomy', () => {
  it('leaves signed-out / no-membership alone (null ctx)', () => {
    expect(shouldRedirectFromZoomy(null)).toBe(false);
  });
  it('lets Zoomy through', () => {
    expect(shouldRedirectFromZoomy({companyId: 'zoomy'})).toBe(false);
  });
  it('redirects a Goldline user and the data-blind Coop Admin (null companyId)', () => {
    expect(shouldRedirectFromZoomy({companyId: 'goldline'})).toBe(true);
    expect(shouldRedirectFromZoomy({companyId: null})).toBe(true);
  });
});
