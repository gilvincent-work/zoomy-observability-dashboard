'use client';

import {useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {ArrowLeft, CalendarDays, ChevronDown, MapPin, Pencil, Plus, Search, Store, X} from 'lucide-react';
import type {EventRollup, PosOrder} from '@/src/pos-sales-types';
import type {SpinLead} from '@/src/spin-leads-types';
import {formatPeso} from '@/src/pos-format';
import {
  EVENT_SORT_OPTIONS,
  EVENT_WHEN_FILTERS,
  eventTimeState,
  filterAndSortEvents,
  type EventSort,
  type EventWhen,
} from '@/src/pos-sales-compute';
import {cn} from '@/lib/utils';
import {Card, CardContent} from '@/components/ui/card';
import {Eyebrow, MockNote} from './sections';
import {RefreshControl} from './refresh-control';
import {SegmentedControl} from './segmented-control';
import {Pagination} from './pagination';
import {EventForm} from './event-form';
import {EventAnalytics} from './event-analytics';

const EVENTS_PER_PAGE = 6;

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
  todayKey,
  usingMock,
  fetchedAt,
}: {
  rollups: EventRollup[];
  orders: PosOrder[];
  leads: SpinLead[];
  currentEventId: string | null;
  todayKey: string;
  usingMock: boolean;
  fetchedAt: string;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search + time bucket + sort + page, all client-side (see filterAndSortEvents):
  // the list is modest and each card computes its own analytics, so a server-
  // paginated slice would starve those. Any result-set change snaps back to page 1.
  const [query, setQuery] = useState('');
  const [when, setWhen] = useState<EventWhen>('all');
  const [sort, setSort] = useState<EventSort>('recent');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, when, sort]);

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

  // Every event, for the form's live overlap check.
  const allEvents = useMemo(() => rollups.map((r) => r.event), [rollups]);

  // Filter + sort, then pin the live event to the very top so it stays on page 1.
  const ordered = useMemo(() => {
    const list = filterAndSortEvents(rollups, {query, when, sort}, todayKey);
    if (!currentEventId) return list;
    const idx = list.findIndex((r) => r.event.event_id === currentEventId);
    if (idx <= 0) return list;
    return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
  }, [rollups, query, when, sort, todayKey, currentEventId]);

  const total = rollups.length;
  const matches = ordered.length;
  const pageCount = Math.max(1, Math.ceil(matches / EVENTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageItems = ordered.slice((safePage - 1) * EVENTS_PER_PAGE, safePage * EVENTS_PER_PAGE);
  const filtering = query.trim() !== '' || when !== 'all';

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 md:px-10 max-md:px-4 max-md:py-6">
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

      {total === 0 && !creating ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No events yet. Use &ldquo;New event&rdquo; to schedule a bazaar with its dates, location, and opening cash. Its
            sales and till reconciliation appear here once the POS runs on those days.
          </CardContent>
        </Card>
      ) : (
        <>
          {total > 0 && (
            <EventsToolbar
              query={query}
              onQuery={setQuery}
              when={when}
              onWhen={setWhen}
              sort={sort}
              onSort={setSort}
            />
          )}

          {total > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              {filtering ? `${matches} of ${total} ${total === 1 ? 'event' : 'events'}` : `${total} ${total === 1 ? 'event' : 'events'}`}
            </p>
          )}

          {matches === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                No events match your search.
                <button
                  type="button"
                  onClick={() => { setQuery(''); setWhen('all'); }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-opacity hover:opacity-80"
                >
                  <X className="size-3.5" /> Clear filters
                </button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {pageItems.map((r) =>
                editingId === r.event.event_id ? (
                  <EventForm key={r.event.event_id} initial={r.event} events={allEvents} onDone={() => setEditingId(null)} />
                ) : (
                  <EventCard
                    key={r.event.event_id}
                    rollup={r}
                    orders={ordersByEvent.get(r.event.event_id) ?? []}
                    leads={leads}
                    todayKey={todayKey}
                    spotlight={r.event.event_id === currentEventId}
                    onEdit={() => { setCreating(false); setEditingId(r.event.event_id); }}
                  />
                ),
              )}
            </div>
          )}

          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} className="mt-6" />
        </>
      )}
    </div>
  );
}

/** Search box + When/Sort segmented controls above the event list. */
function EventsToolbar({
  query,
  onQuery,
  when,
  onWhen,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (v: string) => void;
  when: EventWhen;
  onWhen: (v: EventWhen) => void;
  sort: EventSort;
  onSort: (v: EventSort) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search events by name, venue, or city"
          aria-label="Search events"
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground active:scale-95"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <ToolbarGroup label="When">
          <SegmentedControl ariaLabel="Filter by when" options={EVENT_WHEN_FILTERS} value={when} onChange={onWhen} />
        </ToolbarGroup>
        <ToolbarGroup label="Sort">
          <SegmentedControl ariaLabel="Sort events" options={EVENT_SORT_OPTIONS} value={sort} onChange={onSort} />
        </ToolbarGroup>
      </div>
    </div>
  );
}

function ToolbarGroup({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function EventCard({rollup, orders: eventOrders, leads, todayKey, spotlight, onEdit}: {rollup: EventRollup; orders: PosOrder[]; leads: SpinLead[]; todayKey: string; spotlight: boolean; onEdit: () => void}) {
  const {event, revenue, orders, cashSales, expectedCash} = rollup;
  const closed = event.status === 'closed';
  // Status badge is time-derived, not the raw status field: a past bazaar should
  // read "Done", never a misleading "Active". ongoing = happening now, past = done.
  const timeState = eventTimeState(event, todayKey);
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
              {timeState === 'ongoing' ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                  style={{backgroundColor: 'color-mix(in oklab, var(--status-good) 14%, transparent)'}}
                >
                  <span className="size-1.5 rounded-full bg-[var(--status-good)]" aria-hidden /> Happening now
                </span>
              ) : timeState === 'upcoming' ? (
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Upcoming
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Done
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
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="group inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 ease-out hover:border-foreground/25 hover:bg-muted hover:text-foreground active:scale-[0.98]"
            >
              {open ? 'Hide analytics' : 'Show analytics'}
              <ChevronDown className={cn('size-3.5 transition-transform duration-200 ease-out', open && 'rotate-180')} />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
