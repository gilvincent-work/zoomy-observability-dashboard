'use client';

import {useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, CalendarDays, ChevronDown, MapPin, Pencil, Plus, Store} from 'lucide-react';
import type {EventRollup, PosOrder} from '@/src/pos-sales-types';
import type {SpinLead} from '@/src/spin-leads-types';
import {formatPeso} from '@/src/pos-format';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Eyebrow, MockNote} from './sections';
import {RefreshControl} from './refresh-control';
import {EventForm} from './event-form';
import {EventAnalytics} from './event-analytics';

/** "2026-09-14" → "Sep 14, 2026". */
function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
}

/** A single day, or "Sep 14 – 16, 2026" for a multi-day run. */
function eventDates(startsOn: string | null, endsOn: string | null): string | null {
  const start = dayLabel(startsOn);
  if (!start) return dayLabel(endsOn);
  if (!endsOn || endsOn === startsOn) return start;
  const end = dayLabel(endsOn);
  return end ? `${start} – ${end}` : start;
}

export function OfflineEventsView({
  rollups,
  orders,
  leads,
  currentEventId,
  usingMock,
  fetchedAt,
}: {
  rollups: EventRollup[];
  orders: PosOrder[];
  leads: SpinLead[];
  currentEventId: string | null;
  usingMock: boolean;
  fetchedAt: string;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Orders bucketed by event, so each card computes its analytics from its own.
  const ordersByEvent = useMemo(() => {
    const m = new Map<string, PosOrder[]>();
    for (const o of orders) {
      if (!o.event_id) continue;
      const arr = m.get(o.event_id) ?? [];
      arr.push(o);
      m.set(o.event_id, arr);
    }
    return m;
  }, [orders]);

  // The live event floats to the top; the rest keep their date order.
  const ordered = useMemo(() => {
    if (!currentEventId) return rollups;
    const current = rollups.filter((r) => r.event.event_id === currentEventId);
    const rest = rollups.filter((r) => r.event.event_id !== currentEventId);
    return [...current, ...rest];
  }, [rollups, currentEventId]);

  // Every event, for the form's live overlap check.
  const allEvents = useMemo(() => rollups.map((r) => r.event), [rollups]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10">
      <Link href="/offline-sales" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Offline Sales
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow icon={CalendarDays}>Events</Eyebrow>
          <p className="text-sm text-muted-foreground">Schedule a bazaar so the POS auto-tags that day&rsquo;s sales. Sales and cash reconcile here.</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshControl fetchedAt={fetchedAt} />
          {!creating && (
            <button
              type="button"
              onClick={() => { setEditingId(null); setCreating(true); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-out active:scale-95"
            >
              <Plus className="size-3.5" /> New event
            </button>
          )}
        </div>
      </div>

      {usingMock && (
        <MockNote>
          Mock events. Set <code>SUPABASE_URL_ARCHIVE</code> / <code>SUPABASE_SERVICE_ROLE_KEY_ARCHIVE</code> to the
          Staging project to load real <code>pos_events</code>.
        </MockNote>
      )}

      {creating && (
        <div className="mb-3">
          <EventForm events={allEvents} onDone={() => setCreating(false)} />
        </div>
      )}

      {rollups.length === 0 && !creating ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No events yet. Use &ldquo;New event&rdquo; to schedule a bazaar with its dates, location, and opening cash. Its
            sales and till reconciliation appear here once the POS runs on those days.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {ordered.map((r) =>
            editingId === r.event.event_id ? (
              <EventForm key={r.event.event_id} initial={r.event} events={allEvents} onDone={() => setEditingId(null)} />
            ) : (
              <EventCard
                key={r.event.event_id}
                rollup={r}
                orders={ordersByEvent.get(r.event.event_id) ?? []}
                leads={leads}
                spotlight={r.event.event_id === currentEventId}
                onEdit={() => { setCreating(false); setEditingId(r.event.event_id); }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({rollup, orders: eventOrders, leads, spotlight, onEdit}: {rollup: EventRollup; orders: PosOrder[]; leads: SpinLead[]; spotlight: boolean; onEdit: () => void}) {
  const {event, revenue, orders, cashSales, expectedCash} = rollup;
  const closed = event.status === 'closed';
  const dates = eventDates(event.starts_on, event.ends_on);
  const place = [event.venue, event.city].filter(Boolean).join(', ');
  // Over/short once the till is counted: counted closing_cash vs expected.
  const variance = closed && event.closing_cash != null && expectedCash != null ? event.closing_cash - expectedCash : null;
  // The live event opens expanded; the rest collapse to the summary + a toggle.
  const [open, setOpen] = useState(spotlight);

  return (
    <Card className={cn(spotlight && 'border-transparent ring-1 ring-[var(--status-good)]/40')}>
      <CardContent className={cn('p-6', spotlight && 'md:p-7')}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">{event.name || 'Untitled event'}</h3>
              {spotlight ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                  style={{backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}}
                >
                  <span className="size-1.5 rounded-full bg-[var(--status-good)]" aria-hidden /> Happening now
                </span>
              ) : (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
                    closed ? 'bg-muted text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300',
                  )}
                  style={closed ? undefined : {backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}}
                >
                  {closed ? 'Closed' : 'Active'}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {dates && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-3.5" /> {dates}
                </span>
              )}
              {place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {place}
                </span>
              )}
              {event.organizer && (
                <span className="inline-flex items-center gap-1">
                  <Store className="size-3.5" /> {event.organizer}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <div className="font-serif text-2xl font-normal leading-tight tracking-tight tabular-nums">{formatPeso(revenue)}</div>
              <div className="text-xs text-muted-foreground">
                {orders} {orders === 1 ? 'order' : 'orders'}
              </div>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Edit ${event.name || 'event'}`}
            >
              <Pencil className="size-3" /> Edit
            </button>
          </div>
        </div>

        {(event.opening_cash != null || cashSales > 0) && (
          <div className="mt-5 rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-xs">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Cash reconciliation</div>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums text-foreground/80">
              <span>Opening {formatPeso(event.opening_cash ?? 0)}</span>
              <span className="text-muted-foreground">+</span>
              <span>cash sales {formatPeso(cashSales)}</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-medium text-foreground">{formatPeso(expectedCash ?? cashSales)} expected in till</span>
            </div>
            {revenue > cashSales && (
              <p className="mt-2 leading-relaxed text-muted-foreground">
                Card &amp; e-wallet sales ({formatPeso(revenue - cashSales)}) settle to their wallets, so they&rsquo;re not
                in the till. Total revenue is {formatPeso(revenue)}.
              </p>
            )}
            {closed && event.closing_cash != null && (
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums text-foreground/80">
                <span>Counted {formatPeso(event.closing_cash)}</span>
                {variance != null && (
                  <span
                    className="font-medium"
                    style={{color: Math.abs(variance) < 0.005 ? 'var(--status-good)' : 'var(--status-warn)'}}
                  >
                    ({variance === 0 ? 'balanced' : `${variance > 0 ? 'over' : 'short'} ${formatPeso(Math.abs(variance))}`})
                  </span>
                )}
              </div>
            )}
            {event.cash_note && <p className="mt-1.5 text-muted-foreground">{event.cash_note}</p>}
          </div>
        )}

        {/* Analytics: expanded for the live event, collapsed-with-toggle for the rest. */}
        <div className="mt-6 border-t pt-6">
          {open && (
            <div className="mb-5">
              <EventAnalytics event={event} orders={eventOrders} leads={leads} />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            {open ? 'Hide analytics' : 'Show analytics'}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
