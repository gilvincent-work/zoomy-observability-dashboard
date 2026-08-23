'use client';

import type {RepriceRow, RepriceRun} from '@/src/reprice-types';
import {discountPct, reasonFor, summarise} from '@/src/reprice-labels';
import {InfoTip} from './info-tip';

const peso0 = (n: number) => '₱' + Math.round(n).toLocaleString();

const fmtRanAt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  }) + ' PH time';

/** The single most important thing on the page — whether prices actually
 *  moved anywhere, or this was a rehearsal. Amber vs. green, unmissable. */
function RunBadge({dryRun}: {dryRun: boolean}) {
  return dryRun ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/15 px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      <span className="size-2 rounded-full bg-amber-500" />
      Dry run — nothing was changed
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
      <span className="size-2 rounded-full bg-emerald-500" />
      Applied — prices were updated
    </span>
  );
}

function StatCard({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.09em] text-foreground/60">
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="mt-2 text-[28px] font-bold leading-none tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function ChangedTable({rows}: {rows: RepriceRow[]}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 text-left">Product</th>
            <th className="px-4 py-3 text-right">Lazada price</th>
            <th className="px-4 py-3 text-right">Website old → new</th>
            <th className="px-4 py-3 text-right">Discount %</th>
            <th className="px-4 py-3 text-left">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = discountPct(r);
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{r.shopifyTitle ?? r.marketplaceTitle}</td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground/80">
                  {r.referencePrice != null ? peso0(r.referencePrice) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.oldPrice != null && <span className="text-foreground/45 line-through">{peso0(r.oldPrice)}</span>} →{' '}
                  <span className="font-semibold text-foreground">{r.newPrice != null ? peso0(r.newPrice) : '—'}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  {pct != null ? `${pct}%` : '—'}
                </td>
                <td className="px-4 py-3 text-foreground/70">{reasonFor(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RepricerView({run}: {run: RepriceRun}) {
  const summary = summarise(run.rows);
  const changedRows = run.rows.filter((r) => r.newPrice != null);
  const discounts = changedRows.map(discountPct).filter((d): d is number => d != null);
  const avgDiscount = discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : null;
  const notChanged = summary.considered - changedRows.length;
  const topSkipReason = summary.skipped[0]?.reason ?? 'no eligible price changes this run';

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-6 pb-6 pt-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">Repricer</h1>
          <RunBadge dryRun={run.dryRun} />
        </div>
        <p className="text-sm text-foreground/65">Website prices held below Lazada</p>
        <p className="flex items-center gap-1.5 text-sm">
          <span className="text-foreground/60">Last run</span>
          <span className="rounded-md bg-foreground/[0.06] px-2 py-0.5 font-bold text-foreground">{fmtRanAt(run.ranAt)}</span>
          <InfoTip text="The repricing job runs manually from a terminal command — it is not on an automatic schedule. This page shows the most recent run's audit trail." />
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={run.dryRun ? 'Prices that would change' : 'Prices changed'}
          value={String(run.dryRun ? summary.wouldChange : summary.changed)}
          hint={run.dryRun ? 'How many website prices this run would have updated, had it not been a dry run.' : 'How many website prices this run actually updated.'}
        />
        <StatCard
          label="Average discount vs Lazada"
          value={avgDiscount != null ? `${avgDiscount}%` : 'N/A'}
          hint="Across products with a new price, how far below the Lazada reference price the website landed, on average. The target is 20%."
        />
        <StatCard
          label="Products considered"
          value={String(summary.considered)}
          hint="Every Lazada listing the job looked at this run, whether or not it resulted in a price change."
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-foreground">What changed</h2>
        {changedRows.length > 0 ? (
          <ChangedTable rows={changedRows} />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-foreground/70">
            No website prices {run.dryRun ? 'would have changed' : 'changed'} this run. The most common reason: <span className="font-semibold text-foreground">{topSkipReason}</span>.
          </div>
        )}
      </section>

      <section>
        <details className="group rounded-2xl border border-border bg-card open:pb-2">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-foreground">
            <span>Not changed ({notChanged})</span>
            <span className="text-foreground/50 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-2 px-5 pb-3">
            {summary.skipped.length === 0 ? (
              <p className="text-sm text-foreground/60">Every product considered this run received a new price.</p>
            ) : (
              summary.skipped.map((g) => (
                <div key={g.reason} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-foreground/85">
                    <span className="font-semibold text-foreground">{g.count}</span> — {g.reason}
                  </span>
                  {g.action && <span className="text-xs italic text-foreground/55">{g.action}</span>}
                </div>
              ))
            )}
          </div>
        </details>
      </section>

      <footer className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground/65">
        The repricer is run manually from a terminal command — it does not run on its own schedule. By default it runs as a{' '}
        <strong className="text-foreground">dry run</strong>, meaning it decides what prices would change but writes nothing to Shopify;
        someone has to explicitly apply the results. A variant with no <strong className="text-foreground">floor price</strong> set in Shopify
        is never touched, even if a lower Lazada price would suggest a bigger discount — that guardrail exists so the job never prices a
        product below what it's allowed to sell for. Prices also never move by more than <strong className="text-foreground">10% in a single run</strong>,
        so a big swing in the Lazada price gets applied gradually over a few runs rather than all at once. This page is read-only: it shows what the
        job decided, it never changes anything itself.
      </footer>
    </div>
  );
}
