'use client';

import {useState} from 'react';
import {Bar, BarChart, CartesianGrid, XAxis} from 'recharts';
import type {DigestArchiveRow, TimeBasis} from '../src/types';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
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
  const row = digests[selected];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-baseline gap-2 px-5 py-4">
          <span className="text-lg font-semibold tracking-tight">Zoomy</span>
          <span className="text-xs text-muted-foreground">digests</span>
        </div>
        <Separator />
        <nav className="flex-1 overflow-y-auto p-2">
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
              {d.emailed_at && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">sent</span>
              )}
            </button>
          ))}
        </nav>
        {usingMock && (
          <div className="border-t p-3 text-[11px] leading-snug text-muted-foreground">
            Mock data — set <code className="font-mono">NEXT_PUBLIC_SUPABASE_*</code> to read live archives.
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto">
        {row ? <DigestPane row={row} /> : <div className="p-10 text-muted-foreground">No digests archived yet.</div>}
      </main>
    </div>
  );
}

function DigestPane({row}: {row: DigestArchiveRow}) {
  const d = row.digest;
  const chartData = d.figures.map((f) => ({name: shortLabel(f.label), value: f.value}));
  const chartConfig = {value: {label: 'Value', color: 'var(--chart-1)'}} satisfies ChartConfig;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{d.window.label}</h1>
        {d.degraded && <Badge variant="destructive">no data</Badge>}
        {row.emailed_at && <Badge variant="secondary">emailed</Badge>}
      </header>

      <p className="mb-8 text-lg leading-relaxed text-foreground/90">{d.headline}</p>

      {d.degraded ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-6 text-sm text-muted-foreground">
            No transcripts were scanned this period — a job/health signal, not a demand finding. Check the pipeline.
          </CardContent>
        </Card>
      ) : (
        <>
          {d.figures.length > 0 && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {d.figures.map((f, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {BASIS_LABEL[f.timeBasis] ?? f.timeBasis}
                    </div>
                    <div
                      className="text-3xl font-semibold tabular-nums"
                      style={{fontFamily: 'var(--font-mono)'}}
                    >
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
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                By the numbers
              </h2>
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
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Demand themes
              </h2>
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
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Recommended actions
              </h2>
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
    </div>
  );
}
