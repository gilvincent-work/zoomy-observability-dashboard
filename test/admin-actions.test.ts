import {beforeEach, describe, expect, it, vi} from 'vitest';

const session = vi.hoisted(() => ({email: 'admin@x.com' as string | null}));
const memberships = vi.hoisted(() => ({rows: [] as Array<{companyId: string | null; role: string}>}));
const grantRole = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({revalidatePath: vi.fn()}));
vi.mock('@/auth', () => ({auth: async () => (session.email ? {user: {email: session.email}} : null)}));
vi.mock('@/src/company', () => ({
  COOP_VIEW_KEY: 'coop_admin',
  fetchMemberships: async () => memberships.rows,
}));
vi.mock('@/src/admin-data', () => ({
  grantRole,
  countCoopAdmins: async () => 2,
  revoke: vi.fn(),
  setStatus: vi.fn(),
}));

import {grantRolesAction} from '../app/admin/actions';

describe('grantRolesAction', () => {
  beforeEach(() => {
    session.email = 'admin@x.com';
    memberships.rows = [{companyId: null, role: 'coop_admin'}];
    grantRole.mockClear();
  });

  it('refuses a caller without an active Coop Admin role', async () => {
    memberships.rows = [{companyId: 'zoomy', role: 'company_admin'}];
    const res = await grantRolesAction({email: 'p@x.com', grants: [{companyKey: 'zoomy', role: 'company_admin'}]});
    expect(res.ok).toBe(false);
    expect(grantRole).not.toHaveBeenCalled();
  });

  it('grants every picked role to one email', async () => {
    const res = await grantRolesAction({
      email: '  P@X.com ',
      grants: [
        {companyKey: 'zoomy', role: 'company_admin'},
        {companyKey: 'goldline', role: 'company_admin'},
        {companyKey: 'coop_admin', role: 'coop_admin'},
      ],
    });
    expect(res).toEqual({ok: true});
    expect(grantRole).toHaveBeenCalledTimes(3);
    expect(grantRole).toHaveBeenCalledWith({actor: 'admin@x.com', email: 'p@x.com', companyId: null, role: 'coop_admin'});
  });

  it('validates all grants before writing any', async () => {
    const res = await grantRolesAction({
      email: 'p@x.com',
      grants: [
        {companyKey: 'zoomy', role: 'company_admin'},
        {companyKey: 'goldline', role: 'coop_admin'}, // coop_admin can't be company-scoped
      ],
    });
    expect(res.ok).toBe(false);
    expect(grantRole).not.toHaveBeenCalled();
  });

  it('rejects a bad email and an empty pick', async () => {
    expect((await grantRolesAction({email: 'nope', grants: [{companyKey: 'zoomy', role: 'company_admin'}]})).ok).toBe(false);
    expect((await grantRolesAction({email: 'p@x.com', grants: []})).ok).toBe(false);
    expect(grantRole).not.toHaveBeenCalled();
  });
});
