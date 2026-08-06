import Link from 'next/link';
import {ArrowRight, Check, Globe} from 'lucide-react';
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

          <div className="mt-4 flex justify-end">
            <Link
              href={`/?channel=all${week ? `&week=${encodeURIComponent(week)}` : ''}`}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary transition-opacity hover:opacity-80"
            >
              Compare all channels <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {/* channel columns — each a doorway into that channel's analytics */}
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <Link
                  key={m.key}
                  href={`/?channel=${m.key}${week ? `&week=${encodeURIComponent(week)}` : ''}`}
                  style={{backgroundColor: 'var(--card-warm)'}}
                  className="group flex flex-col rounded-xl border border-border p-4 transition-all hover:border-foreground/20 hover:shadow-sm"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-4" style={{color: m.accent}} />
                    </span>
                    <span className="text-[15px] font-semibold text-foreground">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.tag}</span>
                  </div>
                  <ul className="space-y-2">
                    {m.tasks.map((t) => (
                      <li key={t} className="flex items-center gap-2 text-sm text-foreground/80">
                        <Check className="size-3.5 shrink-0 text-primary" />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    View analytics <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
