import Link from 'next/link';
import {ArrowRight, Check, Globe, Megaphone, Sparkles} from 'lucide-react';
import type {DigestArchiveRow, DigestRec} from '../../src/types';
import {fmtRange} from '../../src/week';
import {Card, CardContent} from '@/components/ui/card';
import {ShopeeIcon, LazadaIcon} from './brand-icons';
import {ActionsStat} from './playbook';

// The Coop "daily brief" home — a calm landing that mirrors the video's
// "What should we do today?" screen, tailored to Zoomy's real channels. Each
// column is a doorway into that channel's analytics (?channel=…).
const MODULES = [
  {
    key: 'shopee',
    label: 'Shopee',
    tag: 'Marketplace',
    icon: ShopeeIcon,
    accent: '#ee4d2d',
    tasks: ['Read sales, ads & traffic', 'Diagnose the funnel', 'Flag ROAS / ACOS', 'Recommend actions'],
  },
  {
    key: 'lazada',
    label: 'Lazada',
    tag: 'Marketplace',
    icon: LazadaIcon,
    accent: '#f57224',
    tasks: ['Pull orders via API', 'Read finance & payouts', 'Check inventory', 'Recommend actions'],
  },
  {
    key: 'website',
    label: 'Website',
    tag: 'zoomyforpets.com',
    icon: Globe,
    accent: 'var(--primary)',
    tasks: ['Read Shopify sales', 'Cluster PawPal chats', 'Spot at-risk customers', 'Recommend actions'],
  },
] as const;

/** Every recommended action across the digest, with its playbook step count — feeds
 *  the progress-aware "Actions" stat. */
function collectActions(row: DigestArchiveRow): {action: string; total: number}[] {
  const out: {action: string; total: number}[] = [];
  const push = (recs?: DigestRec[]) => {
    for (const r of recs ?? []) {
      out.push(typeof r === 'string' ? {action: r, total: 0} : {action: r.action, total: r.steps?.length ?? 0});
    }
  };
  const d = row.digest;
  push(d.recommendations);
  push(d.sales?.recommendations);
  push(d.customers?.recommendations);
  for (const f of ['sales', 'ads', 'traffic', 'products'] as const) push(d.shopee?.[f]?.recommendations);
  for (const f of ['sales', 'finance', 'inventory'] as const) push(d.lazada?.[f]?.recommendations);
  return out;
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="text-right">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function HomeLanding({row}: {row: DigestArchiveRow}) {
  const range = fmtRange(row.window_from, row.window_to, row.digest.window.label);
  const present = [row.digest.shopee, row.digest.lazada, row.digest.sales || row.digest.customers].filter(Boolean).length;
  const week = row.window_from;
  const actions = collectActions(row);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12 md:px-10">
      <h1 className="mb-8 text-[30px] font-semibold tracking-tight text-foreground">What should we do today?</h1>

      <Card>
        <CardContent className="p-6 md:p-7">
          {/* header */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
              </span>
              <div>
                <div className="text-[17px] font-semibold leading-tight text-foreground">Coop Intelligence</div>
                <div className="text-xs text-muted-foreground">Your store-ops brief · {range}</div>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <Stat label="Channels" value={String(present)} />
              <ActionsStat actions={actions} />
              <Stat label="Sources" value="Live" />
            </div>
          </div>

          <div className="h-px w-full bg-border" />

          {/* module cards — Sales (live) + Marketing (placeholder) */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {/* Sales — opens the unified cross-channel comparison */}
            <Link
              href={`/?channel=all${week ? `&week=${encodeURIComponent(week)}` : ''}`}
              style={{backgroundColor: 'var(--card-warm)'}}
              className="group flex flex-col rounded-xl border border-border p-5 transition-all hover:border-foreground/20 hover:shadow-sm"
            >
              <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
                <span className="flex items-center -space-x-1.5">
                  {MODULES.map((m) => {
                    const Icon = m.icon;
                    return (
                      <span
                        key={m.key}
                        className="flex size-7 items-center justify-center rounded-lg bg-muted ring-2"
                        style={{'--tw-ring-color': 'var(--card-warm)'} as React.CSSProperties}
                      >
                        <Icon className="size-4" style={{color: m.accent}} />
                      </span>
                    );
                  })}
                </span>
                <span className="text-[16px] font-semibold text-foreground">Sales</span>
                <span className="text-xs text-muted-foreground">Shopee · Lazada · Website</span>
              </div>
              <ul className="space-y-2">
                {[
                  'Compare revenue, orders & AOV across channels',
                  'Diagnose the funnel & flag ROAS / ACOS',
                  'Rank top products & spot at-risk customers',
                  'Recommend prioritized actions',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-sm text-foreground/80">
                    <Check className="size-3.5 shrink-0 text-primary" />
                    {t}
                  </li>
                ))}
              </ul>
              <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90">
                View <ArrowRight className="size-4" />
              </span>
            </Link>

            {/* Marketing — placeholder for the AI marketing content studio (coming soon) */}
            <div
              style={{backgroundColor: 'var(--card-warm)'}}
              className="relative flex flex-col rounded-xl border border-dashed border-border p-5"
            >
              <span className="absolute right-4 top-4 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Coming soon
              </span>
              <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
                  <Megaphone className="size-4 text-primary" />
                </span>
                <span className="text-[16px] font-semibold text-foreground">Marketing</span>
                <span className="text-xs text-muted-foreground">AI content studio</span>
              </div>
              <ul className="space-y-2">
                {[
                  'Generate on-brand campaign briefs',
                  'Plan production, assets & scenes',
                  'Write ad image prompts',
                  'Direct video ads',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Sparkles className="size-3.5 shrink-0 text-muted-foreground/60" />
                    {t}
                  </li>
                ))}
              </ul>
              <span className="mt-5 inline-flex cursor-not-allowed items-center gap-1.5 self-start rounded-xl border border-border bg-muted px-6 py-2.5 text-sm font-semibold text-muted-foreground">
                Coming soon
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
