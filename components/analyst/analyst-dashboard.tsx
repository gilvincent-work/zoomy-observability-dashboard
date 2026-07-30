'use client';

import {useState} from 'react';
import {
  ArrowRight,
  ChevronDown,
  Clock,
  Lightbulb,
  Mail,
  Menu,
  MessageSquare,
  Quote,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  TrendingDown,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type {DigestArchiveRow, DigestFigure, OutreachList, TimeBasis} from '../../src/types';
import {mockReprompt} from '../../src/reprompt';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/lib/utils';

// ── small shared pieces ──────────────────────────────────────────────────────
function basisLabel(basis: TimeBasis): string {
  if (basis === 'window') return 'this week';
  if (basis === 'recurring') return 'weekly trend';
  return 'all-time';
}

function Eyebrow({icon: Icon, children}: {icon: typeof Users; children: React.ReactNode}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h2>
  );
}

/** A read-only metric tile — value + label + explicit time basis (never fake). */
function FigureTiles({figures}: {figures: DigestFigure[]}) {
  if (!figures.length) return null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {figures.map((f, i) => (
        <Card key={`${f.label}-${i}`}>
          <CardContent className="p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</div>
            <div className="font-mono text-2xl font-semibold tabular-nums">{f.value.toLocaleString()}</div>
            <div className="mt-1 text-xs text-muted-foreground">{basisLabel(f.timeBasis)}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** The 👉 actions — plain strings from the digest, rendered as a ranked list. */
function ActionList({items}: {items: string[]}) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.map((text, i) => (
        <Card key={i}>
          <CardContent className="flex items-start gap-3 p-3.5">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-foreground/90">{text}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const LIST_LABEL: Record<OutreachList, string> = {vip: 'VIP', atRisk: 'At-risk', new: 'New'};

// ── the digest pane (fully real data) ────────────────────────────────────────
function DigestPane({row}: {row: DigestArchiveRow}) {
  const [view, setView] = useState(row.digest);
  const [regenerated, setRegenerated] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 550));
    setView(mockReprompt(row.digest, instruction));
    setRegenerated(true);
    setBusy(false);
  }
  function reset() {
    setView(row.digest);
    setRegenerated(false);
    setInstruction('');
  }

  const sales = view.sales ?? null;
  const customers = view.customers ?? null;
  const topMax = sales ? Math.max(1, ...sales.topProducts.map((p) => p.revenue)) : 1;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      {/* headline hero */}
      <header className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{row.digest.window.label}</h1>
          <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
            <Sparkles className="size-3" /> AI analyst
          </Badge>
          {row.emailed_at && (
            <Badge variant="secondary" className="gap-1">
              <Mail className="size-3" /> emailed
            </Badge>
          )}
        </div>
        <p className="text-pretty text-2xl font-semibold leading-snug tracking-tight text-foreground">
          {view.headline}
        </p>
      </header>

      {/* SALES */}
      {sales && (
        <section className="mb-10">
          <Eyebrow icon={ShoppingCart}>Sales</Eyebrow>
          <p className="mb-4 text-sm leading-relaxed text-foreground/80">{sales.headline}</p>
          <FigureTiles figures={sales.figures} />

          {sales.topProducts.length > 0 && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="mb-3 text-sm font-medium">Top sellers this week</div>
                <ul className="space-y-2.5">
                  {sales.topProducts.map((p, i) => (
                    <li key={i}>
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm text-foreground/90">{p.title}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {p.revenue.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{width: `${(p.revenue / topMax) * 100}%`}} />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {sales.watch.length > 0 && (
            <div className="mb-4 space-y-2">
              {sales.watch.map((w, i) => (
                <Card key={i} className="border-l-2" style={{borderLeftColor: 'var(--status-warn)'}}>
                  <CardContent className="flex items-start gap-3 p-4">
                    <TrendingDown className="mt-0.5 size-4 shrink-0" style={{color: 'var(--status-warn)'}} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{w.title}</div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{w.note}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <ActionList items={sales.recommendations} />
        </section>
      )}

      {/* CUSTOMERS */}
      {customers && (
        <section className="mb-10">
          <Eyebrow icon={Users}>Customers — who to reach out to</Eyebrow>
          <p className="mb-4 text-sm leading-relaxed text-foreground/80">{customers.headline}</p>
          <FigureTiles figures={customers.figures} />

          {customers.outreach.length > 0 && (
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              {customers.outreach.map((o, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium">{o.name}</span>
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                        {LIST_LABEL[o.list]}
                      </Badge>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        color: o.canEmail ? 'var(--status-good)' : 'var(--muted-foreground, #6b6b6b)',
                        backgroundColor: o.canEmail
                          ? 'color-mix(in oklab, var(--status-good) 14%, transparent)'
                          : 'var(--muted)',
                      }}
                    >
                      {o.canEmail ? 'Marketing email OK' : 'Transactional / on-site only'}
                    </span>
                    <p className="mt-2 text-sm leading-snug text-foreground/80">{o.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <ActionList items={customers.recommendations} />
        </section>
      )}

      {/* CONVERSATIONS — PawPal (last; thinnest data for now) */}
      <section className="mb-10">
        <Eyebrow icon={MessageSquare}>This week in conversations (PawPal)</Eyebrow>
        <FigureTiles figures={view.figures} />
        {view.themes.length > 0 && (
          <div className="mb-6 space-y-3">
            {view.themes.map((t, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <Quote className="size-3.5 text-muted-foreground" />
                    {t.displayName}
                  </div>
                  <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic text-foreground/80">
                    “{t.quote}”
                  </blockquote>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground">{t.conversationId}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <ActionList items={view.recommendations} />
      </section>

      {/* COMING SOON — honest placeholder for the not-yet-wired retrieval seams */}
      <section className="mb-10">
        <Eyebrow icon={Clock}>Coming soon</Eyebrow>
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Traffic sources &amp; funnel (GA4) and inventory / stock-out forecasts arrive once the
            traffic and Shopify-Admin retrieval seams land. They&apos;re intentionally not shown here
            rather than mocked — every number above is real.
          </CardContent>
        </Card>
      </section>

      {/* re-prompt — MOCK (clearly labeled) */}
      <section>
        <Eyebrow icon={Sparkles}>Steer the analysis (mock)</Eyebrow>
        {regenerated && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Preview only — not saved. Real re-prompts run server-side.</span>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="size-3.5" /> Reset
            </Button>
          </div>
        )}
        <Card>
          <CardContent className="space-y-3 p-4">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Steer the analysis — e.g. “focus on cat products” or “only urgent actions”. Leave blank to just re-run."
              rows={2}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={regenerate} disabled={busy} className="gap-1.5">
                <Sparkles className="size-4" />
                {busy ? 'Analyzing…' : instruction.trim() ? 'Re-analyze' : 'Re-run'}
              </Button>
              <span className="text-xs text-muted-foreground">
                Mock — the real version runs <code className="font-mono">synthesize()</code> server-side.
              </span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DegradedPane({row}: {row: DigestArchiveRow}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{row.digest.window.label}</h1>
        <Badge variant="destructive" className="gap-1">
          <TriangleAlert className="size-3" /> no data
        </Badge>
      </div>
      <p className="text-lg text-muted-foreground">{row.digest.headline}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        No signals were retrieved for this window — the analyst has nothing to synthesize. Check the batch job.
      </p>
    </div>
  );
}

// ── shell (header + week sidebar) ────────────────────────────────────────────
export function AnalystDashboard({
  digests,
  usingMock,
}: {
  digests: DigestArchiveRow[];
  usingMock: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const row = digests[selected];

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
        <span className="hidden text-sm text-muted-foreground sm:inline">weekly AI store-ops analyst</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
            <nav className="flex-1 overflow-y-auto p-2">
              <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Weeks
              </div>
              {digests.map((d, i) => (
                <button
                  key={d.window_from}
                  onClick={() => setSelected(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    i === selected
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/50',
                  )}
                >
                  <span className={cn('size-2 shrink-0 rounded-full', d.digest.degraded ? 'bg-amber-500' : 'bg-primary')} />
                  <span className="flex-1 truncate">{d.digest.window.label}</span>
                  {d.emailed_at && <Mail className="size-3.5 text-muted-foreground" />}
                </button>
              ))}
            </nav>
            {usingMock && (
              <>
                <Separator />
                <div className="p-3 text-[11px] leading-snug text-muted-foreground">
                  Mock data — set <code className="font-mono">SUPABASE_*_ARCHIVE</code> to read live digests. Traffic and
                  inventory signals are still pending their retrieval seams.
                </div>
              </>
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {!row ? (
            <div className="p-10 text-muted-foreground">No digests archived yet.</div>
          ) : row.digest.degraded ? (
            <DegradedPane key={row.window_from} row={row} />
          ) : (
            <DigestPane key={row.window_from} row={row} />
          )}
        </main>
      </div>
    </div>
  );
}
