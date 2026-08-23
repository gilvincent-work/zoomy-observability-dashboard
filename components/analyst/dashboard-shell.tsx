'use client';

import {useState} from 'react';
import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {signOut} from 'next-auth/react';
import {Activity, ChevronDown, Home, LogOut, Mail, Package, Settings, Tag, Users} from 'lucide-react';
import type {DigestArchiveRow} from '../../src/types';
import {cn} from '@/lib/utils';
import {fmtRange} from '../../src/week';
import {ThemeToggle} from './theme-toggle';
import {PlaybookProvider} from './playbook';
import {CoopChatProvider, AskCoopPill} from './coop-chat';

// The left icon rail — Coop's thin nav. Each tab is an icon with a green active pill.
const TABS = [
  {href: '/', label: 'Overview', icon: Home},
  {href: '/inventory', label: 'Inventory', icon: Package},
  {href: '/customers', label: 'Customers', icon: Users},
  {href: '/traffic', label: 'Traffic', icon: Activity},
  {href: '/repricer', label: 'Repricer', icon: Tag},
  {href: '/settings', label: 'Settings', icon: Settings},
] as const;

const isActive = (pathname: string, href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

/** The Coop wordmark — lowercase, with the second "o" in brand green. */
function CoopMark() {
  return (
    <span className="select-none font-sans text-[19px] font-extrabold leading-none tracking-tight text-foreground">
      co<span style={{color: 'var(--primary)'}}>o</span>p
    </span>
  );
}

export function DashboardShell({
  digests,
  user,
  children,
}: {
  digests: DigestArchiveRow[];
  usingMock?: boolean;
  user?: {name?: string | null; email?: string | null; image?: string | null};
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '/';
  const [accountOpen, setAccountOpen] = useState(false);
  const initials = (user?.name || user?.email || 'ZY')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const searchParams = useSearchParams();
  const currentWeek = searchParams.get('week') ?? digests[0]?.window_from ?? '';
  const withWeek = (href: string) => (currentWeek ? `${href}?week=${encodeURIComponent(currentWeek)}` : href);

  const current = digests.find((d) => d.window_from === currentWeek) ?? digests[0];
  const currentRange = current ? fmtRange(current.window_from, current.window_to, current.digest.window.label) : '';

  // The reporting-period picker only makes sense in period-scoped analytics views —
  // hide it on the home brief ("/" with no channel), Settings, and Business Health
  // (which uses its own fixed trailing-6-month window shown on the page).
  const channel = searchParams.get('channel');
  const isHome = pathname === '/' && !channel;
  const showPeriod = Boolean(current) && !isHome && !pathname.startsWith('/settings') && !pathname.startsWith('/health');

  const [periodOpen, setPeriodOpen] = useState(false);

  return (
    <PlaybookProvider>
    <CoopChatProvider scopeLabel={currentRange || undefined}>
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur-sm">
        <Link href="/" aria-label="Coop home" className="flex items-center gap-2 rounded-lg transition-opacity hover:opacity-70">
          <CoopMark />
          <span className="hidden text-[13px] font-medium tracking-tight text-muted-foreground sm:inline">
            BrandOS
          </span>
        </Link>

        {/* Brand switcher (Zoomy) — visual for now */}
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <span className="size-1.5 rounded-full" style={{backgroundColor: 'var(--primary)'}} />
          Zoomy
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>

        {/* Reporting-period switcher — analytics views only */}
        {showPeriod && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPeriodOpen((o) => !o)}
              aria-expanded={periodOpen}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted"
            >
              <span className="font-mono text-xs tabular-nums">{currentRange}</span>
              <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', periodOpen && 'rotate-180')} />
            </button>
            {periodOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setPeriodOpen(false)} />
                <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                  <div className="px-3 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Reporting periods
                  </div>
                  <div className="max-h-72 overflow-y-auto pb-1">
                    {digests.map((d) => {
                      const active = d.window_from === currentWeek;
                      // Preserve the current view's params (e.g. ?channel=) — only swap the week,
                      // so changing period reloads the same view instead of bouncing home.
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('week', d.window_from);
                      return (
                        <Link
                          key={d.window_from}
                          href={`${pathname}?${params.toString()}`}
                          onClick={() => setPeriodOpen(false)}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                            active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                          )}
                        >
                          <span
                            className={cn('size-1.5 shrink-0 rounded-full', d.digest.degraded ? 'bg-amber-500' : 'bg-primary')}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate tabular-nums">{fmtRange(d.window_from, d.window_to, d.digest.window.label)}</span>
                            <span className="truncate text-[11px] text-muted-foreground">{d.digest.window.label}</span>
                          </span>
                          {d.emailed_at && <Mail className="size-3.5 shrink-0 text-muted-foreground" />}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Right cluster: Ask Coop · theme · avatar */}
        <div className="ml-auto flex items-center gap-2">
          <AskCoopPill />
          <ThemeToggle />
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((o) => !o)}
              aria-label="Account"
              aria-expanded={accountOpen}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              style={{backgroundColor: 'var(--primary)'}}
            >
              {initials || 'ZY'}
            </button>
            {accountOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setAccountOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                  <div className="border-b border-border px-3 py-2.5">
                    <div className="truncate text-[13px] font-medium text-foreground">{user?.name || 'Signed in'}</div>
                    {user?.email && <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>}
                  </div>
                  <button
                    onClick={() => signOut({callbackUrl: '/signin'})}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted"
                  >
                    <LogOut className="size-3.5 text-muted-foreground" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Body: icon rail + canvas ────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-4">
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={withWeek(t.href)}
                title={t.label}
                aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex size-10 items-center justify-center rounded-xl transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
                <t.icon className="size-[18px]" />
              </Link>
            );
          })}
        </nav>

        <main id="coop-scroll" className="coop-app-in min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
    </CoopChatProvider>
    </PlaybookProvider>
  );
}
