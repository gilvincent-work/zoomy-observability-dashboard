import {describe, expect, it} from 'vitest';
import {CATEGORICAL, NEUTRAL, assignColors, assignSeriesColors, colorFor, isNeutral} from '../src/chat/entity-colors';

const ALLOWED = new Set(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'cat-1', 'cat-2', 'cat-3', 'cat-4']);

describe('entity colors', () => {
  it('dog, cat and both get three distinct categorical tokens', () => {
    const t = ['dog', 'cat', 'both'].map(colorFor);
    expect(new Set(t).size).toBe(3);
    for (const x of t) expect(CATEGORICAL).toContain(x);
  });
  it('is case and spacing insensitive, and the same key always gives the same token', () => {
    expect(colorFor(' Dog ')).toBe(colorFor('dog'));
    expect(colorFor('Birthday Pop-up')).toBe(colorFor('Birthday Pop-up'));
    expect(CATEGORICAL).toContain(colorFor('Birthday Pop-up'));
  });
  it('No tag, Untagged, Other and the id untagged are the neutral gray', () => {
    for (const e of ['No tag', 'Untagged', 'Other', 'untagged', 'other', 'no tag']) {
      expect(colorFor(e)).toBe(NEUTRAL);
      expect(isNeutral(e)).toBe(true);
    }
    expect(NEUTRAL).toBe('chart-5');
    expect(isNeutral('dog')).toBe(false);
  });
  it('covers payment methods and channels with categorical tokens', () => {
    for (const e of ['cash', 'gcash', 'maya', 'card', 'qrph', 'shopee', 'lazada', 'website', 'offline']) expect(CATEGORICAL).toContain(colorFor(e));
  });
  it('never returns a status token or a hex', () => {
    for (const e of ['dog', 'x', 'No tag', 'Error', 'status-crit', 'good', 'a', 'b', 'c']) {
      expect(ALLOWED.has(colorFor(e))).toBe(true);
      expect(colorFor(e)).not.toMatch(/status|#/);
    }
  });
});

describe('assignColors', () => {
  it('colors follow the entity, not the order they are listed in', () => {
    const a = assignColors(['dog', 'cat', 'both', 'untagged']);
    const b = assignColors(['untagged', 'both', 'cat', 'dog']);
    expect(a).toEqual(b);
    expect(a.untagged).toBe('chart-5');
    expect(new Set([a.dog, a.cat, a.both]).size).toBe(3);
  });
  it('keeps tokens distinct inside one chart, and known entities are never displaced by a hashed one', () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    const all = assignColors(names);
    expect(new Set(Object.values(all)).size).toBe(4);
    const withPets = assignColors(['dog', 'cat', 'both', 'Zed']);
    expect(withPets.dog).toBe(colorFor('dog'));
    expect(withPets.cat).toBe(colorFor('cat'));
    expect(withPets.both).toBe(colorFor('both'));
    expect(new Set(Object.values(withPets)).size).toBe(4);
  });
  it('resolves a clash (qrph and gcash) to the next free token', () => {
    const c = assignColors(['gcash', 'qrph']);
    expect(c.gcash).toBe(colorFor('gcash'));
    expect(c.qrph).not.toBe(c.gcash);
  });
  it('allows any number of neutrals next to four colors, and throws on a fifth non-neutral', () => {
    expect(() => assignColors(['dog', 'cat', 'both', 'cash', 'Other', 'No tag'])).not.toThrow();
    expect(() => assignColors(['a', 'b', 'c', 'd', 'e'])).toThrow(/fold the rest into "Other"/);
  });
});

describe('assignSeriesColors', () => {
  it('gives 5 to 7 series distinct tokens, never a status token, and throws past 7', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const c = assignSeriesColors(names);
    expect(new Set(Object.values(c)).size).toBe(7);
    for (const v of Object.values(c)) expect(ALLOWED.has(v)).toBe(true);
    expect(() => assignSeriesColors([...names, 'h'])).toThrow();
  });
});
