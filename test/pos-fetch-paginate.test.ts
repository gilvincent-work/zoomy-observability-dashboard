import {describe, it, expect, vi} from 'vitest';
import {fetchAllRows, POS_PAGE_SIZE, type MakePage} from '../src/pos-fetch-paginate';

/**
 * A fake PostgREST/supabase-js table read that behaves like the real one:
 *  - honors the requested `.range(from, to)` window, AND
 *  - enforces the server's hard row cap (`db.max_rows`) on every response,
 *    returning at most `cap` rows no matter how wide the range asked.
 *
 * The `cap` is what makes an unbounded single read silently truncate — this is
 * the exact behavior the pagination fix defends against.
 */
function makeCappedBackend(rows: Record<string, unknown>[], cap: number) {
  const calls: Array<[number, number]> = [];
  const makePage: MakePage = (from, to) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap);
    return Promise.resolve({data: rows.slice(from, end), error: null});
  };
  return {makePage, calls};
}

const seedRows = (n: number) =>
  Array.from({length: n}, (_, i) => ({id: i + 1, val: `row-${i + 1}`}));

describe('fetchAllRows — POS bulk-read pagination', () => {
  it('returns ALL rows when the table exceeds the server cap (the Units=0 regression)', async () => {
    // Mirrors the prod bug: 1264 pos_order_items rows, PostgREST cap 1000.
    const rows = seedRows(1264);
    const {makePage, calls} = makeCappedBackend(rows, POS_PAGE_SIZE);

    const got = await fetchAllRows('pos_order_items', makePage);

    expect(got).toHaveLength(1264); // not truncated to 1000
    expect(got[0]).toEqual({id: 1, val: 'row-1'});
    expect(got[got.length - 1]).toEqual({id: 1264, val: 'row-1264'});
    // Paged in 1000-row windows: [0..999], [1000..1999] (returns 264 → stop).
    expect(calls).toEqual([
      [0, POS_PAGE_SIZE - 1],
      [POS_PAGE_SIZE, POS_PAGE_SIZE * 2 - 1],
    ]);
  });

  it('demonstrates the truncation a single unbounded read would suffer', async () => {
    // Proves the fake backend actually caps — i.e. the bug is real without paging.
    const rows = seedRows(1264);
    const {makePage} = makeCappedBackend(rows, POS_PAGE_SIZE);
    const oneShot = await makePage(0, Number.MAX_SAFE_INTEGER);
    expect(oneShot.data).toHaveLength(POS_PAGE_SIZE); // 264 rows silently lost
  });

  it('stops after a partial final page', async () => {
    const rows = seedRows(25);
    const {makePage, calls} = makeCappedBackend(rows, 10);
    const got = await fetchAllRows('t', makePage, 10);
    expect(got).toHaveLength(25);
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]]); // last page short → stop
  });

  it('handles a table that is an exact multiple of the page size', async () => {
    const rows = seedRows(20);
    const {makePage, calls} = makeCappedBackend(rows, 10);
    const got = await fetchAllRows('t', makePage, 10);
    expect(got).toHaveLength(20);
    // One extra empty fetch is expected to confirm the end.
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it('returns an empty array for an empty table', async () => {
    const {makePage, calls} = makeCappedBackend([], 10);
    const got = await fetchAllRows('t', makePage, 10);
    expect(got).toEqual([]);
    expect(calls).toEqual([[0, 9]]);
  });

  it('propagates a read error with the label', async () => {
    const makePage: MakePage = vi.fn().mockResolvedValue({
      data: null,
      error: {message: 'permission denied'},
    });
    await expect(fetchAllRows('pos_orders', makePage)).rejects.toThrow(
      'pos_orders read failed: permission denied',
    );
    expect(makePage).toHaveBeenCalledOnce();
  });

  it('treats a null data page as empty (fail-soft)', async () => {
    const makePage: MakePage = vi.fn().mockResolvedValue({data: null, error: null});
    const got = await fetchAllRows('t', makePage, 10);
    expect(got).toEqual([]);
  });
});
