import {describe, it, expect} from 'vitest';
import {
  resolveActive,
  switchableCompanies,
  isCoopAdmin,
  canEditData,
  canManageTeam,
  outOfScopeStores,
  type Membership,
} from './company';

const coop: Membership = {companyId: null, role: 'coop_admin'};
const zoomyAdmin: Membership = {companyId: 'zoomy', role: 'company_admin'};
const goldlineAdmin: Membership = {companyId: 'goldline', role: 'company_admin'};
const goldlineAnalyst: Membership = {companyId: 'goldline', role: 'analyst'};
const storeMgr: Membership = {companyId: 'goldline', role: 'store_manager', storeScope: ['GL-013']};

describe('resolveActive', () => {
  it('returns null when the user has no memberships', () => {
    expect(resolveActive([])).toBeNull();
  });

  it('Coop Admin is data-blind and cross-tenant', () => {
    const ctx = resolveActive([coop]);
    expect(ctx).toEqual({companyId: null, role: 'coop_admin', isCoopAdmin: true, canSeeData: false});
  });

  it('Coop Admin stays data-blind even with a company membership too', () => {
    const ctx = resolveActive([zoomyAdmin, coop]);
    expect(ctx?.isCoopAdmin).toBe(true);
    expect(ctx?.canSeeData).toBe(false);
    expect(ctx?.companyId).toBeNull();
  });

  it('a single company member resolves to that company, with data access', () => {
    const ctx = resolveActive([goldlineAdmin]);
    expect(ctx).toMatchObject({companyId: 'goldline', role: 'company_admin', canSeeData: true});
  });

  it('honors the requested company when the user is a member of it', () => {
    const ctx = resolveActive([zoomyAdmin, goldlineAnalyst], 'goldline');
    expect(ctx?.companyId).toBe('goldline');
    expect(ctx?.role).toBe('analyst');
  });

  it('falls back to the first company when the requested one is not a membership', () => {
    const ctx = resolveActive([zoomyAdmin, goldlineAnalyst], 'nope');
    expect(ctx?.companyId).toBe('zoomy');
  });

  it('carries store scope for a store manager', () => {
    const ctx = resolveActive([storeMgr]);
    expect(ctx?.storeScope).toEqual(['GL-013']);
  });
});

describe('switchableCompanies', () => {
  it('lists only real companies (never the cross-tenant null)', () => {
    expect(switchableCompanies([coop, zoomyAdmin, goldlineAdmin])).toEqual(['zoomy', 'goldline']);
  });
});

describe('role capabilities', () => {
  it('isCoopAdmin', () => {
    expect(isCoopAdmin('coop_admin')).toBe(true);
    expect(isCoopAdmin('company_admin')).toBe(false);
  });

  it('canEditData: company_admin + store_manager write, analyst does not, coop_admin never', () => {
    expect(canEditData('company_admin')).toBe(true);
    expect(canEditData('store_manager')).toBe(true);
    expect(canEditData('analyst')).toBe(false);
    expect(canEditData('coop_admin')).toBe(false);
  });

  it('canManageTeam: only company_admin', () => {
    expect(canManageTeam('company_admin')).toBe(true);
    expect(canManageTeam('analyst')).toBe(false);
    expect(canManageTeam('store_manager')).toBe(false);
    expect(canManageTeam('coop_admin')).toBe(false);
  });
});

describe('outOfScopeStores', () => {
  it('returns [] when scope is null/empty (no restriction)', () => {
    expect(outOfScopeStores(null, ['A', 'B'])).toEqual([]);
    expect(outOfScopeStores(undefined, ['A'])).toEqual([]);
    expect(outOfScopeStores([], ['A', 'B'])).toEqual([]);
  });
  it('returns the codes outside the allowed set, de-duplicated', () => {
    expect(outOfScopeStores(['A'], ['A', 'B', 'B', 'C'])).toEqual(['B', 'C']);
  });
  it('returns [] when every code is in scope', () => {
    expect(outOfScopeStores(['A', 'B'], ['A', 'B', 'A'])).toEqual([]);
  });
});
