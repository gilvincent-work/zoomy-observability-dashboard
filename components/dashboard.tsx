'use client';

import {useState} from 'react';
import {Bar, BarChart, CartesianGrid, XAxis} from 'recharts';
import {
  BarChart3,
  ListChecks,
  Mail,
  Menu,
  Quote,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type {DigestArchiveRow, DigestDocument, TimeBasis} from '../src/types';
import {mockReprompt} from '../src/reprompt';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig} from '@/components/ui/chart';
import {cn} from '@/lib/utils';

const BASIS_LABEL: Record<TimeBasis, string> = {
  window: 'this week',
  recurring: 'weekly trend',
  allTime: 'all-time',
};

const shortLabel = (label: string) => (label.length > 16 ? label.slice(0, 15) + '…' : label);

export function Dashboard({digests, usingMock}: {digests: DigestArchiveRow[]; usingMock: boolean}) {
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
        <span className="text-base font-semibold tracking-tight">Zoomy</span>
        <span className="text-sm text-muted-foreground">weekly store-ops digests</span>
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
                  <span
                    className={cn('size-2 shrink-0 rounded-full', d.digest.degraded ? 'bg-amber-500' : 'bg-primary')}
                  />
                  <span className="flex-1 truncate">{d.digest.window.label}</span>
                  {d.emailed_at && <Mail className="size-3.5 text-muted-foreground" />}
                </button>
              ))}
            </nav>
            {usingMock && (
              <>
                <Separator />
                <div className="p-3 text-[11px] leading-snug text-muted-foreground">
                  Mock data — set <code className="font-mono">NEXT_PUBLIC_SUPABASE_*</code> to read live archives.
                </div>
              </>
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          {row ? (
            <DigestPane key={row.window_from} row={row} />
          ) : (
            <div className="p-10 text-muted-foreground">No digests archived yet.</div>
          )}
        </main>
      </div>
    </div>
  );
}

function SectionHeading({icon: Icon, children}: {icon: typeof BarChart3; children: React.ReactNode}) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </h2>
  );
}

function DigestPane({row}: {row: DigestArchiveRow}) {
  const [view, setView] = useState<DigestDocument>(row.digest);
  const [regenerated, setRegenerated] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const d = view;

  async function regenerate() {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 550)); // simulate the round-trip
    setView(mockReprompt(row.digest, instruction));
    setRegenerated(true);
    setBusy(false);
  }
  function reset() {
    setView(row.digest);
    setRegenerated(false);
    setInstruction('');
  }

  const chartData = d.figures.map((f) => ({name: shortLabel(f.label), value: f.value}));
  const chartConfig = {value: {label: 'Value', color: 'var(--chart-1)'}} satisfies ChartConfig;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{d.window.label}</h1>
        {d.degraded && (
          <Badge variant="destructive" className="gap-1">
            <TriangleAlert className="size-3" /> no data
          </Badge>
        )}
        {row.emailed_at && (
          <Badge variant="secondary" className="gap-1">
            <Mail className="size-3" /> emailed
          </Badge>
        )}
        {regenerated && (
          <Badge variant="outline" className="gap-1 border-primary/50 text-primary">
            <Sparkles className="size-3" /> regenerated (mock)
          </Badge>
        )}
      </header>

      {regenerated && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Preview only — not saved. Real re-prompts run server-side.</span>
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
            <RotateCcw className="size-3.5" /> Reset
          </Button>
        </div>
      )}

      <p className="mb-8 text-lg leading-relaxed text-foreground/90">{d.headline}</p>

      {!d.degraded && (
        <>
          {d.figures.length > 0 && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {d.figures.map((f, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {BASIS_LABEL[f.timeBasis] ?? f.timeBasis}
                    </div>
                    <div className="text-3xl font-semibold tabular-nums" style={{fontFamily: 'var(--font-mono)'}}>
                      {f.value}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{f.label}</div>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {chartData.length > 0 && (
            <section className="mb-8">
              <SectionHeading icon={BarChart3}>By the numbers</SectionHeading>
              <Card>
                <CardContent className="pt-4">
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart accessibilityLayer data={chartData} margin={{left: 4, right: 4, top: 8}}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </section>
          )}

          {d.themes.length > 0 && (
            <section className="mb-8">
              <SectionHeading icon={Quote}>Demand themes</SectionHeading>
              <div className="space-y-3">
                {d.themes.map((t, i) => (
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
            </section>
          )}

          {d.recommendations.length > 0 && (
            <section className="mb-8">
              <SectionHeading icon={ListChecks}>Recommended actions</SectionHeading>
              <ul className="space-y-2">
                {d.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Re-prompt / re-synthesize — MOCK */}
      <section>
        <SectionHeading icon={Sparkles}>Re-prompt (mock)</SectionHeading>
        <Card>
          <CardContent className="space-y-3 p-4">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Steer the digest — e.g. “focus on cat products” or “tighter, 3 bullets”. Leave blank to just re-run."
              rows={2}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={regenerate} disabled={busy} className="gap-1.5">
                <Sparkles className="size-4" />
                {busy ? 'Regenerating…' : instruction.trim() ? 'Re-prompt' : 'Re-run'}
              </Button>
              {regenerated && (
                <Button variant="ghost" onClick={reset} className="gap-1.5">
                  <RotateCcw className="size-4" /> Reset
                </Button>
              )}
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
