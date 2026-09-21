'use client';

import {useMemo, useState} from 'react';
import {Check, Copy} from 'lucide-react';
import type {SpinLead} from '@/src/spin-leads-types';
import {prizeTally} from '@/src/spin-leads-types';
import {manilaDayKey} from '@/src/pos-sales-compute';
import {Pagination} from './pagination';
import {cn} from '@/lib/utils';

const PAGE_SIZE = 10;

/** "2026-09-18" → "Sep 18" for the date filter. */
function dayShort(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/** "2026-09-20T21:32:00+08:00" → "Sep 20, 9:32 PM" (Manila). */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

/**
 * Spin-the-wheel leads collected at this event's booth: how many signed up, how
 * many left a number worth texting, and which prizes the wheel actually paid out.
 * Scoped by the day toggle above it, same as every other block on the card.
 */
export function LeadCapture({leads, orders}: {leads: SpinLead[]; orders: number}) {
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);
  const [prize, setPrize] = useState('all');
  const [collectedOn, setCollectedOn] = useState('all');

  const prizes = useMemo(() => prizeTally(leads), [leads]);
  const withMobile = leads.filter((l) => l.mobile).length;
  const top = prizes[0]?.count ?? 1;

  // Every day these leads actually span, newest first — the filter only offers
  // dates that have leads behind them, so it can never select an empty list.
  const days = useMemo(
    () => [...new Set(leads.map((l) => manilaDayKey(l.collectedAt)))].sort().reverse(),
    [leads],
  );

  // The filters scope the contact list (and the copy button with it); the stats
  // and prize bars above stay on the event's totals so the summary holds still
  // while you slice the list underneath it.
  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (prize === 'all' || l.prize === prize) &&
          (collectedOn === 'all' || manilaDayKey(l.collectedAt) === collectedOn),
      ),
    [leads, prize, collectedOn],
  );
  const filtering = prize !== 'all' || collectedOn !== 'all';

  // Clamp rather than reset: a filter change rewinds to page 1 through its own
  // handler, and this keeps the view valid if the list shrinks under it anyway.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const copyEmails = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((l) => l.email).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (no https / denied) — the table is still there to read */
    }
  };

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
        No spin-the-wheel leads captured on these dates.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Leads" value={String(leads.length)} />
        <Stat label="With mobile" value={`${withMobile} of ${leads.length}`} />
        {/* Leads per order: how much of the booth traffic the wheel converted into a contact. */}
        <Stat label="Leads per order" value={orders ? (leads.length / orders).toFixed(2) : '—'} />
      </div>

      <div>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prizes given out</div>
        <ul className="flex flex-col gap-2.5">
          {prizes.map((p) => (
            <li key={p.prize} className="flex items-center gap-3 text-xs">
              <span className="w-32 shrink-0 truncate text-muted-foreground" title={p.prize}>{p.prize}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-[var(--chart-4)]" style={{width: `${(p.count / top) * 100}%`}} />
              </span>
              <span className="w-8 text-right tabular-nums">{p.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contacts
            {filtering && <span className="ml-1.5 font-medium normal-case tracking-normal">{filtered.length} of {leads.length}</span>}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter
              label="Prize"
              value={prize}
              onChange={(v) => { setPrize(v); setPage(1); }}
              options={[{value: 'all', label: 'All prizes'}, ...prizes.map((p) => ({value: p.prize, label: `${p.prize} (${p.count})`}))]}
            />
            {days.length > 1 && (
              <Filter
                label="Collected"
                value={collectedOn}
                onChange={(v) => { setCollectedOn(v); setPage(1); }}
                options={[{value: 'all', label: 'All dates'}, ...days.map((d) => ({value: d, label: dayShort(d)}))]}
              />
            )}
            <button
              type="button"
              onClick={copyEmails}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : `Copy ${filtered.length} email${filtered.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Email</th>
                <th className="px-3 py-2 text-left font-semibold">Mobile</th>
                <th className="px-3 py-2 text-left font-semibold">Prize</th>
                <th className="px-3 py-2 text-right font-semibold">Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={`${l.email}-${l.collectedAt}`} className={cn(i > 0 && 'border-t')}>
                  <td className="max-w-[220px] truncate px-3 py-2" title={l.email}>{l.email}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{l.mobile ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.prize}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{stamp(l.collectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No leads match these filters.</div>
          )}
        </div>
        {filtered.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {start + 1}&ndash;{start + rows.length} of {filtered.length}
            </span>
            <Pagination page={current} pageCount={pageCount} onPage={setPage} label="Contacts pagination" />
          </div>
        )}
      </div>
    </div>
  );
}

/** A labelled native select — no popover library for what is two short lists. */
function Filter({label, value, onChange, options}: {label: string; value: string; onChange: (v: string) => void; options: {value: string; label: string}[]}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground focus-within:text-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter contacts by ${label.toLowerCase()}`}
        className="max-w-[10rem] cursor-pointer truncate bg-transparent pr-1 font-medium text-foreground outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Local copy of the card Stat tile (event-analytics keeps its own private one). */
function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border bg-background/60 px-4 py-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-xl font-normal tabular-nums">{value}</div>
    </div>
  );
}
