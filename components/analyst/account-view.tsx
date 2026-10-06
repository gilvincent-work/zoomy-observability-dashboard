'use client';

import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Check, Loader2} from 'lucide-react';
import {setActiveView} from '@/app/actions/company';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {cn} from '@/lib/utils';

// "Your access" — every view the user holds, selectable. Choosing one sets the
// active_view cookie (server action) and refreshes so the whole app re-scopes.

type View = {key: string; companyId: string | null; role: string; name: string};

const ROLE_LABEL: Record<string, string> = {
  coop_admin: 'Coop Admin',
  company_admin: 'Company User',
  analyst: 'Analyst',
  store_manager: 'Store Manager',
};

export function AccountView({views, activeKey}: {views: View[]; activeKey: string}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(key: string) {
    if (key === activeKey) return;
    startTransition(async () => {
      await setActiveView(key);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Your access</h1>
        <p className="text-sm text-muted-foreground">
          Pick which view you&apos;re using. Roles are granted by a Coop Admin.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            Switch view{' '}
            <span className="text-sm font-normal text-muted-foreground tabular-nums">({views.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          {views.map((v) => {
            const active = v.key === activeKey;
            const isCoop = !v.companyId;
            return (
              <button
                key={v.key}
                type="button"
                disabled={pending || active}
                onClick={() => choose(v.key)}
                aria-current={active ? 'true' : undefined}
                className="flex items-center gap-3 border-b border-border/60 py-3.5 text-left last:border-b-0 disabled:cursor-default"
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                    active ? 'border-primary bg-primary' : 'border-border',
                  )}
                >
                  {active && <span className="size-1.5 rounded-full bg-background" />}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {isCoop ? 'Coop Admin' : v.name}
                    {!isCoop && (
                      <span className="font-normal text-muted-foreground"> · {ROLE_LABEL[v.role] ?? v.role}</span>
                    )}
                  </span>
                  {isCoop && <span className="text-xs text-muted-foreground">Cross-tenant · data-blind · manages roles</span>}
                </span>
                {active && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Current
                  </span>
                )}
              </button>
            );
          })}
          {views.length === 1 && (
            <p className="pt-3 text-xs text-muted-foreground">
              You hold one role. A Coop Admin can grant you more.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
