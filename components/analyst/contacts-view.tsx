'use client';

// "All contacts": the website CRM, the booth leads and the Lazada export as one
// list, one row per person.
//
// The layout problem is that a merged row hides where it came from, and an
// admin who cannot tell a marketplace buyer from a website account will not
// trust the list. So every row carries source chips, the tiles lead with how
// many people are reachable (the reason to open this page at all), and the
// filters are phrased as outreach questions — which list, and can I actually
// contact them — rather than as database fields.
import {useMemo, useState} from 'react';
import {Globe, Mail, PartyPopper, Phone, ShoppingBag, Users} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {Metric} from './metric';
import {Eyebrow} from './sections';
import {Pagination} from './pagination';
import {RefreshControl} from './refresh-control';
import {
  contactTotals,
  filterContacts,
  EMPTY_CONTACT_FILTER,
  type ContactSource,
  type UnifiedContact,
} from '@/src/contacts-merge';

const PER_PAGE = 25;

const SOURCE_META: Record<ContactSource, {label: string; short: string; className: string}> = {
  website: {
    label: 'Website',
    short: 'Web',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  booth: {
    label: 'Booth',
    short: 'Booth',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  },
  lazada: {
    label: 'Lazada',
    short: 'Lazada',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  },
};

const peso = (n: number) =>
  `₱${Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

function csvCell(v: unknown): string {
  const raw = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-9 rounded-lg border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-primary',
          value === 'all' ? 'border-border' : 'border-primary text-primary',
        )}
      >
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ContactsView({
  contacts,
  fetchedAt,
}: {
  contacts: UnifiedContact[];
  fetchedAt: string;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(EMPTY_CONTACT_FILTER);
  const [page, setPage] = useState(1);

  const totals = useMemo(() => contactTotals(contacts), [contacts]);
  const rows = useMemo(() => filterContacts(contacts, filter, q), [contacts, filter, q]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const shown = rows.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  const set = (next: Partial<typeof filter>) => {
    setFilter({...filter, ...next});
    setPage(1);
  };

  const onExport = () => {
    const csv = [
      ['Name', 'Email', 'Mobile', 'City', 'Lists', 'Orders', 'Spend', 'Tier', 'Event', 'Prize', 'Last seen (PH time)'],
      ...rows.map((c) => [
        c.name ?? '',
        c.email ?? '',
        c.mobile ?? '',
        c.city ?? '',
        c.sources.map((s) => SOURCE_META[s].label).join(' + '),
        c.orders,
        c.spend,
        c.tier ?? '',
        c.campaign ?? '',
        c.prize ?? '',
        fmtDate(c.lastSeen),
      ]),
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-contacts (${rows.length}).csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight">All contacts</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Everyone we hold a contact detail for, across the website, the booth and Lazada. A
            person who appears in more than one list is one row here — matched on email or mobile
            number.
          </p>
        </div>
        <div className="pt-1.5">
          <RefreshControl fetchedAt={fetchedAt} />
        </div>
      </header>

      <section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric icon={Users} label="People" value={totals.contacts.toLocaleString()} sub="After merging duplicates" />
          <Metric icon={Mail} label="Reachable by email" value={totals.withEmail.toLocaleString()} />
          <Metric icon={Phone} label="Reachable by SMS" value={totals.withMobile.toLocaleString()} />
          <Metric
            label="In 2+ lists"
            value={totals.multiSource.toLocaleString()}
            sub="Met us more than one way"
          />
          <Metric icon={Globe} label="Website" value={totals.bySource.website.toLocaleString()} />
          <Metric icon={ShoppingBag} label="Lazada" value={totals.bySource.lazada.toLocaleString()} />
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Eyebrow icon={Users}>Contacts · {rows.length.toLocaleString()}</Eyebrow>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              label="List"
              value={filter.source}
              onChange={(source) => set({source})}
              options={[
                ['all', 'All lists'],
                ['website', 'Website CRM'],
                ['booth', 'Booth leads'],
                ['lazada', 'Lazada'],
                ['multi', 'In 2+ lists'],
              ]}
            />
            <Select
              label="Reachable by"
              value={filter.reachable}
              onChange={(reachable) => set({reachable})}
              options={[
                ['all', 'Anything'],
                ['email', 'Email'],
                ['mobile', 'Mobile'],
                ['both', 'Email + mobile'],
              ]}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, email, mobile or city"
              aria-label="Search contacts"
              className="h-9 w-60 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-primary"
            />
            <button
              type="button"
              onClick={onExport}
              disabled={!rows.length}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing matches those filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Contact</th>
                      <th className="px-4 py-2.5 font-medium">In</th>
                      <th className="px-4 py-2.5 font-medium">City</th>
                      <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                      <th className="px-4 py-2.5 text-right font-medium">Spend</th>
                      <th className="px-4 py-2.5 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id} className="border-b last:border-0 align-top">
                        {/* Name, then the ways to reach them, stacked: one cell
                            answers "who is this and how do I contact them". */}
                        <td className="px-4 py-2.5">
                          {/* A booth lead has no name, so its email becomes the
                              headline — and must not then repeat underneath. */}
                          {(() => {
                            const headline = c.name ?? c.email ?? c.mobile ?? '—';
                            const details = [c.email, c.mobile].filter(
                              (v): v is string => Boolean(v) && v !== headline,
                            );
                            return (
                              <>
                                <div className="font-medium">{headline}</div>
                                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                                  {details.map((d) => (
                                    <span key={d} className="tabular-nums">
                                      {d}
                                    </span>
                                  ))}
                                  {!c.email && !c.mobile && <span>No contact detail</span>}
                                </div>
                              </>
                            );
                          })()}
                          {(c.tier || c.prize) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                              {c.tier && <span className="capitalize">{c.tier} member</span>}
                              {c.prize && <span>Won {c.prize}</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {c.sources.map((s) => (
                              <span
                                key={s}
                                title={SOURCE_META[s].label}
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  SOURCE_META[s].className,
                                )}
                              >
                                {SOURCE_META[s].short}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.city ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.orders || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {c.spend ? peso(c.spend) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(c.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {rows.length ? (safePage - 1) * PER_PAGE + 1 : 0}–
            {Math.min(safePage * PER_PAGE, rows.length)} of {rows.length.toLocaleString()} · newest
            contact first · orders and spend combine every list
          </p>
          <Pagination page={safePage} pageCount={pageCount} onPage={setPage} label="Contact pagination" />
        </div>
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <PartyPopper className="mt-0.5 size-3.5 shrink-0" />
        <span>
          A Lazada buyer has no email in the export — only a phone number — so those rows are
          SMS-only unless the same number turns up on the website or at the booth.
        </span>
      </p>
    </div>
  );
}
