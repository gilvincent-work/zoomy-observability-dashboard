'use client';

// Reusable analyst-brief sections. Each tab (Overview / Inventory / Customers /
// Traffic) composes a subset of these — the projection of one AnalystBrief. Keeps
// the brief's shape the single source and avoids per-tab duplication (DRY/SRP).
import {useState} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock,
  Eye,
  FlaskConical,
  Check,
  Gauge,
  ListChecks,
  Mail,
  MessageSquare,
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
import type {DigestArchiveRow, DigestFigure, DigestLazadaFacet, DigestRec, DigestShopeeFacet, OutreachList, TimeBasis} from '../../src/types';
import {usePlaybook, usePlaybookProgress, recAction, recSteps} from './playbook';
import type {AnalystBrief, Anomaly, Category, Impact, Prediction, Recommendation, Severity} from '../../src/salesSignals';
import {mockReprompt} from '../../src/reprompt';
import {fmtRange} from '../../src/week';
import {ShopeeIcon, LazadaIcon} from './brand-icons';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {RevenueForecastChart} from './charts';

export const CATEGORY_ICON: Record<Category, typeof Package> = {
  inventory: Package,
  crm: Users,
  revenue: TrendingUp,
  traffic: Activity,
};
export const CATEGORY_LABEL: Record<Category, string> = {
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

export function Eyebrow({icon: Icon, children}: {icon: React.ComponentType<{className?: string}>; children: React.ReactNode}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h2>
  );
}

export function ConfidenceMeter({value, className}: {value: number; className?: string}) {
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

export function Delta({pct}: {pct: number}) {
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

export function KpiTile({
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

// ── verdict hero ──────────────────────────────────────────────────────────────
// The headline is the REAL synthesized one from the archived digest — not the
// mock brief's verdict. Everything above the "predictive layer" divider on a tab
// is real; the mock brief is confined to blocks marked with <MockNote>.
export function VerdictHero({row}: {row: DigestArchiveRow}) {
  const range = fmtRange(row.window_from, row.window_to, row.digest.window.label);
  return (
    <header className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 className="font-serif text-[2.6rem] font-normal leading-[1.05] tracking-tight text-foreground">{range}</h1>
      <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
        <Sparkles className="size-3" /> AI analyst
      </Badge>
      {row.emailed_at && (
        <Badge variant="secondary" className="gap-1">
          <Mail className="size-3" /> emailed
        </Badge>
      )}
    </header>
  );
}

// ── real digest sections ──────────────────────────────────────────────────────
// Ported from the pre-refactor `analyst-dashboard.tsx` monolith so the multi-page
// shell keeps rendering the REAL sales/customers digest. Every value below comes
// straight from the archived DigestDocument — nothing here is mocked.

function basisLabel(basis: TimeBasis): string {
  if (basis === 'window') return 'this window';
  if (basis === 'recurring') return 'weekly trend';
  return 'all-time';
}

/** Bold the figures inside AI narrative (percentages, ×, currency, plain numbers)
 *  so the eye catches the data while reading. Returns an array of strings/JSX. */
const FIGURE_RE = /(₱\s?\d[\d,]*(?:\.\d+)?|PHP\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?[×x](?![a-z])|\d[\d,]*(?:\.\d+)?)/gi;
function emphasizeFigures(text: string): React.ReactNode[] {
  return text.split(FIGURE_RE).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

/** Conservative sentiment of a finding, used only to tint its marker. */
const GOOD_RE = /\b(profitable|healthy|strong|positive|clean|almost always|follow through|not the problem|no (?:supply )?risk)\b/i;
const WATCH_RE = /\b(leak|weak|eaten|thinning|drag|bottleneck|abandon|does\s?n'?t (?:buy|convert)|leave without|not converting|below benchmark|at risk|overstat)\b/i;
function findingTone(text: string): 'good' | 'watch' | 'neutral' {
  if (WATCH_RE.test(text)) return 'watch';
  if (GOOD_RE.test(text)) return 'good';
  return 'neutral';
}
const TONE_VAR = {good: 'var(--status-good)', watch: 'var(--status-warn)', neutral: 'var(--primary)'} as const;

/** Read-only metric tiles — Coop editorial style: tiny uppercase label, big number
 *  in the sans face with a small unit. Percentage tiles carry a progress bar so a
 *  low rate reads as a near-empty bar (the leak) and a high rate as nearly full. */
export function FigureTiles({figures, hideBasis}: {figures: DigestFigure[]; hideBasis?: boolean}) {
  if (!figures.length) return null;
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {figures.map((f, i) => {
        // Strip the "(window)" suffix first, THEN test/strip a trailing "%".
        const base = f.label.replace(/\s*\((?:this\s+)?window\)\s*$/i, '').trim();
        const isPct = /%\s*$/.test(base);
        const label = base.replace(/\s*%\s*$/, '').trim();
        const pct = isPct ? Math.max(0, Math.min(100, f.value)) : null;
        return (
          <Card key={`${f.label}-${i}`}>
            <CardContent className="p-5">
              <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                {label}
              </div>
              <div className="flex items-baseline gap-0.5">
                <span className="text-[30px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
                  {f.value.toLocaleString()}
                </span>
                {isPct && <span className="text-[17px] font-medium leading-none text-muted-foreground">%</span>}
              </div>
              {pct != null ? (
                <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{width: `${pct}%`}} />
                </div>
              ) : (
                !hideBasis && <div className="mt-1.5 text-xs text-muted-foreground">{basisLabel(f.timeBasis)}</div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** A compact conversion funnel — ordered stages, each a bar scaled to the top
 *  stage, with the step-through % between, so the drop-off reads at a glance. */
function FunnelStrip({title, stages}: {title?: string; stages: {label: string; value: number}[]}) {
  if (stages.length < 2) return null;
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      {title && <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>}
      <div className="space-y-2.5">
        {stages.map((s, i) => {
          const w = Math.max(3, (s.value / max) * 100);
          const prev = i > 0 ? stages[i - 1].value : null;
          const step = prev ? (s.value / prev) * 100 : null;
          return (
            <div key={s.label}>
              {step != null && (
                <div className="mb-1.5 ml-[124px] flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ArrowDown className="size-3" />
                  {(step < 10 ? step.toFixed(2) : step.toFixed(1)) + '% continue'}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-28 shrink-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </div>
                <div className="h-7 flex-1 overflow-hidden rounded-lg bg-muted">
                  <div className="h-full rounded-lg bg-primary/85 transition-all" style={{width: `${w}%`}} />
                </div>
                <div className="w-20 shrink-0 text-right text-[14px] font-semibold tabular-nums text-foreground">
                  {s.value.toLocaleString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Funnel specs, auto-matched to a facet by its figure labels (label signatures are
// distinct across facets, so the first spec whose stages resolve wins).
const FACET_FUNNELS: {title: string; stages: {label: string; match: (l: string) => boolean}[]}[] = [
  {
    title: 'Traffic → buyers',
    stages: [
      {label: 'Visitors', match: (l) => /visitor/i.test(l)},
      {label: 'Buyers', match: (l) => /buyer/i.test(l)},
    ],
  },
  {
    title: 'Clicks → conversions',
    stages: [
      {label: 'Clicks', match: (l) => /clicks/i.test(l)},
      {label: 'Conversions', match: (l) => /conversion/i.test(l) && !/rate|%/i.test(l)},
    ],
  },
  {
    title: 'Orders → net of cancellations',
    stages: [
      {label: 'Orders', match: (l) => /orders/i.test(l) && !/net/i.test(l)},
      {label: 'Net orders', match: (l) => /net orders/i.test(l)},
    ],
  },
];

/** Render a funnel for the facet if its figures resolve one of the specs. */
function FacetFunnel({figures}: {figures: DigestFigure[]}) {
  for (const spec of FACET_FUNNELS) {
    const stages = spec.stages
      .map((st) => {
        const f = figures.find((x) => st.match(x.label));
        return f ? {label: st.label, value: f.value} : null;
      })
      .filter((s): s is {label: string; value: number} => s !== null);
    if (stages.length >= 2) return <FunnelStrip title={spec.title} stages={stages} />;
  }
  return null;
}

/** Diagnosis findings — a scannable grid of insight tiles (not a wall of text). */
export function AssessmentBlock({items}: {items: string[]}) {
  if (!items?.length) return null;
  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Gauge className="size-3.5" /> Reading the numbers
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((text, i) => {
          const color = TONE_VAR[findingTone(text)];
          return (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                style={{backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)`}}
              >
                <Activity className="size-3.5" style={{color}} />
              </span>
              <p className="text-[14.5px] leading-relaxed text-foreground/85">{emphasizeFigures(text)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One recommendation card — shows a step-count badge (and a green "Done" badge
 *  once every step is ticked), and opens the playbook drawer when clicked. */
function ActionCard({item, rank}: {item: DigestRec; rank: number}) {
  const {open} = usePlaybook();
  const action = recAction(item);
  const steps = recSteps(item);
  const total = steps.length;
  const {done, complete} = usePlaybookProgress(action, total);

  const badge =
    total === 0 ? null : complete ? (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{color: 'var(--status-good)', backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}}
      >
        <Check className="size-3" /> Done
      </span>
    ) : (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <ListChecks className="size-3" />
        {done > 0 ? `${done}/${total}` : `${total} steps`}
      </span>
    );

  const body = (
    <CardContent className="flex items-start gap-3 p-4">
      <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold tabular-nums text-primary-foreground">
        {rank}
      </span>
      <p className="flex-1 text-[15px] leading-relaxed text-foreground/90">{emphasizeFigures(action)}</p>
      {badge && <span className="mt-0.5">{badge}</span>}
    </CardContent>
  );

  return total > 0 ? (
    <Card className="cursor-pointer transition-colors hover:border-primary/40">
      <button type="button" onClick={() => open({action, steps})} className="block w-full text-left">
        {body}
      </button>
    </Card>
  ) : (
    <Card>{body}</Card>
  );
}

/** Recommended actions — numbered cards; those with a playbook open a step drawer. */
export function ActionList({items}: {items: DigestRec[]}) {
  if (!items.length) return null;
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <ActionCard key={i} item={item} rank={i + 1} />
      ))}
    </div>
  );
}

export function SalesSection({row}: {row: DigestArchiveRow}) {
  const sales = row.digest.sales ?? null;
  if (!sales) return null;
  const topMax = Math.max(1, ...sales.topProducts.map((p) => p.revenue));
  return (
    <section className="mb-10">
      <Eyebrow icon={ShoppingCart}>Website sales — zoomyforpets.com</Eyebrow>
      <p className="mb-4 text-[15px] leading-relaxed text-foreground/85">{emphasizeFigures(sales.headline)}</p>
      <FigureTiles figures={sales.figures} />

      {sales.topProducts.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="mb-3 text-sm font-medium">Top sellers this window</div>
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

      {sales.rising && sales.rising.length > 0 && (
        <div className="mb-4 space-y-2">
          {sales.rising.map((r, i) => (
            <Card key={i} className="border-l-2" style={{borderLeftColor: 'var(--status-good)'}}>
              <CardContent className="flex items-start gap-3 p-4">
                <TrendingUp className="mt-0.5 size-4 shrink-0" style={{color: 'var(--status-good)'}} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.note}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
  );
}

// Shopee marketplace channel — one titled sub-section per facet (sales / ads /
// traffic / products), each its own mini-synthesis (headline + tiles + actions).
const SHOPEE_FACETS: {key: 'sales' | 'ads' | 'traffic' | 'products'; label: string}[] = [
  {key: 'sales', label: 'Sales'},
  {key: 'ads', label: 'Ads'},
  {key: 'traffic', label: 'Traffic'},
  {key: 'products', label: 'Product funnel'},
];

const WINDOW_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-07-04" → "Jul 4". */
function fmtIsoDay(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${WINDOW_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null;
}
type FacetWindow = DigestShopeeFacet['window'] | DigestLazadaFacet['window'];
/** A facet's real export range as "Jul 4 – Aug 2, 2026" (falls back to its raw label). */
function fmtWindow(win: FacetWindow): string | null {
  if (!win) return null;
  const a = fmtIsoDay(win.from);
  const b = fmtIsoDay(win.to);
  if (a && b) {
    const yr = /^(\d{4})/.exec(String(win.to ?? ''));
    return `${a} – ${b}${yr ? `, ${yr[1]}` : ''}`;
  }
  return win.label ?? null;
}

/** Inclusive length of the window in days (Jul 20 → Aug 2 = 14), or null. */
function windowDays(win: FacetWindow): number | null {
  if (!win?.from || !win?.to) return null;
  const from = Date.parse(`${String(win.from).slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${String(win.to).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000) + 1;
}

export function ShopeeSection({row}: {row: DigestArchiveRow}) {
  const shopee = row.digest.shopee ?? null;
  if (!shopee) return null;
  const present = SHOPEE_FACETS.filter((f) => shopee[f.key]);
  if (!present.length) return null;
  return (
    <section className="mb-10">
      <Eyebrow icon={ShopeeIcon}>Shopee — marketplace channel</Eyebrow>
      <div className="space-y-10">
        {present.map(({key, label}) => {
          const facet = shopee[key]!;
          const win = fmtWindow(facet.window);
          const days = windowDays(facet.window);
          return (
            <div key={key}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2.5">
                <h3 className="text-xl font-semibold tracking-tight text-foreground">{label}</h3>
                {win && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.07] px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-primary">
                    <CalendarDays className="size-3.5" />
                    {win}
                    {days != null && <span className="text-primary/70">· {days} days</span>}
                  </span>
                )}
              </div>
              <p className="mb-4 text-[15px] leading-relaxed text-foreground/85">{emphasizeFigures(facet.headline)}</p>
              <FigureTiles figures={facet.figures} hideBasis />
              <FacetFunnel figures={facet.figures} />
              <AssessmentBlock items={facet.assessment ?? []} />
              {facet.recommendations.length > 0 && (
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ArrowRight className="size-3.5" /> Recommended actions
                </div>
              )}
              <ActionList items={facet.recommendations} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Lazada marketplace channel — one titled sub-section per facet (sales / finance /
// inventory), each its own mini-synthesis (headline + tiles + assessment + actions).
const LAZADA_FACETS: {key: 'sales' | 'finance' | 'inventory'; label: string}[] = [
  {key: 'sales', label: 'Sales'},
  {key: 'finance', label: 'Finance'},
  {key: 'inventory', label: 'Inventory'},
];

export function LazadaSection({row}: {row: DigestArchiveRow}) {
  const lazada = row.digest.lazada ?? null;
  if (!lazada) return null;
  const present = LAZADA_FACETS.filter((f) => lazada[f.key]);
  if (!present.length) return null;
  return (
    <section className="mb-10">
      <Eyebrow icon={LazadaIcon}>Lazada — marketplace channel</Eyebrow>
      <div className="space-y-10">
        {present.map(({key, label}) => {
          const facet = lazada[key]!;
          const win = fmtWindow(facet.window);
          const days = windowDays(facet.window);
          return (
            <div key={key}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2.5">
                <h3 className="text-xl font-semibold tracking-tight text-foreground">{label}</h3>
                {win && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.07] px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-primary">
                    <CalendarDays className="size-3.5" />
                    {win}
                    {days != null && <span className="text-primary/70">· {days} days</span>}
                  </span>
                )}
              </div>
              <p className="mb-4 text-[15px] leading-relaxed text-foreground/85">{emphasizeFigures(facet.headline)}</p>
              <FigureTiles figures={facet.figures} hideBasis />
              <FacetFunnel figures={facet.figures} />
              <AssessmentBlock items={facet.assessment ?? []} />
              {facet.recommendations.length > 0 && (
                <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ArrowRight className="size-3.5" /> Recommended actions
                </div>
              )}
              <ActionList items={facet.recommendations} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

const LIST_LABEL: Record<OutreachList, string> = {vip: 'VIP', atRisk: 'At-risk', new: 'New'};

export function CustomersSection({row}: {row: DigestArchiveRow}) {
  const customers = row.digest.customers ?? null;
  if (!customers) return null;
  return (
    <section className="mb-10">
      <Eyebrow icon={Users}>Customers — who to reach out to</Eyebrow>
      <p className="mb-4 text-[15px] leading-relaxed text-foreground/85">{emphasizeFigures(customers.headline)}</p>
      <FigureTiles figures={customers.figures} />

      {customers.outreach.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {customers.outreach.map((o, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  {/* name is masked server-side in getDigests() — see src/pii.ts */}
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
  );
}

/** PawPal conversations — thinnest data, so it sits below sales/customers. */
export function ConversationsSection({row}: {row: DigestArchiveRow}) {
  const digest = row.digest;
  return (
    <section className="mb-10">
      <Eyebrow icon={MessageSquare}>Conversations (PawPal)</Eyebrow>
      <FigureTiles figures={digest.figures} />
      {digest.themes.length > 0 && (
        <div className="mb-6 space-y-3">
          {digest.themes.map((t, i) => (
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
      <ActionList items={digest.recommendations} />
    </section>
  );
}

/** Honest placeholder for retrieval seams that don't exist yet. */
export function ComingSoonNote({children}: {children: React.ReactNode}) {
  return (
    <section className="mb-10">
      <Eyebrow icon={Clock}>Coming soon</Eyebrow>
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </section>
  );
}

/** Marks a block whose numbers come from the mock AnalystBrief, not the digest. */
export function MockNote({children}: {children: React.ReactNode}) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs leading-snug text-muted-foreground">
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── predictions ────────────────────────────────────────────────────────────────
export function RevenueForecastCard({revenue}: {revenue: AnalystBrief['signals']['revenue']}) {
  return (
    <Card className="lg:col-span-3">
      <CardContent className="flex h-full flex-col p-4">
        <div className="mb-1 text-sm font-medium">Revenue forecast</div>
        <div className="mb-3 text-xs text-muted-foreground">6 weeks actual → next week projected, shaded 80% band</div>
        <div className="min-h-[220px] flex-1">
          <RevenueForecastChart revenue={revenue} />
        </div>
      </CardContent>
    </Card>
  );
}

export function PredictionCard({p}: {p: Prediction}) {
  const Icon = CATEGORY_ICON[p.category];
  return (
    <Card>
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
}

export function PredictionCards({predictions, className}: {predictions: Prediction[]; className?: string}) {
  return (
    <div className={cn('space-y-3', className)}>
      {predictions.map((p) => (
        <PredictionCard key={p.id} p={p} />
      ))}
    </div>
  );
}

// ── recommendations (with "show the work") ──────────────────────────────────────
export function RecommendationCard({rec, rank}: {rec: Recommendation; rank: number}) {
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
                      <blockquote className="border-l-2 border-primary/40 pl-3 italic text-foreground/80">“{e.text}”</blockquote>
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
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Known unknowns</div>
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

export function RecommendationsList({recs}: {recs: Recommendation[]}) {
  if (!recs.length) return <EmptyNote>No recommendations in this area.</EmptyNote>;
  return (
    <div className="space-y-3">
      {recs.map((r, i) => (
        <RecommendationCard key={r.id} rec={r} rank={i + 1} />
      ))}
    </div>
  );
}

// ── anomaly radar ────────────────────────────────────────────────────────────────
export function AnomalyRadar({anomalies}: {anomalies: Anomaly[]}) {
  if (!anomalies.length) return <EmptyNote>No anomalies flagged in this area.</EmptyNote>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {anomalies.map((a, i) => (
        <Card key={i} className="border-l-2" style={{borderLeftColor: SEVERITY_VAR[a.severity]}}>
          <CardContent className="p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{color: SEVERITY_VAR[a.severity]}}>
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
  );
}

// ── re-prompt (mock) ────────────────────────────────────────────────────────────
// (The old collapsible `DemandThemes` was dropped in the merge — `ConversationsSection`
// above renders the same themes alongside the digest's real conversation figures.)
export function RepromptPanel({row}: {row: DigestArchiveRow}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 550));
    setPreview(mockReprompt(row.digest, instruction).headline);
    setBusy(false);
  }

  return (
    <section>
      <Eyebrow icon={Sparkles}>Steer the analysis (mock)</Eyebrow>
      {preview && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="text-foreground/80">
            <span className="font-medium">Preview (not saved): </span>
            {preview}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPreview(null)} className="gap-1.5">
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
            <Button onClick={run} disabled={busy} className="gap-1.5">
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
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────────
export function EmptyNote({children}: {children: React.ReactNode}) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</p>;
}

export function DegradedNote({row}: {row: DigestArchiveRow}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{row.digest.window.label}</h1>
      <Badge variant="destructive" className="gap-1">
        <TriangleAlert className="size-3" /> no data
      </Badge>
      <span className="text-sm text-muted-foreground">
        No signals were retrieved for this window — the analyst has nothing to synthesize. Check the batch job.
      </span>
    </div>
  );
}
