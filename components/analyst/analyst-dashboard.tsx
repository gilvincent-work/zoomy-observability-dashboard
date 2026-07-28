'use client';

import {useState} from 'react';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Eye,
  Gauge,
  Lightbulb,
  Mail,
  Menu,
  Package,
  Quote,
  RotateCcw,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type {DigestArchiveRow} from '../../src/types';
import type {AnalystBrief, Category, Impact, Recommendation, Severity} from '../../src/salesSignals';
import {mockReprompt} from '../../src/reprompt';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {cn} from '@/lib/utils';
import {ConversionFunnel, RevenueForecastChart, TopSkusChart, TrafficDonut} from './charts';

// ── small shared pieces ────────────────────────────────────────────────────
const CATEGORY_ICON: Record<Category, typeof Package> = {
  inventory: Package,
  crm: Users,
  revenue: TrendingUp,
  traffic: Activity,
};
const CATEGORY_LABEL: Record<Category, string> = {
  inventory: 'Inventory',
  crm: 'Customers',
  revenue: 'Revenue',
  traffic: 'Traffic',
};
const SEVERITY_VAR: Record<Severity, string> = {
  watch: 'var(--status-good)',
  warning: 'var(--status-warn)',
  critical: 'var(--status-crit)',
};
const SEVERITY_LABEL: Record<Severity, string> = {watch: 'Watch', warning: 'Warning', critical: 'Critical'};
const IMPACT_LABEL: Record<Impact, string> = {high: 'High impact', medium: 'Medium impact', low: 'Low impact'};

function Eyebrow({icon: Icon, children}: {icon: typeof Gauge; children: React.ReactNode}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h2>
  );
}

function ConfidenceMeter({value, className}: {value: number; className?: string}) {
  const pct = Math.round(value * 100);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{width: `${pct}%`}} />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{pct}% confident</span>
    </div>
  );
}

function Delta({pct}: {pct: number}) {
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
      style={{color: up ? 'var(--status-good)' : 'var(--status-crit)'}}
    >
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {pct}%
    </span>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  delta,
  sub,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  delta?: number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Icon className="size-3.5" />
            {label}
          </span>
          {delta != null && <Delta pct={delta} />}
        </div>
        <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── recommendation card with "show the work" drill-down ──────────────────────
function RecommendationCard({rec, rank}: {rec: Recommendation; rank: number}) {
  const [open, setOpen] = useState(false);
  const Icon = CATEGORY_ICON[rec.category];
  const impactColor =
    rec.impact === 'high' ? 'var(--status-crit)' : rec.impact === 'medium' ? 'var(--status-warn)' : 'var(--status-good)';
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-start gap-3 p-4">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">
            {rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-semibold leading-tight">{rec.title}</h3>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3" />
                {CATEGORY_LABEL[rec.category]}
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">{rec.rationale}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{color: impactColor, backgroundColor: 'color-mix(in oklab, ' + impactColor + ' 14%, transparent)'}}
              >
                <Target className="size-3" />
                {IMPACT_LABEL[rec.impact]}
              </span>
              <ConfidenceMeter value={rec.confidence} />
              <button
                onClick={() => setOpen((o) => !o)}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                aria-expanded={open}
              >
                <Eye className="size-3.5" />
                {open ? 'Hide the work' : 'Show the work'}
                <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
              </button>
            </div>
          </div>
        </div>

        {open && (
          <div className="space-y-4 border-t bg-muted/30 px-4 py-4 pl-13">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</div>
              <ul className="space-y-2">
                {rec.evidence.map((e, i) => (
                  <li key={i} className="text-sm">
                    {e.kind === 'quote' ? (
                      <blockquote className="border-l-2 border-primary/40 pl-3 italic text-foreground/80">
                        “{e.text}”
                      </blockquote>
                    ) : (
                      <span className="font-mono text-[13px] tabular-nums text-foreground/90">{e.text}</span>
                    )}
                    <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{e.source}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Why {Math.round(rec.confidence * 100)}% confident
              </div>
              <p className="text-sm text-foreground/80">{rec.confidenceReason}</p>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Known unknowns
              </div>
              <ul className="space-y-1">
                {rec.knownUnknowns.map((u, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/70">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
                    {u}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── the brief pane ───────────────────────────────────────────────────────────
function AnalystPane({brief, row}: {brief: AnalystBrief; row: DigestArchiveRow}) {
  const {signals: s} = brief;
  const [view, setView] = useState(row.digest);
  const [regenerated, setRegenerated] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      {/* verdict hero */}
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
          {brief.verdict}
        </p>
        <ConfidenceMeter value={brief.confidence} className="mt-3" />
      </header>

      {/* KPI row */}
      <section className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile icon={TrendingUp} label="Revenue" value={`$${s.revenue.total.toLocaleString()}`} delta={s.revenue.deltaPct} sub="this week" />
        <KpiTile icon={ShoppingCart} label="Avg order" value={`$${s.revenue.aov}`} sub="AOV" />
        <KpiTile icon={Activity} label="Sessions" value={s.traffic.sessions.toLocaleString()} sub="across 4 sources" />
        <KpiTile icon={Users} label="At-risk" value={String(s.customers.atRisk)} sub={`of ${s.customers.total.toLocaleString()} · ${s.customers.churnPct}% churn`} />
      </section>

      {/* PREDICTIONS — the forward-looking layer */}
      <section className="mb-10">
        <Eyebrow icon={Sparkles}>What I predict</Eyebrow>
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardContent className="flex h-full flex-col p-4">
              <div className="mb-1 text-sm font-medium">Revenue forecast</div>
              <div className="mb-3 text-xs text-muted-foreground">
                6 weeks actual → next week projected, shaded 80% band
              </div>
              <div className="min-h-[220px] flex-1">
                <RevenueForecastChart revenue={s.revenue} />
              </div>
            </CardContent>
          </Card>
          <div className="space-y-3 lg:col-span-2">
            {brief.predictions.map((p) => {
              const Icon = CATEGORY_ICON[p.category];
              return (
                <Card key={p.id}>
                  <CardContent className="p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Icon className="size-3" />
                      {p.label}
                    </div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{p.projection}</div>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{p.basis}</p>
                    <ConfidenceMeter value={p.confidence} className="mt-2" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* RECOMMENDATIONS — ranked, with show-the-work */}
      <section className="mb-10">
        <Eyebrow icon={Lightbulb}>What you should do — ranked by impact × confidence</Eyebrow>
        <div className="space-y-3">
          {brief.recommendations.map((r, i) => (
            <RecommendationCard key={r.id} rec={r} rank={i + 1} />
          ))}
        </div>
      </section>

      {/* ANOMALY RADAR */}
      <section className="mb-10">
        <Eyebrow icon={TriangleAlert}>Anomaly radar</Eyebrow>
        <div className="grid gap-3 md:grid-cols-3">
          {brief.anomalies.map((a, i) => (
            <Card key={i} className="border-l-2" style={{borderLeftColor: SEVERITY_VAR[a.severity]}}>
              <CardContent className="p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{color: SEVERITY_VAR[a.severity]}}
                  >
                    {SEVERITY_LABEL[a.severity]}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{a.metric}</span>
                </div>
                <div className="text-sm font-medium leading-snug">{a.label}</div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{a.detail}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CHARTS grid */}
      <section className="mb-10">
        <Eyebrow icon={Gauge}>The numbers behind it</Eyebrow>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-medium">Top sellers by revenue</div>
              <TopSkusChart skus={s.topSkus} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-medium">Where traffic comes from</div>
              <TrafficDonut traffic={s.traffic} />
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                {s.traffic.sources.map((src, i) => (
                  <span key={src.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full" style={{backgroundColor: `var(--cat-${i + 1})`}} />
                    {src.name}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardContent className="p-4">
              <div className="mb-1 text-sm font-medium">Conversion funnel</div>
              <div className="mb-3 text-xs text-muted-foreground">
                Biggest leak: product views → add to cart (−72%)
              </div>
              <ConversionFunnel funnel={s.funnel} />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* SUPPORTING — demand themes from the digest + mock re-prompt */}
      <section className="mb-4">
        <button
          onClick={() => setShowEvidence((o) => !o)}
          className="mb-3 flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          aria-expanded={showEvidence}
        >
          <Quote className="size-3.5" />
          Demand themes from shopper conversations
          <ChevronDown className={cn('size-3.5 transition-transform', showEvidence && 'rotate-180')} />
        </button>
        {showEvidence && (
          <div className="space-y-3">
            {view.themes.map((t, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="mb-1 font-medium">{t.displayName}</div>
                  <blockquote className="border-l-2 border-primary/40 pl-3 text-sm italic text-foreground/80">
                    “{t.quote}”
                  </blockquote>
                  <div className="mt-2 font-mono text-[11px] text-muted-foreground">{t.conversationId}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* re-prompt — MOCK */}
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
              placeholder="Steer the analysis — e.g. “focus on cat products” or “only inventory risks”. Leave blank to just re-run."
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
  brief,
  usingMock,
}: {
  digests: DigestArchiveRow[];
  brief: AnalystBrief;
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
                  Mock data — sales/CRM/traffic signals are mocked until the extended retrieval bundle lands.
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
            <AnalystPane key={row.window_from} brief={brief} row={row} />
          )}
        </main>
      </div>
    </div>
  );
}
