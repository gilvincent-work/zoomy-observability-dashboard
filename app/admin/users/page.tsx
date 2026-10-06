import {redirect} from 'next/navigation';
import {getActiveContext} from '@/src/active-context';
import {canManageRoles} from '@/src/company';
import {homeFor} from '@/src/company-nav';
import {listCompanies, listUsers} from '@/src/admin-data';
import {AdminUsersView} from '@/components/analyst/admin-users-view';

export const dynamic = 'force-dynamic';

// Coop Admin role console. Gated to the Coop Admin view (data-blind): a non-admin
// view is bounced to its home; signed-out falls to the root (sign-in flow).
export default async function Page() {
  const ctx = await getActiveContext();
  if (!ctx) redirect('/');
  if (!canManageRoles(ctx.role)) redirect(homeFor(ctx));
  const [users, companies] = await Promise.all([listUsers(), listCompanies()]);
  return <AdminUsersView users={users} companies={companies} />;
}
