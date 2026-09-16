'use client';

// The Offline (POS) scope of the Inventory page: an event-aware stock forecast —
// days of cover, projected run-out, suggested reorder per SKU, and the next-event
// surge planner (Phase 2). Line/subcategory filters mirror the Products page.
// The surge is recomputed locally as the owner adjusts the plan (instant what-if);
// each committed change persists via setNextEventPlanAction. See the plan doc.

import {useMemo, useState, useTransition} from 'react';
import {Package, TriangleAlert, TrendingUp} from 'lucide-react';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {POS_CATEGORIES, POS_SUBCATEGORIES, SUBCATEGORY_CATEGORY} from '@/src/pos-format';
import {
  computeSurge,
  type ForecastRow,
  type ForecastStatus,
  type ForecastConfig,
  type NextEventPlan,
} from '@/src/pos-forecast-compute';
import {setNextEventPlanAction} from '@/src/pos-stock-settings-actions';
import type {StockReceipt} from '@/src/pos-stock-intake';
import {AddStockButton, type IntakeProduct} from './add-stock-button';
import {StockHistoryPanel, StockHistoryDrawer} from './stock-history';
import {StockSettingsForm} from './stock-settings-form';

type Scope = 'all' | 'offline';

const STATUS: Record<ForecastStatus, {label: string; dot: string; text: string; bg: string; stripe: string}> = {
  healthy: {label: 'Healthy', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', stripe: 'bg-emerald-500'},
  low: {label: 'Low', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', stripe: 'bg-amber-500'},
  out: {label: 'Out', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', stripe: 'bg-red-500'},
};

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export function InventoryForecast({
  forecast,
  receipts,
  scope,
  usingMock,
}: {
  forecast: {rows: ForecastRow[]; config: ForecastConfig; plan: NextEventPlan} | null;
  receipts: StockReceipt[];
  scope: Scope;
  usingMock: boolean;
}) {
  const [line, setLine] = useState<string>('');
  const [sub, setSub] = useState<string>('');
  const [plan, setPlan] = useState<NextEventPlan>(forecast?.plan ?? {eventThisWeekend: true, multiplier: 1, byCategory: {}, byProduct: {}});
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drawerSku, setDrawerSku] = useState<string | null>(null);

  const allRows = forecast?.rows ?? [];
  const config = forecast?.config;
  const products: IntakeProduct[] = allRows.map((r) => ({product_id: r.product_id, name: r.name, stock: r.stock}));
  const drawerProduct = drawerSku ? products.find((p) => p.product_id === drawerSku) ?? null : null;

  // Recompute surge locally on every plan change for instant feedback.
  const {surge, surgeSummary} = useMemo(() => {
    if (!config) return {surge: new Map(), surgeSummary: null};
    const res = computeSurge(allRows, plan, config);
    return {surge: res.rows, surgeSummary: res.summary};
  }, [allRows, plan, config]);

  const rows = useMemo(
    () =>
      allRows.filter((r) => {
        if (line && (r.category ?? '') !== line) return false;
        if (line === SUBCATEGORY_CATEGORY && sub && (r.subcategory ?? '') !== sub) return false;
        return true;
      }),
    [allRows, line, sub],
  );

  const counts = useMemo(
    () => ({
      healthy: rows.filter((r) => r.status === 'healthy').length,
      low: rows.filter((r) => r.status === 'low').length,
      out: rows.filter((r) => r.status === 'out').length,
    }),
    [rows],
  );

  // Persist a plan change (skips the round-trip in demo mode; the local what-if
  // still updates so the mockup is explorable).
  function commit(next: NextEventPlan) {
    setPlan(next);
    setSaveError(null);
    if (usingMock) return;
    startTransition(async () => {
      const res = await setNextEventPlanAction(next);
      if (!res.ok) setSaveError(res.error);
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Package className="size-3.5" />
            Offline · POS {usingMock && <span className="text-amber-600 dark:text-amber-400">· demo data</span>}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Stock forecast</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Days of cover, projected run-out, and a suggested reorder per SKU — from stock on hand and recent event-day sell-through.
          </p>
        </div>
        {products.length > 0 && <AddStockButton products={products} />}
      </header>

      {scope === 'all' && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <span aria-hidden>🛰️</span>
          <span>
            Showing the real <b className="font-medium text-foreground">Offline</b> forecast. Online (marketplace) inventory isn&apos;t
            tracked yet — switch to the Online tab for its marketplace signals.
          </span>
        </div>
      )}

      {forecast === null || !config ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Stock data is unavailable right now. Try refreshing in a moment.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Next-event surge planner */}
          {surgeSummary && (
            <SurgePlanner
              plan={plan}
              summary={surgeSummary}
              pending={pending}
              saveError={saveError}
              onToggle={(on) => commit({...plan, eventThisWeekend: on})}
              onMultiplier={(m) => commit({...plan, multiplier: m})}
            />
          )}

          {/* Filters */}
          <div className="mb-4 flex flex-col gap-2">
            <PillRow
              label="Line"
              items={[{value: '', label: 'All'}, ...POS_CATEGORIES.map((c) => ({value: c as string, label: c}))]}
              active={line}
              onSelect={(v) => {
                setLine(v);
                if (v !== SUBCATEGORY_CATEGORY) setSub('');
              }}
            />
            {line === SUBCATEGORY_CATEGORY && (
              <PillRow
                label="Type"
                items={[{value: '', label: 'All'}, ...POS_SUBCATEGORIES.map((s) => ({value: s as string, label: s}))]}
                active={sub}
                onSelect={setSub}
              />
            )}
          </div>

          {/* Summary chips */}
          <div className="mb-5 flex flex-wrap gap-3">
            <Chip stripe={STATUS.healthy.stripe} value={counts.healthy} label="Healthy" />
            <Chip stripe={STATUS.low.stripe} value={counts.low} label="Low" />
            <Chip stripe={STATUS.out.stripe} value={counts.out} label="Out" />
          </div>

          {/* Forecast table */}
          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No products match this filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <Th className="text-left">Product</Th>
                        <Th className="text-right">On hand</Th>
                        <Th className="text-right">Sold / day</Th>
                        <Th className="text-right">Cover</Th>
                        <Th className="text-left">Runs out</Th>
                        <Th className="text-right">Reorder</Th>
                        <Th className="text-right">Next event · needs</Th>
                        <Th className="text-left">Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <ForecastRowView
                          key={r.product_id}
                          r={r}
                          surge={surge.get(r.product_id)}
                          onOpenHistory={() => setDrawerSku(r.product_id)}
                          onExpected={(qty) => {
                            const byProduct = {...plan.byProduct};
                            if (qty == null) delete byProduct[r.product_id];
                            else byProduct[r.product_id] = qty;
                            commit({...plan, byProduct});
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3" />
            &ldquo;Cover&rdquo; is in event-days (Fri/Sat/Sun); &ldquo;Runs out&rdquo; snaps to the next event. Threshold {config.threshold}, {config.targetCoverEventDays}
            -event cover, {config.leadTimeDays}-day lead — editable on Products. Click a row for its stock history.
          </p>

          <StockHistoryPanel receipts={receipts} />

          <StockSettingsForm config={config} usingMock={usingMock} />
        </>
      )}

      {drawerProduct && <StockHistoryDrawer product={drawerProduct} receipts={receipts} onClose={() => setDrawerSku(null)} />}
    </div>
  );
}

function SurgePlanner({
  plan,
  summary,
  pending,
  saveError,
  onToggle,
  onMultiplier,
}: {
  plan: NextEventPlan;
  summary: {shortCount: number; restockByLabel: string | null; nextEventLabel: string};
  pending: boolean;
  saveError: string | null;
  onToggle: (on: boolean) => void;
  onMultiplier: (m: number) => void;
}) {
  return (
    <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <TrendingUp className="size-5 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Next event{' '}
              <span className="font-mono text-xs font-normal text-amber-700 dark:text-amber-300">· {summary.nextEventLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground">Will current stock survive the expected surge?</div>
          </div>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={plan.eventThisWeekend}
            onChange={(e) => onToggle(e.target.checked)}
            className="size-4 accent-amber-600"
          />
          Event this weekend
        </label>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Expected volume</span>
          <Stepper
            value={plan.multiplier}
            suffix="×"
            min={1}
            onChange={onMultiplier}
          />
        </div>

        <div className="ml-auto text-sm">
          {summary.shortCount > 0 ? (
            <span>
              <b className="text-red-600 dark:text-red-400">{summary.shortCount} product{summary.shortCount > 1 ? 's' : ''}</b> won&apos;t sustain
              {summary.restockByLabel && (
                <>
                  {' '}· restock by <b>{summary.restockByLabel}</b>
                </>
              )}
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">All products sustain the expected surge ✓</span>
          )}
        </div>
      </div>
      {(pending || saveError) && (
        <div className="mt-2 text-xs">
          {pending && <span className="text-muted-foreground">Saving…</span>}
          {saveError && <span className="text-destructive">{saveError}</span>}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Uncheck if there&apos;s no event this weekend — the forecast rolls to the next one. The multiplier applies to all; edit any product&apos;s
        <b className="font-medium text-foreground"> Next event</b> number to set its own expected units.
      </p>
    </div>
  );
}

function ForecastRowView({
  r,
  surge,
  onExpected,
  onOpenHistory,
}: {
  r: ForecastRow;
  surge: {expected: number; short: number; manual: boolean; sustains: boolean} | undefined;
  onExpected: (qty: number | null) => void;
  onOpenHistory: () => void;
}) {
  const s = STATUS[r.status];
  const COVER_BAR_FULL = 12; // event-days that fill the bar (≈2× the 6-event target)
  const coverPct = r.coverEventDays == null ? 100 : Math.min(100, (r.coverEventDays / COVER_BAR_FULL) * 100);
  return (
    <tr className="border-b last:border-0">
      <Td className="text-left">
        <button type="button" onClick={onOpenHistory} className="text-left transition-colors hover:text-primary" title="View stock history">
          <div className="font-medium">{r.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{r.product_id}</div>
        </button>
      </Td>
      <Td className="text-right tabular-nums">{r.stock}</Td>
      <Td className="text-right tabular-nums text-muted-foreground">{r.soldPerEventDay > 0 ? fmt1(r.soldPerEventDay) : '—'}</Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-2">
          {r.coverEventDays != null && (
            <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block">
              <span className={cn('block h-full rounded-full', s.stripe)} style={{width: `${coverPct}%`}} />
            </span>
          )}
          <span className="tabular-nums font-medium">{r.coverEventDays == null ? '∞' : `${fmt1(r.coverEventDays)} ed`}</span>
        </div>
      </Td>
      <Td className="text-left text-muted-foreground">{r.runsOutLabel}</Td>
      <Td className="text-right">
        {r.reorderQty != null || r.reorderByLabel ? (
          <div>
            <div className="tabular-nums font-medium">{r.reorderQty != null ? r.reorderQty : '—'}</div>
            {r.reorderByLabel && <div className="font-mono text-[10px] text-muted-foreground">{r.reorderByLabel}</div>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td className="text-right">
        <ExpectedCell surge={surge} onExpected={onExpected} />
      </Td>
      <Td className="text-left">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', s.bg, s.text)}>
          <span className={cn('size-1.5 rounded-full', s.dot)} />
          {s.label}
        </span>
      </Td>
    </tr>
  );
}

function ExpectedCell({
  surge,
  onExpected,
}: {
  surge: {expected: number; short: number; manual: boolean; sustains: boolean} | undefined;
  onExpected: (qty: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!surge) return <span className="text-muted-foreground">—</span>;
  const value = draft ?? String(surge.expected);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        aria-label="Expected units at the next event"
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => {
          if (draft == null) return;
          const n = draft === '' ? null : parseInt(draft, 10);
          setDraft(null);
          onExpected(n);
        }}
        className={cn(
          'w-16 rounded-md border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus-visible:border-ring',
          surge.manual && 'border-amber-500 text-amber-700 dark:text-amber-300',
        )}
      />
      <span
        className={cn(
          'font-mono text-[10px]',
          surge.short > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {surge.short > 0 ? `short ${surge.short}` : '✓ sustains'}
        {surge.manual && ' · set'}
      </span>
    </div>
  );
}

function Stepper({value, suffix, min, onChange}: {value: number; suffix?: string; min: number; onChange: (v: number) => void}) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-md border bg-background">
      <button
        type="button"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        −
      </button>
      <span className="min-w-[38px] border-x px-2 py-1 text-center font-mono text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        aria-label="Increase"
        onClick={() => onChange(value + 1)}
        className="px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        +
      </button>
    </span>
  );
}

function Th({children, className}: {children: React.ReactNode; className?: string}) {
  return <th className={cn('px-4 py-3 whitespace-nowrap', className)}>{children}</th>;
}
function Td({children, className}: {children: React.ReactNode; className?: string}) {
  return <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>;
}

function Chip({stripe, value, label}: {stripe: string; value: number; label: string}) {
  return (
    <div className="flex min-w-[112px] flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className={cn('h-8 w-1 rounded-full', stripe)} />
      <div>
        <div className="text-xl font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function PillRow({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: {value: string; label: string}[];
  active: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {items.map((it) => (
        <button
          key={it.value || 'all'}
          type="button"
          onClick={() => onSelect(it.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            active === it.value ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
