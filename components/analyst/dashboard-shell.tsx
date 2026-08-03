'use client';

import {useState} from 'react';
import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {Activity, LayoutDashboard, Mail, Menu, Package, Settings, Sparkles, Users} from 'lucide-react';
import type {DigestArchiveRow} from '../../src/types';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/lib/utils';

const TABS = [
  {href: '/', label: 'Overview', icon: LayoutDashboard},
  {href: '/inventory', label: 'Inventory', icon: Package},
  {href: '/customers', label: 'Customers', icon: Users},
  {href: '/traffic', label: 'Traffic', icon: Activity},
  {href: '/settings', label: 'Settings', icon: Settings},
] as const;

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

export function DashboardShell({
  digests,
  usingMock,
  children,
}: {
  digests: DigestArchiveRow[];
  usingMock: boolean;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const currentWeek = searchParams.get('week') ?? digests[0]?.window_from ?? '';
  const withWeek = (href: string) => (currentWeek ? `${href}?week=${encodeURIComponent(currentWeek)}` : href);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
        >
          <Menu className="size-5" />
        </Button>
        <Sparkles className="size-5 text-primary" />
        <span className="text-base font-semibold tracking-tight">Zoomy</span>
        <span className="hidden text-sm text-muted-foreground sm:inline">AI store-ops analyst</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
            <nav className="flex-1 overflow-y-auto p-2">
              <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Weeks</div>
              {digests.map((d) => {
                const active = d.window_from === currentWeek;
                return (
                  <Link
                    key={d.window_from}
                    href={`${pathname}?week=${encodeURIComponent(d.window_from)}`}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/50',
                    )}
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', d.digest.degraded ? 'bg-amber-500' : 'bg-primary')} />
                    <span className="flex-1 truncate">{d.digest.window.label}</span>
                    {d.emailed_at && <Mail className="size-3.5 text-muted-foreground" />}
                  </Link>
                );
              })}
            </nav>
            {usingMock && (
              <>
                <Separator />
                <div className="p-3 text-[11px] leading-snug text-muted-foreground">
                  Mock data — sales/CRM/traffic signals are mocked until the extended retrieval bundle lands.
                </div>
              </>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-3">
            {TABS.map((t) => {
              const active = isActive(pathname, t.href);
              return (
                <Link
                  key={t.href}
                  href={withWeek(t.href)}
                  className={cn(
                    'inline-flex h-12 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm transition-colors',
                    active
                      ? 'border-primary font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
