import {describe, expect, it} from 'vitest';
import {fmtRange, hasNoSalesData, periodKind} from '../src/week';
import type {DigestArchiveRow} from '../src/types';

const row = (from: string, to: string, digest: object = {}) =>
  ({window_from: from, window_to: to, created_at: '', digest: {degraded: true, ...digest}}) as unknown as DigestArchiveRow;

describe('fmtRange', () => {
  it('reads PHT days and treats a PHT-midnight end as exclusive', () => {
    expect(fmtRange('2026-09-20T16:00:00+00:00', '2026-09-27T16:00:00+00:00')).toBe('Sep 21 – 27, 2026');
  });
  it('keeps older UTC-midnight windows on the same days', () => {
    expect(fmtRange('2026-08-13T00:00:00+00:00', '2026-09-13T00:00:00+00:00')).toBe('Aug 13 – Sep 13, 2026');
    expect(fmtRange('2026-08-01T00:00:00+00:00', '2026-08-31T00:00:00+00:00')).toBe('Aug 1 – 31, 2026');
  });
  it('leaves date-only (inclusive) ranges alone', () => {
    expect(fmtRange('2026-08-13', '2026-08-28')).toBe('Aug 13 – 28, 2026');
  });
});

describe('hasNoSalesData', () => {
  it('a zero-chat (degraded) week with channel data is not empty', () => {
    expect(hasNoSalesData(row('a', 'b', {shopee: {sales: {}}}))).toBe(false);
    expect(hasNoSalesData(row('a', 'b', {comparison: {website: {}}}))).toBe(false);
  });
  it('no channel data at all is empty', () => {
    expect(hasNoSalesData(row('a', 'b', {sales: null, shopee: null, lazada: null}))).toBe(true);
  });
});

describe('periodKind', () => {
  it('splits by window length', () => {
    expect(periodKind(row('2026-09-20T16:00:00Z', '2026-09-27T16:00:00Z'))).toBe('weekly');
    expect(periodKind(row('2026-08-13T00:00:00Z', '2026-09-13T00:00:00Z'))).toBe('monthly');
  });
});
