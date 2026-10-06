'use client';

import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Menu} from '@base-ui/react/menu';
import {Check, ChevronDown, Loader2, ShieldCheck} from 'lucide-react';
import {setActiveView} from '@/app/actions/company';
import {companyHue, groupViews, monogram, type SwitcherView} from '@/src/view-switcher';
import {cn} from '@/lib/utils';

// Multi-role view switcher in the top bar. Only rendered (by the shell) when the
// user holds more than one view. Writes the choice via a server action (cookie)
// then refreshes so every server component re-resolves the active view.
//
// Menu: the cross-tenant Coop Admin view is pinned on top and set apart by a
// divider (it sees no business data, so it's a different kind of place), then the
// companies A–Z. Each company carries a stable color badge so the views are told
// apart at a glance, in the menu and on the trigger.

const ROLE_LABEL: Record<string, string> = {
  coop_admin: 'Coop Admin',
  company_admin: 'Company User',
  analyst: 'Analyst',
  store_manager: 'Store Manager',
};

const roleLabel = (v: SwitcherView) => ROLE_LABEL[v.role] ?? v.role;
const title = (v: SwitcherView) => (v.companyId ? v.name : 'Coop Admin');

/** The view's badge: a colored monogram for a company, a shield for Coop Admin. */
function ViewBadge({view, size = 'md'}: {view: SwitcherView; size?: 'sm' | 'md'}) {
  const box = size === 'sm' ? 'size-5 rounded-[5px] text-[9px]' : 'size-7 rounded-md text-[11px]';
  if (!view.companyId) {
    return (
      <span aria-hidden className={cn('flex shrink-0 items-center justify-center bg-foreground/10 text-foreground', box)}>
        <ShieldCheck className={size === 'sm' ? 'size-3' : 'size-3.5'} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{['--hue' as string]: companyHue(view.companyId)}}
      className={cn(
        'flex shrink-0 items-center justify-center font-semibold tracking-tight',
        'bg-[oklch(0.62_0.12_var(--hue)/0.16)] text-[oklch(0.45_0.11_var(--hue))] ring-1 ring-[oklch(0.62_0.12_var(--hue)/0.28)] ring-inset',
        'dark:bg-[oklch(0.75_0.12_var(--hue)/0.16)] dark:text-[oklch(0.84_0.1_var(--hue))] dark:ring-[oklch(0.75_0.12_var(--hue)/0.3)]',
        box,
      )}
    >
      {monogram(view.name)}
    </span>
  );
}

const ITEM =
  'group flex w-full cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none select-none data-[highlighted]:bg-muted data-[checked]:bg-muted/60';

function ViewItem({view}: {view: SwitcherView}) {
  return (
    <Menu.RadioItem value={view.key} closeOnClick className={ITEM}>
      <ViewBadge view={view} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-foreground">{title(view)}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {view.companyId ? roleLabel(view) : 'People & roles · no business data'}
        </span>
      </span>
      <Menu.RadioItemIndicator className="flex shrink-0 text-primary">
        <Check className="size-4" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  );
}

export function ViewSwitcher({views, activeKey}: {views: SwitcherView[]; activeKey: string}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = views.find((v) => v.key === activeKey) ?? views[0];
  const {coop, companies} = groupViews(views);

  function choose(key: string) {
    if (key === activeKey) return;
    startTransition(async () => {
      await setActiveView(key);
      router.refresh();
    });
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={pending}
        aria-label={active ? `Current view: ${title(active)}${active.companyId ? `, ${roleLabel(active)}` : ''}. Switch view` : 'Switch view'}
        className="group flex h-8 max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-background pr-2 pl-1 text-[13px] font-medium text-foreground outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98] data-[popup-open]:bg-muted disabled:opacity-60"
      >
        {active && <ViewBadge view={active} size="sm" />}
        <span className="truncate">{active ? title(active) : 'Select view'}</span>
        {pending ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180" />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={8} className="z-50">
          <Menu.Popup className="w-72 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Menu.RadioGroup value={activeKey} onValueChange={(value) => choose(String(value))}>
              {coop && (
                <>
                  <ViewItem view={coop} />
                  <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
                </>
              )}
              {companies.length > 0 && (
                <Menu.Group>
                  {coop && (
                    <Menu.GroupLabel className="px-2 pt-0.5 pb-1 text-[11px] font-medium text-muted-foreground">Companies</Menu.GroupLabel>
                  )}
                  {companies.map((v) => (
                    <ViewItem key={v.key} view={v} />
                  ))}
                </Menu.Group>
              )}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
