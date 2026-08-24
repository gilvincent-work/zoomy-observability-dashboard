'use client';

import type {ReadyCandidate, RepricedVariant, RepriceRow, RepriceRun} from '@/src/reprice-types';
import {averagePct, badgeText, discountPct, pluraliseCount, priceDelta, readyToReprice, reasonFor, summarise} from '@/src/reprice-labels';
import {InfoTip} from './info-tip';

// Shared money formatter — every peso figure on this page goes through this,
// so thousands separators and the ₱ sign are consistent everywhere.
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

// Short form for the stat-card date line: no year, no "PH time" suffix (that
// lives in the card's own sub-line instead).
const fmtRanAtShort = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });

const truncate = (s: string, max = 44) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

/** The single most important thing on the page — whether THIS RUN wrote
 *  anything to Shopify, or was a rehearsal. Deliberately describes the run,
 *  not the store: a dry run saying "nothing changed" previously read as a
 *  claim about the store's prices, when a price had in fact been applied by
 *  an earlier run. */
function RunBadge({dryRun, appliedCount}: {dryRun: boolean; appliedCount: number}) {
  const text = badgeText(dryRun, appliedCount);
  return dryRun ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/15 px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      <span className="size-2 rounded-full bg-amber-500" />
      {text}
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-sm font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
      <span className="size-2 rounded-full bg-emerald-500" />
      {text}
    </span>
  );
}

/** A card's value can either be a short numeric/percentage figure (large,
 *  tabular) or a longer piece of text like a timestamp — those get a smaller
 *  primary size plus an optional muted sub-line, so every card in the row
 *  keeps the same height regardless of what it shows. */
function StatCard({label, value, hint, sub, size = 'lg', tone = 'default'}: {
  label: string;
  value: string;
  hint?: string;
  sub?: string;
  size?: 'lg' | 'md';
  tone?: 'default' | 'emerald';
}) {
  const valueClass =
    size === 'lg'
      ? 'text-[28px] font-bold leading-none tabular-nums'
      : 'text-[19px] font-bold leading-tight tabular-nums';
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground';

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.09em] text-foreground/60">
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div className="mt-2">
        <div className={`${valueClass} ${toneClass}`}>{value}</div>
        {sub && <div className="mt-1 text-xs font-medium text-foreground/50">{sub}</div>}
      </div>
    </div>
  );
}

/** The lead section: the state of the store, not the state of the latest job.
 *  Explicitly NOT a live Shopify read — the honesty caveat lives right next
 *  to the column it qualifies, via the InfoTip. */
function CurrentlyRepricedTable({variants}: {variants: RepricedVariant[]}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-left">Product</th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="inline-flex items-center justify-end gap-1">
                Lazada price
                <InfoTip text="The Lazada price this variant was priced against. The discount column is how far the written price sits below it." />
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="inline-flex items-center justify-end gap-1">
                Shopify price
                <InfoTip text="What this variant was priced at on the website before the repricer last changed it." />
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="inline-flex items-center gap-1 justify-end">
                Price set by repricer
                <InfoTip text="The last price the repricer wrote for this variant. If someone edited the price in Shopify afterwards, this will be out of date — this page does not read live Shopify prices." />
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-right">Discount</th>
            <th scope="col" className="px-4 py-3 text-left">When</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const delta = priceDelta(v.oldPrice, v.newPrice);
            return (
              <tr key={v.shopifyVariantId} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/25">
                {/* SKU rides under the product name; the "Lazada price" column
                    must carry the reference PRICE, otherwise the discount has
                    nothing on screen to be a discount from. */}
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{v.shopifyTitle ?? v.marketplaceTitle}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{v.marketplaceSku}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground/70">
                  {v.referencePrice != null ? peso0(v.referencePrice) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground/45 line-through">
                  {v.oldPrice != null ? peso0(v.oldPrice) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <div className="font-semibold text-foreground">{v.newPrice != null ? peso0(v.newPrice) : '—'}</div>
                  {delta && delta.direction !== 'same' && (
                    <div
                      className={`mt-0.5 text-xs font-medium ${
                        delta.direction === 'down' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {delta.direction === 'down' ? '−' : '+'}
                      {peso0(delta.amount)} ({delta.direction === 'down' ? '−' : '+'}
                      {delta.pct}%)
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                  {v.discountPct != null ? `${v.discountPct}%` : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground/70">{fmtRanAt(v.ranAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChangedTable({rows}: {rows: RepriceRow[]}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-left">Product</th>
            <th scope="col" className="px-4 py-3 text-right">Lazada price</th>
            <th scope="col" className="px-4 py-3 text-right">Website old → new</th>
            <th scope="col" className="px-4 py-3 text-right">Discount %</th>
            <th scope="col" className="px-4 py-3 text-left">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = discountPct(r);
            const key = r.shopifyVariantId ?? r.marketplaceSku ?? String(i);
            return (
              <tr key={key} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/25">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{r.shopifyTitle ?? r.marketplaceTitle}</div>
                </td>
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

/** The actionable "what could be repriced next" set: fully matched and priced
 *  by the job, blocked only on a missing floor price in Shopify. This was
 *  previously buried inside the collapsed "Not changed" list — surfacing it
 *  as its own table is the point of this section. */
function ReadyToRepriceTable({candidates}: {candidates: ReadyCandidate[]}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-left">Product</th>
            <th scope="col" className="px-4 py-3 text-right">Lazada price</th>
            <th scope="col" className="px-4 py-3 text-right">Shopify price now</th>
            <th scope="col" className="px-4 py-3 text-right">
              <span className="inline-flex items-center justify-end gap-1">
                Would become
                <InfoTip text="What the next run would write if a floor price were set. Prices never move more than 10% in one run, so a bigger target is reached over several runs. If the floor you set is higher than this figure, the floor wins." />
              </span>
            </th>
            <th scope="col" className="px-4 py-3 text-left">What&apos;s needed</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.marketplaceSku} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/25">
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{c.shopifyTitle ?? c.marketplaceTitle}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{c.marketplaceSku}</div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-foreground/70">
                {c.referencePrice != null ? peso0(c.referencePrice) : '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-foreground/70">{peso0(c.oldPrice)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                <div className="font-semibold text-foreground">{peso0(c.firstRunPrice)}</div>
                {c.capped && (
                  <div className="mt-0.5 text-xs text-foreground/50">10% cap — full target {peso0(c.targetPrice)} over two runs</div>
                )}
              </td>
              <td className="px-4 py-3 text-foreground/70">Set a floor price</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({children}: {children: React.ReactNode}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center text-sm text-foreground/65">
      {children}
    </div>
  );
}

export function RepricerView({run, repriced}: {run: RepriceRun; repriced: RepricedVariant[]}) {
  const summary = summarise(run.rows);
  const changedRows = run.rows.filter((r) => r.newPrice != null);
  const notChangedRows = run.rows.filter((r) => r.newPrice == null);
  const appliedCount = run.rows.filter((r) => r.applied).length;

  const avgDiscount = averagePct(repriced.map((v) => v.discountPct).filter((d): d is number => d != null));
  const lastChangeAt = repriced[0]?.ranAt ?? null;
  const topSkipReason = summary.skipped[0]?.reason ?? 'no eligible price changes this run';

  const readyCandidates = readyToReprice(run.rows);
  const needsMatchCheckCount = run.rows.filter((r) => r.skipReason === 'needs-review' || r.skipReason === 'ambiguous').length;

  // Example product names per "not changed" group, for inspectable counts
  // rather than an abstract number — up to 5 per group, newest-considered order.
  const examplesByReason = new Map<string, string[]>();
  for (const r of notChangedRows) {
    const reason = reasonFor(r);
    const arr = examplesByReason.get(reason) ?? [];
    arr.push(r.marketplaceTitle);
    examplesByReason.set(reason, arr);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 px-6 pb-6 pt-6">
      <style>{`
        @keyframes repriceRise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @media (prefers-reduced-motion: no-preference) {
          .reprice-reveal{opacity:0;animation:repriceRise .45s ease-out forwards}
        }
      `}</style>

      <header className="reprice-reveal space-y-3 motion-safe:[animation-delay:0ms]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">Repricer</h1>
        </div>
        <p className="text-sm text-foreground/65">Website prices held below Lazada</p>
      </header>

      {/* ── Currently repriced — the state of the store, above the run detail ── */}
      <section className="reprice-reveal space-y-3 motion-safe:[animation-delay:60ms]">
        <h2 className="text-lg font-bold text-foreground">Currently repriced</h2>
        {repriced.length > 0 ? (
          <CurrentlyRepricedTable variants={repriced} />
        ) : (
          <EmptyState>
            <p>The repricer hasn&apos;t changed any prices yet.</p>
            <p className="text-foreground/50">Runs so far have been previews.</p>
          </EmptyState>
        )}
      </section>

      <div className="reprice-reveal grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 motion-safe:[animation-delay:120ms]">
        <StatCard
          label="Products repriced"
          value={String(repriced.length)}
          hint="How many distinct products the repricer has ever actually written a new price for, across all runs."
        />
        <StatCard
          label="Average discount vs Lazada"
          value={avgDiscount != null ? `${avgDiscount}%` : 'N/A'}
          hint="Across products the repricer has priced, how far below the Lazada reference price the last written price sits, on average. The target is 20%."
          tone="emerald"
        />
        <StatCard
          label="Last price change"
          size="md"
          value={lastChangeAt ? fmtRanAtShort(lastChangeAt) : 'Never'}
          sub={lastChangeAt ? 'PH time' : undefined}
          hint="When the repricer last actually wrote a new price to Shopify — as opposed to a preview run that only decided what it would do."
        />
        <StatCard
          label="Products considered"
          value={String(summary.considered)}
          hint="Every Lazada listing the most recent run looked at, whether or not it resulted in a price change."
        />
      </div>

      {/* ── Ready to reprice — the actionable set: matched and priced, just
          missing a floor price. Sits above the run detail because it is the
          thing an admin can actually act on today. ── */}
      <section className="reprice-reveal space-y-3 motion-safe:[animation-delay:180ms]">
        <div>
          <h2 className="text-lg font-bold text-foreground">Ready to reprice ({readyCandidates.length})</h2>
          <p className="text-sm text-foreground/65">Matched and priced — waiting only on a floor price in Shopify.</p>
        </div>
        {readyCandidates.length > 0 ? (
          <ReadyToRepriceTable candidates={readyCandidates} />
        ) : (
          <EmptyState>
            <p>Nothing is waiting on a floor price right now.</p>
          </EmptyState>
        )}
        {needsMatchCheckCount > 0 && (
          <p className="text-xs text-foreground/55">
            {pluraliseCount(needsMatchCheckCount, 'more product')} need a match check before they can be priced — see Not changed below.
          </p>
        )}
      </section>

      {/* ── Latest run — what the most recent job execution did ── */}
      <section className="reprice-reveal space-y-3 motion-safe:[animation-delay:240ms]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-foreground">Latest run</h2>
          <span className="flex items-center gap-1.5 text-sm">
            <span className="rounded-md bg-foreground/[0.06] px-2 py-0.5 font-bold tabular-nums text-foreground">{fmtRanAt(run.ranAt)}</span>
            <InfoTip text="The repricing job runs manually from a terminal command — it is not on an automatic schedule. This section shows the most recent run's audit trail." />
          </span>
          <RunBadge dryRun={run.dryRun} appliedCount={appliedCount} />
        </div>

        {changedRows.length > 0 ? (
          <ChangedTable rows={changedRows} />
        ) : (
          <EmptyState>
            <p>This run found nothing new to change.</p>
            <p>
              The most common reason: <span className="font-semibold text-foreground">{topSkipReason}</span>.
            </p>
          </EmptyState>
        )}
        <p className="text-xs text-foreground/55">
          {run.dryRun
            ? `${pluraliseCount(summary.wouldChange, 'price')} would change if this run were applied.`
            : `${pluraliseCount(summary.changed, 'price')} written by this run.`}
        </p>
      </section>

      <section className="reprice-reveal motion-safe:[animation-delay:300ms]">
        <details className="group rounded-2xl border border-border bg-card open:pb-2">
          <summary
            className="flex cursor-pointer list-none items-center justify-between rounded-2xl px-5 py-4 text-sm font-bold text-foreground outline-none transition-colors hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-primary/40 group-open:rounded-b-none"
          >
            <span>Not changed ({notChangedRows.length})</span>
            <span className="text-foreground/50 transition-transform duration-200 group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-2 px-5 pb-3">
            {summary.skipped.length === 0 ? (
              <p className="text-sm text-foreground/60">Every product considered this run received a new price.</p>
            ) : (
              summary.skipped.map((g) => {
                const examples = examplesByReason.get(g.reason) ?? [];
                const shown = examples.slice(0, 5);
                const extra = examples.length - shown.length;
                return (
                  <div key={g.reason} className="rounded-lg bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-foreground/85">
                        <span className="font-semibold text-foreground">{g.count}</span> — {g.reason}
                      </span>
                      {g.action && <span className="text-xs italic text-foreground/55">{g.action}</span>}
                    </div>
                    {shown.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 pl-0.5 text-xs text-foreground/60">
                        {shown.map((title, i) => (
                          <li key={i} className="truncate">{truncate(title)}</li>
                        ))}
                        {extra > 0 && <li className="italic text-foreground/45">+ {extra} more</li>}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </details>
      </section>

      <footer className="reprice-reveal rounded-xl border border-dashed border-border bg-muted/30 p-4 text-[13px] leading-relaxed text-foreground/65 motion-safe:[animation-delay:360ms]">
        The repricer is run manually from a terminal command — it does not run on its own schedule. By default it runs as a{' '}
        <strong className="text-foreground">preview (dry run)</strong>, meaning it decides what prices would change but writes nothing to Shopify;
        someone has to explicitly apply the results. A variant with no <strong className="text-foreground">floor price</strong> set in Shopify
        is never touched, even if a lower Lazada price would suggest a bigger discount — that guardrail exists so the job never prices a
        product below what it's allowed to sell for. Prices also never move by more than <strong className="text-foreground">10% in a single run</strong>,
        so a big swing in the Lazada price gets applied gradually over a few runs rather than all at once. Prices shown on this page are what
        the repricer <strong className="text-foreground">set</strong>, not a live read of Shopify, and the job must be run manually from a terminal —
        this page is read-only and never changes anything itself.
      </footer>
    </div>
  );
}
