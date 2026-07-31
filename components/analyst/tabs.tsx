'use client';

// Tab compositions — each is a projection of one AnalystBrief. Client components:
// the server pages pass only serializable data (brief/row), and these compose the
// client sections (./sections) + charts (./charts), which take lucide icon
// component props — those can't cross the server→client boundary, so tabs are client.
import {Activity, Gauge, Lightbulb, Package, Sparkles, TriangleAlert, Users} from 'lucide-react';
import type {DigestArchiveRow} from '../../src/types';
import type {AnalystBrief, Category} from '../../src/salesSignals';
import {ConversionFunnel, TopSkusChart, TrafficDonut} from './charts';
import {PreferencesForm} from './settings/preferences-form';
import {
  AnomalyRadar,
  ComingSoonNote,
  ConversationsSection,
  CustomersSection,
  DegradedNote,
  Eyebrow,
  KpiTile,
  MockNote,
  PredictionCard,
  PredictionCards,
  RecommendationsList,
  RepromptPanel,
  RevenueForecastCard,
  SalesSection,
  VerdictHero,
} from './sections';

const byCat = (b: AnalystBrief, c: Category) => ({
  recs: b.recommendations.filter((r) => r.category === c),
  predictions: b.predictions.filter((p) => p.category === c),
  anomalies: b.anomalies.filter((a) => a.category === c),
});

// Every tab keeps the same contract: REAL archived-digest data first, then any
// mock-brief block behind a <MockNote>. Traffic/inventory have no retrieval seam
// yet, so those tabs are mock-only until one lands.
const PENDING_SEAMS =
  'Traffic sources & funnel (GA4) and inventory / stock-out forecasts arrive once the traffic and Shopify-Admin retrieval seams land.';

function TabContainer({children}: {children: React.ReactNode}) {
  return <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">{children}</div>;
}

type TabProps = {brief: AnalystBrief; row: DigestArchiveRow};

// ── Overview — the executive summary ────────────────────────────────────────────
// Real digest first (sales → customers → conversations), then the mock predictive
// layer, then the honest "not wired yet" note. The mock KPI row that used to head
// this tab was dropped in the merge: its revenue/AOV numbers sat directly above the
// real ones from `digest.sales`, which read as two conflicting truths.
export function OverviewTab({brief, row}: TabProps) {
  if (row.digest.degraded) return <TabContainer><DegradedNote row={row} /></TabContainer>;
  const s = brief.signals;
  return (
    <TabContainer>
      <VerdictHero row={row} />

      <SalesSection row={row} />
      <CustomersSection row={row} />
      <ConversationsSection row={row} />

      <section className="mb-10">
        <Eyebrow icon={Sparkles}>What I predict</Eyebrow>
        <MockNote>
          Mock predictive layer — the forecast, predictions and anomalies below are generated from sample signals,
          not from the archived digest. Everything above this point is real.
        </MockNote>
        <div className="grid gap-4 lg:grid-cols-5">
          <RevenueForecastCard revenue={s.revenue} />
          <PredictionCards predictions={brief.predictions} className="lg:col-span-2" />
        </div>
      </section>

      <section className="mb-10">
        <Eyebrow icon={Lightbulb}>What you should do — ranked by impact × confidence</Eyebrow>
        <MockNote>Mock — ranked actions from the sample brief. The digest&apos;s real actions are listed in each section above.</MockNote>
        <RecommendationsList recs={brief.recommendations} />
      </section>

      <section className="mb-10">
        <Eyebrow icon={TriangleAlert}>Anomaly radar</Eyebrow>
        <MockNote>Mock — anomaly detection has no retrieval seam yet.</MockNote>
        <AnomalyRadar anomalies={brief.anomalies} />
      </section>

      <ComingSoonNote>
        {PENDING_SEAMS} They&apos;re labeled as mock rather than presented as real — every unlabeled number on this
        page comes from the archived digest.
      </ComingSoonNote>

      <RepromptPanel row={row} />
    </TabContainer>
  );
}

// ── Inventory ────────────────────────────────────────────────────────────────────
export function InventoryTab({brief, row}: TabProps) {
  if (row.digest.degraded) return <TabContainer><DegradedNote row={row} /></TabContainer>;
  const {recs, predictions, anomalies} = byCat(brief, 'inventory');
  return (
    <TabContainer>
      <TabHeading icon={Package} title="Inventory" row={row} />
      <MockNote>
        This whole tab is mock. {PENDING_SEAMS} Real per-product revenue for the week is on the Overview tab, from
        the digest&apos;s sales block.
      </MockNote>
      <section className="mb-10">
        <Eyebrow icon={Sparkles}>What I predict</Eyebrow>
        <div className="grid gap-3 md:grid-cols-2">
          {predictions.map((p) => <PredictionCard key={p.id} p={p} />)}
        </div>
      </section>
      <section className="mb-10">
        <Eyebrow icon={Lightbulb}>Recommended actions</Eyebrow>
        <RecommendationsList recs={recs} />
      </section>
      <section className="mb-10">
        <Eyebrow icon={Gauge}>Top sellers by revenue</Eyebrow>
        <div className="rounded-xl border p-4">
          <TopSkusChart skus={brief.signals.topSkus} />
        </div>
      </section>
      <section className="mb-4">
        <Eyebrow icon={TriangleAlert}>Inventory anomalies</Eyebrow>
        <AnomalyRadar anomalies={anomalies} />
      </section>
    </TabContainer>
  );
}

// ── Customers / CRM ──────────────────────────────────────────────────────────────
export function CustomersTab({brief, row}: TabProps) {
  if (row.digest.degraded) return <TabContainer><DegradedNote row={row} /></TabContainer>;
  const {recs, predictions, anomalies} = byCat(brief, 'crm');
  const c = brief.signals.customers;
  return (
    <TabContainer>
      <TabHeading icon={Users} title="Customers" row={row} />

      {/* real: the digest's own customers block (names masked server-side) */}
      <CustomersSection row={row} />

      <section className="mb-10">
        <Eyebrow icon={Users}>CRM snapshot</Eyebrow>
        <MockNote>Mock — the CRM roll-up below is sample data. The outreach list above is the real digest.</MockNote>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile icon={Users} label="Customers" value={c.total.toLocaleString()} sub={`${c.repeatPct}% repeat`} />
          <KpiTile icon={Users} label="At-risk" value={String(c.atRisk)} sub={`${c.churnPct}% churn`} />
          <KpiTile icon={Users} label="VIPs" value={String(c.vip)} sub="top spenders" />
          <KpiTile icon={Users} label="New" value={String(c.new)} sub="this week" />
        </div>
      </section>
      <section className="mb-10">
        <Eyebrow icon={Sparkles}>What I predict</Eyebrow>
        <MockNote>Mock predictive layer.</MockNote>
        <div className="grid gap-3 md:grid-cols-2">
          {predictions.map((p) => <PredictionCard key={p.id} p={p} />)}
        </div>
      </section>
      <section className="mb-10">
        <Eyebrow icon={Lightbulb}>Recommended actions</Eyebrow>
        <MockNote>Mock — sample brief actions.</MockNote>
        <RecommendationsList recs={recs} />
      </section>
      <section className="mb-4">
        <Eyebrow icon={TriangleAlert}>Customer anomalies</Eyebrow>
        <MockNote>Mock — anomaly detection has no retrieval seam yet.</MockNote>
        <AnomalyRadar anomalies={anomalies} />
      </section>
    </TabContainer>
  );
}

// ── Traffic & Funnel ────────────────────────────────────────────────────────────
export function TrafficTab({brief, row}: TabProps) {
  if (row.digest.degraded) return <TabContainer><DegradedNote row={row} /></TabContainer>;
  const {recs, anomalies} = byCat(brief, 'traffic');
  const s = brief.signals;
  return (
    <TabContainer>
      <TabHeading icon={Activity} title="Traffic & funnel" row={row} />
      <MockNote>This whole tab is mock. {PENDING_SEAMS}</MockNote>
      <section className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile icon={Activity} label="Sessions" value={s.traffic.sessions.toLocaleString()} sub="this week" />
      </section>
      <section className="mb-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-4">
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
        </div>
        <div className="rounded-xl border p-4">
          <div className="mb-1 text-sm font-medium">Conversion funnel</div>
          <div className="mb-3 text-xs text-muted-foreground">Biggest leak: product views → add to cart (−72%)</div>
          <ConversionFunnel funnel={s.funnel} />
        </div>
      </section>
      <section className="mb-10">
        <Eyebrow icon={Lightbulb}>Recommended actions</Eyebrow>
        <RecommendationsList recs={recs} />
      </section>
      <section className="mb-4">
        <Eyebrow icon={TriangleAlert}>Traffic anomalies</Eyebrow>
        <AnomalyRadar anomalies={anomalies} />
      </section>
    </TabContainer>
  );
}

// ── Settings — account (mock) + digest preferences (mock persistence) ────────────
export function SettingsTab() {
  return (
    <TabContainer>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Account and digest preferences. <span className="font-medium">Mock flow</span> — preferences save to your
        browser; real per-store persistence + sign-in land next.
      </p>
      <PreferencesForm />
    </TabContainer>
  );
}

function TabHeading({icon: Icon, title, row}: {icon: typeof Package; title: string; row: DigestArchiveRow}) {
  return (
    <header className="mb-8">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {row.digest.window.label}
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
