import {getNavContext} from '@/src/active-context';
import {AccountView} from '@/components/analyst/account-view';

export const dynamic = 'force-dynamic';

// Shared "Your access" page — reachable by every signed-in role (NOT behind the
// Zoomy guard), so a Goldline user or Coop Admin can switch views here too.
export default async function Page() {
  const nav = await getNavContext();
  if (!nav) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-lg font-semibold">No access yet</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have a role yet. Ask a Coop Admin to grant you access.</p>
      </div>
    );
  }
  return <AccountView views={nav.views} activeKey={nav.activeKey} />;
}
