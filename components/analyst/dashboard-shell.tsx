'use client';

import {useEffect, useState} from 'react';
import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {signOut} from 'next-auth/react';
import {Activity, BarChart3, Boxes, ChevronDown, ChevronLeft, ChevronRight, Gauge, Home, LogOut, Mail, Package, Receipt, Settings, Tag, Users} from 'lucide-react';
import type {DigestArchiveRow} from '../../src/types';
import {cn} from '@/lib/utils';
import {fmtRange} from '../../src/week';
import {ThemeToggle} from './theme-toggle';
import {PlaybookProvider} from './playbook';
import {CoopChatProvider, AskCoopPill} from './coop-chat';

// The left rail. Overview is a group (accordion in the expanded rail) whose
// children are the sub-views that live under it; the rest are flat tabs.
type NavItem = {href: string; label: string; icon: React.ComponentType<{className?: string}>};

const OVERVIEW: NavItem = {href: '/', label: 'Overview', icon: Home};
const OVERVIEW_CHILDREN: NavItem[] = [
  {href: '/health', label: 'Business Health', icon: Gauge},
  {href: '/?channel=all', label: 'Sales', icon: BarChart3},
  {href: '/offline-sales', label: 'Offline Sales', icon: Receipt},
];
const FLAT_TABS: NavItem[] = [
  {href: '/products', label: 'Products', icon: Boxes},
  {href: '/inventory', label: 'Inventory', icon: Package},
  {href: '/customers', label: 'Customers', icon: Users},
  {href: '/traffic', label: 'Traffic', icon: Activity},
  {href: '/repricer', label: 'Repricer', icon: Tag},
  {href: '/settings', label: 'Settings', icon: Settings},
];

// Active detection. '/' is the Overview home ONLY without a channel; '/?channel='
// is the Sales compare view. Everything else matches by path prefix.
const leafActive = (href: string, pathname: string, channel: string | null) => {
  if (href === '/') return pathname === '/' && !channel;
  if (href === '/?channel=all') return pathname === '/' && Boolean(channel);
  return pathname.startsWith(href.split('?')[0]);
};

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
  // Query-safe: merges ?week into hrefs that may already carry a query (e.g. the
  // Sales child, /?channel=all) instead of blindly appending a second '?'.
  const withWeek = (href: string) => {
    if (!currentWeek) return href;
    const [path, q = ''] = href.split('?');
    const params = new URLSearchParams(q);
    params.set('week', currentWeek);
    return `${path}?${params.toString()}`;
  };

  const current = digests.find((d) => d.window_from === currentWeek) ?? digests[0];
  const currentRange = current ? fmtRange(current.window_from, current.window_to, current.digest.window.label) : '';

  // The reporting-period picker only makes sense in period-scoped analytics views —
  // hide it on the home brief ("/" with no channel), Settings, Business Health
  // (which uses its own fixed trailing-6-month window shown on the page), and
  // Product Controls (a live catalog, not a period-scoped report).
  const channel = searchParams.get('channel');
  const isHome = pathname === '/' && !channel;
  const showPeriod =
    Boolean(current) &&
    !isHome &&
    !pathname.startsWith('/settings') &&
    !pathname.startsWith('/health') &&
    !pathname.startsWith('/repricer') &&
    !pathname.startsWith('/products') &&
    !pathname.startsWith('/offline-sales');

  const [periodOpen, setPeriodOpen] = useState(false);

  // Nav rail can expand to show labels beside the icons (8 icon-only tabs are
  // hard to tell apart). Default collapsed to match SSR; restore the saved
  // choice after mount to avoid a hydration mismatch, and persist changes.
  const [navExpanded, setNavExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('coop-nav-expanded') === '1') setNavExpanded(true);
    } catch {}
  }, []);
  const toggleNav = () =>
    setNavExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem('coop-nav-expanded', next ? '1' : '0');
      } catch {}
      return next;
    });

  // Overview accordion (shown in the expanded rail). Whether any Overview view
  // is the current page — used to highlight the collapsed parent icon and to
  // auto-open the accordion when you navigate into a child.
  const overviewGroupActive =
    leafActive('/', pathname, channel) || OVERVIEW_CHILDREN.some((c) => leafActive(c.href, pathname, channel));
  const [overviewOpen, setOverviewOpen] = useState(true);
  useEffect(() => {
    if (overviewGroupActive) setOverviewOpen(true);
  }, [overviewGroupActive]);

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
        <nav
          className={cn(
            // Pin the rail to the viewport (below the h-14 header) so its height
            // is bounded — otherwise a tall page stretches it and the centered
            // toggle drifts down into the empty space below the tabs.
            'sticky top-14 flex h-[calc(100vh-3.5rem)] shrink-0 flex-col gap-1 self-start border-r border-sidebar-border bg-sidebar py-4 transition-[width] duration-200 ease-out',
            navExpanded ? 'w-56 items-stretch px-3' : 'w-16 items-center',
          )}
        >
          {/* Overview — a group: an accordion in the expanded rail, a single
              icon in the collapsed rail (its children need the labels). */}
          {navExpanded ? (
            <div className="flex flex-col">
              <div className="flex items-center gap-1">
                <Link
                  href={withWeek('/')}
                  aria-current={leafActive('/', pathname, channel) ? 'page' : undefined}
                  className={cn(
                    'relative flex h-10 flex-1 items-center gap-3 rounded-xl px-3 transition-colors',
                    leafActive('/', pathname, channel)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                  )}
                >
                  {leafActive('/', pathname, channel) && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
                  <OVERVIEW.icon className="size-[18px] shrink-0" />
                  <span className="truncate text-[13px] font-medium">{OVERVIEW.label}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setOverviewOpen((o) => !o)}
                  aria-label={overviewOpen ? 'Collapse Overview section' : 'Expand Overview section'}
                  aria-expanded={overviewOpen}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  <ChevronDown className={cn('size-4 transition-transform', overviewOpen ? '' : '-rotate-90')} />
                </button>
              </div>
              {overviewOpen && (
                <div className="ml-3 mt-1 flex flex-col gap-1 border-l border-sidebar-border pl-3">
                  {OVERVIEW_CHILDREN.map((c) => {
                    const active = leafActive(c.href, pathname, channel);
                    return (
                      <Link
                        key={c.label}
                        href={withWeek(c.href)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex h-9 items-center gap-3 rounded-lg px-3 transition-colors',
                          active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                        )}
                      >
                        <c.icon className="size-4 shrink-0" />
                        <span className="truncate text-[13px] font-medium">{c.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <Link
              href={withWeek('/')}
              title="Overview"
              aria-label="Overview"
              aria-current={overviewGroupActive ? 'page' : undefined}
              className={cn(
                'relative flex size-10 items-center justify-center rounded-xl transition-colors',
                overviewGroupActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
              )}
            >
              {overviewGroupActive && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
              <OVERVIEW.icon className="size-[18px] shrink-0" />
            </Link>
          )}

          {FLAT_TABS.map((t) => {
            const active = leafActive(t.href, pathname, channel);
            return (
              <Link
                key={t.href}
                href={withWeek(t.href)}
                title={navExpanded ? undefined : t.label}
                aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-10 items-center rounded-xl transition-colors',
                  navExpanded ? 'w-full gap-3 px-3' : 'size-10 justify-center',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
                <t.icon className="size-[18px] shrink-0" />
                {navExpanded && <span className="truncate text-[13px] font-medium">{t.label}</span>}
              </Link>
            );
          })}

          {/* Expand / collapse toggle — straddles the rail's right edge, vertically centered. */}
          <button
            type="button"
            onClick={toggleNav}
            aria-label={navExpanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-expanded={navExpanded}
            className="absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            {navExpanded ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
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
