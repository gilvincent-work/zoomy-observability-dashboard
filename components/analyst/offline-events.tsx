'use client';

import {useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, CalendarDays, MapPin, Pencil, Plus, Store} from 'lucide-react';
import type {EventRollup} from '@/src/pos-sales-types';
import {formatPeso} from '@/src/pos-format';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Eyebrow, MockNote} from './sections';
import {RefreshControl} from './refresh-control';
import {EventForm} from './event-form';

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

export function OfflineEventsView({rollups, usingMock, fetchedAt}: {rollups: EventRollup[]; usingMock: boolean; fetchedAt: string}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
          <EventForm onDone={() => setCreating(false)} />
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
          {rollups.map((r) =>
            editingId === r.event.event_id ? (
              <EventForm key={r.event.event_id} initial={r.event} onDone={() => setEditingId(null)} />
            ) : (
              <EventCard key={r.event.event_id} rollup={r} onEdit={() => { setCreating(false); setEditingId(r.event.event_id); }} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({rollup, onEdit}: {rollup: EventRollup; onEdit: () => void}) {
  const {event, revenue, orders, cashSales, expectedCash} = rollup;
  const closed = event.status === 'closed';
  const dates = eventDates(event.starts_on, event.ends_on);
  const place = [event.venue, event.city].filter(Boolean).join(', ');
  // Over/short once the till is counted: counted closing_cash vs expected.
  const variance = closed && event.closing_cash != null && expectedCash != null ? event.closing_cash - expectedCash : null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">{event.name || 'Untitled event'}</h3>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
                  closed ? 'bg-muted text-muted-foreground' : 'text-emerald-700 dark:text-emerald-300',
                )}
                style={closed ? undefined : {backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}}
              >
                {closed ? 'Closed' : 'Active'}
              </span>
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
          <div className="mt-4 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-xs">
            <div className="mb-1.5 font-semibold uppercase tracking-wider text-muted-foreground">Cash reconciliation</div>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums text-foreground/80">
              <span>Opening {formatPeso(event.opening_cash ?? 0)}</span>
              <span className="text-muted-foreground">+</span>
              <span>cash sales {formatPeso(cashSales)}</span>
              <span className="text-muted-foreground">=</span>
              <span className="font-medium text-foreground">{formatPeso(expectedCash ?? cashSales)} expected in till</span>
            </div>
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
      </CardContent>
    </Card>
  );
}
