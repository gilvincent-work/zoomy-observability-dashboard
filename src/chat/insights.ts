// Plain-language insights computed by code from a breakdown (design 4b). Pure. The text is
// pre-formatted: the assistant quotes it and never recomputes a number from it.
import {formatPeso} from '../pos-format';
import type {Insight, InsightsInput} from './result-types';

export const CONCENTRATION_MIN_SHARE = 0.5;
export const CLOSE_VALUES_RATIO = 0.1;

type Format = InsightsInput['format'];

function fmt(n: number, format: Format): string {
  if (format === 'peso') return formatPeso(n);
  if (format === 'percent') return `${n.toFixed(1)}%`;
  return n.toLocaleString('en-US', {maximumFractionDigits: 2});
}

const lead = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Lower-case a plain word label ("Cat" -> "cat"); leave names like "Buy Any 4" alone.
const mid = (s: string): string => (/^[A-Z][a-z]*$/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const pct = (n: number): string => `${n.toFixed(1)}%`;

export function buildInsights(input: InsightsInput): Insight[] {
  const {format, basis} = input;
  const items = input.items.filter((i) => Number.isFinite(i.value) && i.value > 0);
  const total = items.reduce((s, i) => s + i.value, 0);
  const ranked = items.map((it, i) => ({it, i})).sort((a, b) => b.it.value - a.it.value || a.i - b.i).map((x) => x.it);
  const out: Insight[] = [];

  if (ranked.length >= 2) {
    const [top, second] = ranked;
    const share = (top.value / total) * 100;
    const ratio = top.value / second.value;
    out.push({
      code: 'top_contributor',
      text: `${lead(top.label)} accounts for ${pct(share)} of ${basis}, ${ratio.toFixed(1)}× ${mid(second.label)}.`,
      values: {label: top.label, value: top.value, share, ratio, runnerUp: second.label},
    });
  }

  if (ranked.length >= 3) {
    const top = ranked[0];
    if (top.value / total >= CONCENTRATION_MIN_SHARE) {
      out.push({
        code: 'concentration',
        text: `${lead(top.label)} accounts for ${pct((top.value / total) * 100)} of ${basis} (${fmt(top.value, format)} of ${fmt(total, format)}).`,
        values: {label: top.label, value: top.value, total, share: (top.value / total) * 100},
      });
    }
  }

  const m = input.matrix;
  if (m && m.cols.length > 1) {
    m.rows.forEach((row, r) => {
      const vals = m.values[r] ?? [];
      const nonZero = vals.map((v, c) => ({v, c})).filter((x) => Number.isFinite(x.v) && x.v > 0);
      if (nonZero.length === 1) {
        const {v, c} = nonZero[0];
        out.push({
          code: 'single_item_exclusive',
          text: `All of ${mid(row)}'s ${fmt(v, format)} is ${m.cols[c]}.`,
          values: {row, col: m.cols[c], value: v},
        });
      }
    });
  }

  const u = input.untagged;
  if (u && u.value > 0) {
    const share = (u.value / (total + u.value)) * 100;
    const shown = basis.replace(/^tagged\s+/i, '');
    const hasOrders = u.orders != null && u.totalOrders != null;
    out.push({
      code: 'untagged_share',
      text: `${fmt(u.value, format)} (${pct(share)} of ${shown}) has no pet tag${hasOrders ? `; ${(u.orders as number).toLocaleString('en-US')} of ${(u.totalOrders as number).toLocaleString('en-US')} orders are untagged` : ''}.`,
      values: {value: u.value, share, orders: u.orders ?? null, totalOrders: u.totalOrders ?? null},
    });
  }

  if (input.previous) {
    const prev = new Map(input.previous.map((p) => [p.label, p.value]));
    const labels = [...input.items.map((i) => i.label), ...input.previous.map((p) => p.label)];
    const cur = new Map(input.items.map((i) => [i.label, i.value]));
    let best: {label: string; from: number; to: number; delta: number} | null = null;
    for (const label of new Set(labels)) {
      const from = prev.get(label) ?? 0;
      const to = cur.get(label) ?? 0;
      const delta = to - from;
      if (delta !== 0 && (best === null || Math.abs(delta) > Math.abs(best.delta))) best = {label, from, to, delta};
    }
    if (best) {
      const verb = best.delta > 0 ? 'rose' : 'fell';
      out.push({
        code: 'biggest_change',
        text: `${lead(best.label)} ${verb} by ${fmt(Math.abs(best.delta), format)} (from ${fmt(best.from, format)} to ${fmt(best.to, format)}).`,
        values: {label: best.label, previous: best.from, current: best.to, change: best.delta, changePct: best.from === 0 ? null : (best.delta / best.from) * 100},
      });
    }
  }

  if (ranked.length >= 2) {
    const [a, b] = ranked;
    if ((a.value - b.value) / a.value <= CLOSE_VALUES_RATIO) {
      out.push({
        code: 'close_values',
        text: `${lead(a.label)} and ${mid(b.label)} are close (${fmt(a.value, format)} and ${fmt(b.value, format)}).`,
        values: {first: a.label, second: b.label, firstValue: a.value, secondValue: b.value},
      });
    }
  }

  return out;
}
