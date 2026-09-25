'use client';

import {useMemo, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {Gift} from 'lucide-react';
import type {BundleSalesSummary, PetMix, PosEvent, PosOrder, TopProduct} from '@/src/pos-sales-types';
import {bundleSalesSummary, computeKpis, datesInRange, eventDayPacingSeries, eventRevenueSeries, manilaDayKey, paymentBreakdown, petMix, topProducts, type DayPacingSeries} from '@/src/pos-sales-compute';
import {formatPeso, paymentMethodColor, paymentMethodLabel} from '@/src/pos-format';
import {cn} from '@/lib/utils';
import type {SpinLead} from '@/src/spin-leads-types';
import {leadsInDays} from '@/src/spin-leads-types';
import {LeadCapture} from './lead-capture';

const PET_SEGMENTS: {key: keyof PetMix; label: string; color: string}[] = [
  {key: 'dog', label: 'Dog', color: '#3b82f6'},
  {key: 'cat', label: 'Cat', color: '#a855f7'},
  {key: 'both', label: 'Both', color: '#22c55e'},
  {key: 'untagged', label: 'Untagged', color: '#a1a1aa'},
];

/** Format an order instant for the trend axis. Multi-day events get the day too. */
function pointLabel(iso: string, multiDay: boolean): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, multiDay ? {month: 'short', day: 'numeric', hour: 'numeric'} : {hour: 'numeric', minute: '2-digit'});
}

/** "2026-09-15" → "Sep 15" for the day toggle. */
function dayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

// Recharts is code-split: the "Revenue over time" chart lives in
// ./event-analytics-chart and loads as an async chunk, keeping Recharts (~110 kB gz)
// out of this route's initial JS. Height-matched skeleton holds layout (no CLS).
const EventRevenueChart = dynamic(() => import('./event-analytics-chart').then((m) => m.EventRevenueChart), {
  ssr: false,
  loading: () => <div className="h-[210px] w-full animate-pulse rounded-lg bg-muted/40" aria-hidden />,
});

/**
 * The per-event analytics panel: headline KPIs, a cumulative-revenue trend line,
 * a payment split, the pet mix, and top sellers. Pure-helper driven, all scoped
 * to this event's orders (its full lifetime, unfiltered by the home range tabs).
 */
export function EventAnalytics({event, orders, leads}: {event: PosEvent; orders: PosOrder[]; leads: SpinLead[]}) {
  // The event's own days; a toggle scopes every metric to one of them (or all).
  const days = useMemo(() => datesInRange(event.starts_on, event.ends_on), [event.starts_on, event.ends_on]);
  const multiDay = days.length > 1;
  const [day, setDay] = useState<string | null>(null); // null = all days
  const [compare, setCompare] = useState(false); // "compare days" overlay (all-days only)

  // Per-day cumulative pacing (all event orders, aligned by time of day). Only
  // meaningful once two or more days have sales to lay against each other.
  const pacing = useMemo(() => eventDayPacingSeries(orders), [orders]);
  const canCompare = multiDay && pacing.days.length >= 2;
  const showCompare = compare && day === null && canCompare;

  // Everything below reflects the selected day (or the whole event when 'all').
  const scoped = useMemo(
    () => (day ? orders.filter((o) => manilaDayKey(o.created_at) === day) : orders),
    [orders, day],
  );

  // Booth leads follow the same day scope as the sales blocks: one day when a day
  // pill is active, otherwise every day the event ran.
  const scopedLeads = useMemo(
    () => leadsInDays(leads, day ? [day] : days, manilaDayKey),
    [leads, day, days],
  );

  const kpis = useMemo(() => computeKpis(scoped), [scoped]);
  const pay = useMemo(() => paymentBreakdown(scoped), [scoped]);
  const pets = useMemo(() => petMix(scoped), [scoped]);
  const tops = useMemo(() => topProducts(scoped, 5), [scoped]);
  const bundles = useMemo(() => bundleSalesSummary(scoped), [scoped]);
  // When one day is selected the x-axis is intra-day (time only); across all
  // days of a multi-day event it also carries the date.
  const labelWithDay = !day && multiDay;
  const series = useMemo(
    () => eventRevenueSeries(scoped).map((p) => ({label: pointLabel(p.t, labelWithDay), revenue: p.revenue})),
    [scoped, labelWithDay],
  );

  const avgBasket = kpis.orders ? kpis.revenue / kpis.orders : 0;
  const payTotal = pay.reduce((s, p) => s + p.revenue, 0) || 1;
  const petTotal = (pets.dog.revenue + pets.cat.revenue + pets.both.revenue + pets.untagged.revenue) || 1;

  return (
    <div className="flex flex-col gap-6">
      {multiDay && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Day</span>
          <DayPill active={day === null} onClick={() => setDay(null)}>All days</DayPill>
          {days.map((d) => (
            <DayPill key={d} active={day === d} onClick={() => setDay(d)}>{dayShort(d)}</DayPill>
          ))}
        </div>
      )}

      {kpis.orders === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
          {day ? `No sales on ${dayShort(day)}.` : 'No sales tagged to this event yet.'}
        </div>
      ) : (
        <AnalyticsBody
          kpis={kpis}
          avgBasket={avgBasket}
          series={series}
          pacing={pacing}
          showCompare={showCompare}
          canCompare={day === null && canCompare}
          compare={compare}
          onCompareChange={setCompare}
          pay={pay}
          payTotal={payTotal}
          pets={pets}
          petTotal={petTotal}
          tops={tops}
          bundles={bundles}
        />
      )}

      {/* Spin-the-wheel booth leads (spin_wheel_leads — see src/spin-leads.ts). */}
      {scopedLeads.length > 0 && (
        <div className="border-t pt-6">
          <div className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Gift className="size-3.5" /> Lead capture
          </div>
          <LeadCapture leads={scopedLeads} orders={kpis.orders} />
        </div>
      )}
    </div>
  );
}

function DayPill({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'border-transparent bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** "Combined | Compare days" segmented switch for the multi-day revenue chart. */
function CompareToggle({compare, onChange}: {compare: boolean; onChange: (v: boolean) => void}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      <ToggleBtn active={!compare} onClick={() => onChange(false)}>Combined</ToggleBtn>
      <ToggleBtn active={compare} onClick={() => onChange(true)}>Compare days</ToggleBtn>
    </div>
  );
}

function ToggleBtn({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-[5px] px-2.5 py-1 font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

type AnalyticsBodyProps = {
  kpis: {revenue: number; orders: number; units: number; oversells: number};
  avgBasket: number;
  series: {label: string; revenue: number}[];
  pacing: DayPacingSeries;
  showCompare: boolean;
  canCompare: boolean;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  pay: {method: string; revenue: number; orders: number}[];
  payTotal: number;
  pets: PetMix;
  petTotal: number;
  tops: TopProduct[];
  bundles: BundleSalesSummary;
};

function AnalyticsBody({kpis, avgBasket, series, pacing, showCompare, canCompare, compare, onCompareChange, pay, payTotal, pets, petTotal, tops, bundles}: AnalyticsBodyProps) {
  return (
    <div className="flex flex-col gap-7">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={formatPeso(kpis.revenue)} />
        <Stat label="Orders" value={String(kpis.orders)} />
        <Stat label="Units" value={String(kpis.units)} />
        <Stat label="Avg basket" value={formatPeso(avgBasket)} />
      </div>

      {/* Cumulative revenue trend */}
      {series.length >= 2 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue over time</span>
            {canCompare && <CompareToggle compare={compare} onChange={onCompareChange} />}
          </div>
          <EventRevenueChart showCompare={showCompare} pacing={pacing} series={series} />
        </div>
      )}

      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        {/* Payment split */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment split</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {pay.map((p) => (
              <div key={p.method} style={{width: `${(p.revenue / payTotal) * 100}%`, backgroundColor: paymentMethodColor(p.method)}} />
            ))}
          </div>
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {pay.map((p) => (
              <li key={p.method} className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-[3px]" style={{backgroundColor: paymentMethodColor(p.method)}} />
                <span className="text-muted-foreground">{paymentMethodLabel(p.method)}</span>
                <span className="ml-auto tabular-nums">{formatPeso(p.revenue)}</span>
                <span className="w-14 text-right tabular-nums text-muted-foreground">
                  {p.orders} {p.orders === 1 ? 'order' : 'orders'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Pet mix */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pet mix</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {PET_SEGMENTS.map((s) => {
              const rev = pets[s.key].revenue;
              return rev > 0 ? <div key={s.key} style={{width: `${(rev / petTotal) * 100}%`, backgroundColor: s.color}} /> : null;
            })}
          </div>
          <ul className="mt-3.5 grid grid-cols-2 gap-x-8 gap-y-2.5">
            {PET_SEGMENTS.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-[3px]" style={{backgroundColor: s.color}} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto tabular-nums">{formatPeso(pets[s.key].revenue)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Top sellers */}
      {(tops.length > 0 || bundles.bundleRevenue > 0) && (
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top sellers</div>
          <ol className="flex flex-col gap-2.5">
            {tops.map((t, i) => {
              const individual = t.units - t.bundledUnits;
              return (
                <li key={t.product_id ?? `${t.name}-${i}`} className="flex items-start gap-2.5 text-sm">
                  <span className="w-4 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t.name}</span>
                    {t.bundledUnits > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {individual} individual · {t.bundledUnits} bundled
                      </span>
                    )}
                  </span>
                  <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">{t.units} {t.units === 1 ? 'unit' : 'units'}</span>
                  <span className="w-20 pt-0.5 text-right font-medium tabular-nums">{formatPeso(t.revenue)}</span>
                </li>
              );
            })}
          </ol>

          {bundles.bundleRevenue > 0 && (
            <div className="mt-2.5 flex flex-col gap-2.5">
              <div className="h-px w-full bg-border" />
              <div className="flex items-center gap-2.5 text-sm">
                <span className="w-4" />
                <span className="min-w-0 flex-1">
                  Bundle deals
                  <span className="ml-1.5 text-[11px] text-muted-foreground">priced as a set</span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{bundles.bundleOrders} {bundles.bundleOrders === 1 ? 'order' : 'orders'}</span>
                <span className="w-20 text-right font-medium tabular-nums">{formatPeso(bundles.bundleRevenue)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Itemized {formatPeso(bundles.itemizedRevenue)} plus bundles {formatPeso(bundles.bundleRevenue)} is{' '}
                {formatPeso(bundles.totalRevenue)}, matching Revenue above.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border bg-background/60 px-4 py-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-xl font-normal tabular-nums">{value}</div>
    </div>
  );
}
