import {describe, it, expect} from 'vitest';
import {showUploadsFor} from './company-nav';

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
