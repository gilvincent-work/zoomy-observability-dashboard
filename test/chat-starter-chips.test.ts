import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

// GAP-12 (OD1a, owner rule 1): the owner defines the dates, and live chats carry no period. The starter chips on the empty drawer are
// questions the person did not write, so a chip that names a period ("this week") would put a period in their mouth. Source-level
// check of the SUGGESTIONS and HOME_SUGGESTIONS lists in components/analyst/coop-chat.tsx (the component cannot render in the node
// environment).

const SRC = readFileSync('components/analyst/coop-chat.tsx', 'utf8');
const listOf = (name: string): string[] => {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(SRC);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
};
const PERIOD = /\b(this|last|next|past)\s+(week|month|quarter|year|weekend)\b|\btoday\b|\byesterday\b|\bselected period\b|\b20\d{2}\b/i;

describe('starter chips', () => {
  const live = listOf('SUGGESTIONS');
  const home = listOf('HOME_SUGGESTIONS');

  it('the lists are found and non-trivial (the check is not vacuous)', () => {
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(home.length).toBeGreaterThanOrEqual(3);
  });

  it('the home chips name no period', () => {
    expect(home.filter((c) => PERIOD.test(c))).toEqual([]);
  });

  // DEFECT (GAP-12, reported, product text left as is): the live chip "What should I prioritize this week?" names a period the person
  // never chose. Under owner rule 1 a chip must not. Remove `.fails` when the chip is reworded (for example "What should I prioritize?",
  // which makes Coop ask which dates).
  it('no live chip names a period', () => {
    expect(live.filter((c) => PERIOD.test(c))).toEqual([]);
  });

  it('the period pattern does catch a period (control)', () => {
    expect(PERIOD.test('What should I prioritize this week?')).toBe(true);
    expect(PERIOD.test('Which products are driving revenue?')).toBe(false);
  });
});
