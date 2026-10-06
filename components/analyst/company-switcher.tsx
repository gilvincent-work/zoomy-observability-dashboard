'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Building2, Check, ChevronDown} from 'lucide-react';
import {setActiveView} from '@/app/actions/company';
import {cn} from '@/lib/utils';

// Multi-role view switcher in the top bar. Only rendered (by the shell) when the
// user holds more than one view. Writes the choice via a server action (cookie)
// then refreshes so every server component re-resolves the active view.

type View = {key: string; companyId: string | null; role: string; name: string};

const ROLE_LABEL: Record<string, string> = {
  coop_admin: 'Coop Admin',
  company_admin: 'Company User',
  analyst: 'Analyst',
  store_manager: 'Store Manager',
};

/** "Coop Admin" for the cross-tenant view, else "Company · Role". */
function label(v: View): string {
  if (!v.companyId) return 'Coop Admin';
  return `${v.name} · ${ROLE_LABEL[v.role] ?? v.role}`;
}

export function ViewSwitcher({views, activeKey}: {views: View[]; activeKey: string}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = views.find((v) => v.key === activeKey) ?? views[0];

  function choose(key: string) {
    setOpen(false);
    if (key === activeKey) return;
    startTransition(async () => {
      await setActiveView(key);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        <Building2 className="size-3.5 text-muted-foreground" />
        <span className="max-w-[12rem] truncate">{active ? label(active) : 'Select view'}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
            <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Switch view</div>
            {views.map((v) => (
              <button
                key={v.key}
                role="menuitemradio"
                aria-checked={v.key === activeKey}
                onClick={() => choose(v.key)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
              >
                <span className="truncate">{label(v)}</span>
                {v.key === activeKey && <Check className="size-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
