import {describe, it, expect} from 'vitest';
import {shouldRedirectFromZoomy} from './company-nav';

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
