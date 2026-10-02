// Sanity checks the registry attaches to every result (design 4c). Pure: no I/O, no clock.
// Facts the model reads instead of guessing; any 'fail' makes the result unreliable.
import {formatPeso} from '../pos-format';
import type {Check, CheckStatus, ChecksInput} from './result-types';

export const SMALL_SAMPLE_N = 30;
export const UNTAGGED_WARN_SHARE = 0.1;
export const SUDDEN_CHANGE_PCT = 50;
export const ROUND_ROW_PAGE = 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (n: number): string => n.toLocaleString('en-US', {maximumFractionDigits: 2});
const cents = (n: number): number => Math.round(n * 100);

function fmt(n: number, format: 'peso' | 'count' | 'percent'): string {
  if (format === 'peso') return formatPeso(n);
  if (format === 'percent') return `${n.toFixed(1)}%`;
  return num(n);
}

function day(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

const ORDER: Record<CheckStatus, number> = {fail: 0, warn: 1, info: 2, ok: 3};

export function runChecks(input: ChecksInput): Check[] {
  const out: Check[] = [];

  for (const r of input.reconcile) {
    const format = r.format ?? 'peso';
    const sum = r.parts.reduce((s, p) => s + p, 0);
    let gap: number;
    let ok: boolean;
    if (format === 'percent') {
      const tol = r.tolerance ?? 0.1;
      gap = Math.abs(sum - r.whole);
      ok = gap <= tol + 1e-9;
    } else {
      const tol = cents(r.tolerance ?? 0);
      const gapC = Math.abs(r.parts.reduce((s, p) => s + cents(p), 0) - cents(r.whole));
      gap = gapC / 100;
      ok = gapC <= tol;
    }
    out.push({
      code: 'reconciles',
      status: ok ? 'ok' : 'fail',
      text: ok
        ? `${r.label}: the parts add up to ${fmt(r.whole, format)}.`
        : `${r.label}: the parts add up to ${fmt(sum, format)} but the total is ${fmt(r.whole, format)} (gap ${fmt(gap, format)}).`,
      values: {label: r.label, parts: sum, whole: r.whole, gap},
    });
  }

  for (const b of input.bulkReads) {
    if (b.rows >= ROUND_ROW_PAGE && b.rows % ROUND_ROW_PAGE === 0) {
      out.push({
        code: 'round_row_count',
        status: 'info',
        text: `${b.relation}: exactly ${num(b.rows)} rows came back; paged, but verify.`,
        values: {relation: b.relation, rows: b.rows},
      });
    }
  }

  if (input.zeroValueLines && input.zeroValueLines.count > 0 && input.zeroValueLines.allocatedMeasureUsed) {
    const n = input.zeroValueLines.count;
    out.push({
      code: 'zero_value_lines',
      status: 'info',
      text: `${num(n)} bundle pick lines carry ₱0; allocated pesos used.`,
      values: {count: n},
    });
  }

  if (input.priceChanges && input.priceChanges.count > 0) {
    const {count, spanDays} = input.priceChanges;
    out.push({
      code: 'price_changed_in_period',
      status: 'info',
      text: `${num(count)} list-price ${count === 1 ? 'change' : 'changes'} in ${num(spanDays)} ${spanDays === 1 ? 'day' : 'days'}; each sale valued at its sale-date price.`,
      values: {count, spanDays},
    });
  }

  if (input.sampleSize != null && input.sampleSize < SMALL_SAMPLE_N) {
    out.push({
      code: 'small_sample',
      status: 'warn',
      text: `Only ${num(input.sampleSize)} ${input.sampleSize === 1 ? 'order' : 'orders'} in this slice.`,
      values: {sampleSize: input.sampleSize, threshold: SMALL_SAMPLE_N},
    });
  }

  if (input.untagged && input.untagged.totalOrders > 0) {
    const {orders, totalOrders} = input.untagged;
    const share = orders / totalOrders;
    if (share > UNTAGGED_WARN_SHARE) {
      out.push({
        code: 'untagged_share',
        status: 'warn',
        text: `${Math.round(share * 100)}% of orders (${num(orders)} of ${num(totalOrders)}) have no pet tag.`,
        values: {orders, totalOrders, share: share * 100},
      });
    }
  }

  const {from, to, dataFrom, dataTo} = input.coverage;
  let coverageText: string | null = null;
  if (dataFrom == null || dataTo == null) coverageText = 'There is no data yet.';
  else if (to < dataFrom || from > dataTo) coverageText = `There is no data in that range. Data covers ${day(dataFrom)} to ${day(dataTo)}.`;
  else if (from < dataFrom || to > dataTo) coverageText = `Data covers ${day(dataFrom)} to ${day(dataTo)} only.`;
  if (coverageText) {
    out.push({code: 'partial_coverage', status: 'warn', text: coverageText, values: {from, to, dataFrom, dataTo}});
  }

  if (input.change) {
    const {previous, current} = input.change;
    const pct = (Math.abs(current - previous) / Math.max(previous, 1)) * 100;
    if (previous < SMALL_SAMPLE_N && pct > SUDDEN_CHANGE_PCT) {
      out.push({
        code: 'sudden_change',
        status: 'warn',
        text: `Count ${current > previous ? 'rose' : 'fell'} from ${num(previous)} to ${num(current)} against the previous period.`,
        values: {previous, current, changePct: pct},
      });
    }
  }

  if (input.mockSource) out.push({code: 'mock_source', status: 'fail', text: 'This is sample data.', values: {}});

  return out
    .map((c, i) => ({c, i}))
    .sort((a, b) => ORDER[a.c.status] - ORDER[b.c.status] || a.c.code.localeCompare(b.c.code) || a.i - b.i)
    .map((x) => x.c);
}
