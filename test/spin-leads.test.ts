import {describe, expect, it} from 'vitest';
import {leadsInDays, prizeTally, type SpinLead} from '../src/spin-leads-types';
import {parsePhTimestamp, parseSpinLeadsCsv} from '../scripts/import-spin-leads.mjs';
import {manilaDayKey} from '../src/pos-sales-compute';

const CSV = `Email,Mobile number,Prize,Event,Collected at (PH time),Consent given at (PH time)
a@x.com,,Zoomy! Bandana,modern-market-sept2026,"Sep 20, 2026, 9:32 PM","Sep 20, 2026, 9:32 PM"
b@x.com,'+639392298037,35% Off,modern-market-sept2026,"Sep 18, 2026, 8:57 AM","Sep 18, 2026, 8:57 AM"
c@x.com,09260385539,35% Off,,"Sep 19, 2026, 1:05 PM",
,09260385539,Poop Bag,modern-market-sept2026,"Sep 19, 2026, 1:05 PM",
d@x.com,09260385539,Poop Bag,modern-market-sept2026,,
`;

/** The import script's rows, shaped the way the app reads them back out of the table. */
function asLeads(): SpinLead[] {
  return parseSpinLeadsCsv(CSV).map((r) => ({
    email: r.email,
    mobile: r.mobile,
    prize: r.prize,
    campaign: r.campaign,
    collectedAt: r.collected_at,
  }));
}

describe('spin-the-wheel CSV import', () => {
  it('reads PH stamps as +08:00, not server-local', () => {
    expect(parsePhTimestamp('Sep 20, 2026, 9:32 PM')).toBe('2026-09-20T21:32:00+08:00');
    expect(parsePhTimestamp('Sep 20, 2026, 12:05 AM')).toBe('2026-09-20T00:05:00+08:00');
    // A late-evening lead still belongs to its Manila day, not the UTC one.
    expect(manilaDayKey(parsePhTimestamp('Sep 20, 2026, 11:40 PM') as string)).toBe('2026-09-20');
    expect(parsePhTimestamp('nope')).toBeNull();
  });

  it('builds table rows, strips the sheet apostrophe, drops unusable ones', () => {
    const rows = parseSpinLeadsCsv(CSV);
    // The row with no email and the one with no collection stamp are dropped.
    expect(rows.map((r) => r.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    expect(rows[1].mobile).toBe('+639392298037');
    expect(rows[0].mobile).toBeNull();
    expect(rows[2].campaign).toBeNull();
    expect(rows[2].consent_at).toBeNull();
    expect(rows[0].consent_at).toBe('2026-09-20T21:32:00+08:00');
  });
});

describe('event card lead helpers', () => {
  it('scopes to event days and tallies prizes', () => {
    const leads = asLeads();
    expect(leadsInDays(leads, ['2026-09-18', '2026-09-19'], manilaDayKey).map((l) => l.email)).toEqual(['b@x.com', 'c@x.com']);
    expect(leadsInDays(leads, [], manilaDayKey)).toEqual([]);
    expect(prizeTally(leads)).toEqual([{prize: '35% Off', count: 2}, {prize: 'Zoomy! Bandana', count: 1}]);
  });
});
