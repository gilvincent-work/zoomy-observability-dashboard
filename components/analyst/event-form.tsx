'use client';

import {useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Check, X} from 'lucide-react';
import type {PosEvent} from '@/src/pos-sales-types';
import {upsertEventAction, type EventInput} from '@/src/pos-events-actions';
import {Card, CardContent} from '@/components/ui/card';

/** Parse an optional peso field: blank -> null, invalid/negative -> error. */
function parseOptionalAmount(v: string): {value: number | null} | {error: string} {
  const t = v.trim();
  if (t === '') return {value: null};
  const n = Number(t.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return {error: 'Enter a valid amount.'};
  return {value: n};
}

const inputCls =
  'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * Coop event scheduler. Create a new bazaar or edit an existing one, writing
 * through upsertEventAction (which enforces the no-overlap rule). Inline card
 * form, matching the daily-target editor's pattern (useTransition + router
 * refresh). `initial` present = edit mode (adds status + closing-cash fields).
 */
export function EventForm({initial, onDone}: {initial?: PosEvent; onDone: () => void}) {
  const editing = Boolean(initial);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [organizer, setOrganizer] = useState(initial?.organizer ?? '');
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? '');
  const [openingCash, setOpeningCash] = useState(initial?.opening_cash != null ? String(initial.opening_cash) : '');
  const [cashNote, setCashNote] = useState(initial?.cash_note ?? '');
  const [closed, setClosed] = useState(initial?.status === 'closed');
  const [closingCash, setClosingCash] = useState(initial?.closing_cash != null ? String(initial.closing_cash) : '');

  function submit() {
    setError(null);
    if (name.trim() === '') {
      setError('Give the event a name.');
      return;
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      setError('The end date is before the start date.');
      return;
    }
    const opening = parseOptionalAmount(openingCash);
    if ('error' in opening) return setError(opening.error);
    const closing = parseOptionalAmount(closingCash);
    if ('error' in closing) return setError(closing.error);

    const input: EventInput = {
      event_id: initial?.event_id,
      name: name.trim(),
      venue,
      city,
      organizer,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      opening_cash: opening.value,
      cash_note: cashNote,
    };
    if (editing) {
      input.status = closed ? 'closed' : 'active';
      input.closing_cash = closing.value;
    }

    startTransition(async () => {
      const res = await upsertEventAction(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-3 text-sm font-semibold tracking-tight">{editing ? 'Edit event' : 'New event'}</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="ev-name">Event name</label>
            <input id="ev-name" className={inputCls} value={name} autoFocus
              onChange={(e) => setName(e.target.value)} placeholder="Pet Bazaar · Weekend 3" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-venue">Venue / mall</label>
            <input id="ev-venue" className={inputCls} value={venue}
              onChange={(e) => setVenue(e.target.value)} placeholder="SM Megamall" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-city">City</label>
            <input id="ev-city" className={inputCls} value={city}
              onChange={(e) => setCity(e.target.value)} placeholder="Mandaluyong" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-org">Organizer <span className="font-normal normal-case text-muted-foreground">optional</span></label>
            <input id="ev-org" className={inputCls} value={organizer}
              onChange={(e) => setOrganizer(e.target.value)} placeholder="Pet Express" />
          </div>
          <div />
          <div>
            <label className={labelCls} htmlFor="ev-start">Start date</label>
            <input id="ev-start" type="date" className={inputCls} value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-end">End date</label>
            <input id="ev-end" type="date" className={inputCls} value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-open">Opening cash float</label>
            <input id="ev-open" type="number" inputMode="decimal" min={0} className={`${inputCls} tabular-nums`}
              value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="2000" />
          </div>
          <div>
            <label className={labelCls} htmlFor="ev-note">Cash note <span className="font-normal normal-case text-muted-foreground">optional</span></label>
            <input id="ev-note" className={inputCls} value={cashNote}
              onChange={(e) => setCashNote(e.target.value)} placeholder="Mostly 20s and 50s" />
          </div>

          {editing && (
            <>
              <div>
                <label className={labelCls} htmlFor="ev-status">Status</label>
                <select id="ev-status" className={inputCls} value={closed ? 'closed' : 'active'}
                  onChange={(e) => setClosed(e.target.value === 'closed')}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="ev-close">Counted at close <span className="font-normal normal-case text-muted-foreground">optional</span></label>
                <input id="ev-close" type="number" inputMode="decimal" min={0} className={`${inputCls} tabular-nums`}
                  value={closingCash} onChange={(e) => setClosingCash(e.target.value)} placeholder="20300" />
              </div>
            </>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={submit} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-out active:scale-95 disabled:opacity-50">
            <Check className="size-3.5" /> {editing ? 'Save changes' : 'Create event'}
          </button>
          <button type="button" onClick={onDone} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-transform duration-150 ease-out hover:text-foreground active:scale-95">
            <X className="size-3.5" /> Cancel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
