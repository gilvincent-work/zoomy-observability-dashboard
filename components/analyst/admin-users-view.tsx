'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Loader2, UserPlus} from 'lucide-react';
import type {AdminCompany, AdminUser} from '@/src/admin-data';
import type {CompanyRole} from '@/src/company';
import {grantRoleAction, revokeAction, setStatusAction} from '@/app/admin/actions';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

// Coop Admin "Users & Roles" console. The only write surface for access — every
// action re-checks coop_admin + runs lockout guards server-side. Data-blind: shows
// only who has what role, never business data.

const ROLE_LABEL: Record<string, string> = {
  coop_admin: 'Coop Admin',
  company_admin: 'Company User',
  analyst: 'Analyst',
  store_manager: 'Store Manager',
};

const STATUS_CLS: Record<string, string> = {
  active: 'text-emerald-700 dark:text-emerald-400',
  invited: 'text-amber-700 dark:text-amber-400',
  suspended: 'text-destructive',
};

export function AdminUsersView({users, companies}: {users: AdminUser[]; companies: AdminCompany[]}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  // Scope options bundle companyKey + role: a company grants Company User; "Coop Admin" grants coop_admin.
  const [scope, setScope] = useState(companies[0] ? `${companies[0].id}:company_admin` : 'coop_admin:coop_admin');
  const [notice, setNotice] = useState<{kind: 'ok' | 'err'; text: string} | null>(null);

  function run(fn: () => Promise<{ok: boolean; error?: string}>, okText: string) {
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setNotice({kind: 'ok', text: okText});
        router.refresh();
      } else {
        setNotice({kind: 'err', text: res.error ?? 'Something went wrong.'});
      }
    });
  }

  function grant() {
    const [companyKey, role] = scope.split(':');
    run(() => grantRoleAction({email, companyKey, role: role as CompanyRole}), 'Role granted.');
    setEmail('');
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Users &amp; Roles</h1>
        <p className="text-sm text-muted-foreground">
          Grant and manage access. You can&apos;t see any company&apos;s business data here.
        </p>
      </header>

      {/* Grant */}
      <Card>
        <CardHeader>
          <CardTitle>Grant a role</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@company.com"
              className="h-8 min-w-[200px] flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              {companies.map((c) => (
                <option key={c.id} value={`${c.id}:company_admin`}>
                  {c.name} · Company User
                </option>
              ))}
              <option value="coop_admin:coop_admin">Coop Admin</option>
            </select>
            <Button onClick={grant} disabled={pending || !email.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Grant
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A new email is <span className="font-medium">invited</span> and gains access on first Google sign-in; re-granting an existing one changes the role.
          </p>
          {notice && (
            <span className={cn('text-xs', notice.kind === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
              {notice.text}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Users */}
      <Card>
        <CardHeader>
          <CardTitle>
            Users <span className="text-sm font-normal text-muted-foreground tabular-nums">({users.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Access</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) =>
                    u.memberships.map((m, i) => {
                      const companyKey = m.companyId ?? 'coop_admin';
                      return (
                        <tr key={`${u.email}-${companyKey}`} className="border-b border-border/60 align-top">
                          {i === 0 ? (
                            <td className="py-2.5 pr-3" rowSpan={u.memberships.length}>
                              <span className="break-all">{u.email}</span>
                            </td>
                          ) : null}
                          <td className="py-2.5 pr-3">
                            <span className="font-medium">{m.companyName}</span>
                            <span className="text-muted-foreground"> · {ROLE_LABEL[m.role] ?? m.role}</span>
                            <span className={cn('ml-2 text-xs', STATUS_CLS[m.status] ?? 'text-muted-foreground')}>{m.status}</span>
                          </td>
                          <td className="py-2 whitespace-nowrap">
                            {m.status === 'suspended' ? (
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={pending}
                                onClick={() => run(() => setStatusAction({email: u.email, companyKey, status: 'active'}), 'Reactivated.')}
                              >
                                Reactivate
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={pending}
                                onClick={() => run(() => setStatusAction({email: u.email, companyKey, status: 'suspended'}), 'Suspended.')}
                              >
                                Suspend
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={pending}
                              className="text-destructive hover:text-destructive"
                              onClick={() => run(() => revokeAction({email: u.email, companyKey}), 'Revoked.')}
                            >
                              Revoke
                            </Button>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
