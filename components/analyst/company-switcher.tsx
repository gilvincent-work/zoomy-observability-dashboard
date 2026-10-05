'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Building2, Check, ChevronDown} from 'lucide-react';
import {setActiveCompany} from '@/app/actions/company';
import {cn} from '@/lib/utils';

// Tenant switcher in the top bar. Only rendered (by the shell) when the user
// belongs to more than one company. Writes the choice via a server action (cookie)
// then refreshes so every server component re-resolves the active company.
export function CompanySwitcher({
  companies,
  activeId,
}: {
  companies: {id: string; name: string}[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = companies.find((c) => c.id === activeId);

  function choose(id: string) {
    setOpen(false);
    if (id === activeId) return;
    startTransition(async () => {
      await setActiveCompany(id);
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
        <span className="max-w-[9rem] truncate">{active?.name ?? 'Company'}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
            {companies.map((c) => (
              <button
                key={c.id}
                role="menuitemradio"
                aria-checked={c.id === activeId}
                onClick={() => choose(c.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
              >
                <span className="truncate">{c.name}</span>
                {c.id === activeId && <Check className="size-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
