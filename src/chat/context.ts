import 'server-only';
import type {DigestArchiveRow} from '../types';
import {pickIndex, fmtRange} from '../week';
import {COOP_CHAT} from './config';

// Compact per-period trend row (numbers only) so Coop can answer "vs last month"
// without stuffing every full digest into context.
function trendRow(row: DigestArchiveRow): string {
  const range = fmtRange(row.window_from, row.window_to, row.digest.window?.label);
  const c = row.digest.comparison || {};
  const fmtCh = (k: 'shopee' | 'lazada' | 'website') => {
    const m = c[k];
    if (!m) return `${k}: n/a`;
    const parts = [
      m.revenue != null && `rev ₱${Math.round(m.revenue)}`,
      m.orders != null && `orders ${m.orders}`,
      m.adSpend != null && `adSpend ₱${Math.round(m.adSpend)}`,
      m.roas != null && `ROAS ${m.roas}×`,
    ].filter(Boolean);
    return `${k}: ${parts.join(', ')}`;
  };
  return `- ${range} — ${(['shopee', 'lazada', 'website'] as const).map(fmtCh).join(' | ')}`;
}

// Home ("getting started") mode: the user hasn't opened a period/channel, so we
// deliberately do NOT load digest numbers. Coop orients them instead.
function buildHomePrompt(): string {
  return [
    `You are ${COOP_CHAT.agentName}, ${COOP_CHAT.persona}`,
    '',
    '## Guardrails',
    COOP_CHAT.guardrails,
    `If a request is out of scope, reply exactly: "${COOP_CHAT.refusal}"`,
    '',
    '## Output format',
    COOP_CHAT.output,
    '',
    '## Mode: getting started (home screen)',
    'The user is on the Coop home screen and has NOT opened a specific reporting period or channel yet, so you do NOT have their store numbers loaded right now. Do NOT cite or invent any specific figures.',
    'Your job here is to orient them — explain what Coop can do and point them to where they can act:',
    '- Open **Sales** to see the unified cross-channel comparison (Shopee · Lazada · Website): revenue, orders, AOV, units, ad spend and ROAS, plus top products and recommended actions.',
    '- Use the **reporting-period picker** in the top bar to choose a timeframe.',
    '- **Marketing** (AI content studio) is coming soon.',
    'If they ask for specific numbers (e.g. "which channel has the best ROAS?"), tell them to open Sales (or pick a period) where the figures live, and offer to dig into it there — never fabricate numbers. Keep replies warm and brief.',
  ].join('\n');
}

/**
 * Build Coop's grounded system prompt: persona + guardrails + the selected
 * period's full (PII-masked) digest, plus compact trend rows for the prior
 * periods. `rows` come from getDigests() (already masked). In `home` mode we
 * return a generic getting-started prompt with no digest data.
 */
export function buildCoopSystemPrompt(rows: DigestArchiveRow[], week?: string, opts?: {home?: boolean}): string {
  if (opts?.home) return buildHomePrompt();
  const idx = rows.length ? pickIndex(rows, week) : -1;
  const current = idx >= 0 ? rows[idx] : null;
  const prior = idx >= 0 ? rows.slice(idx + 1, idx + 5) : []; // older periods
  const range = current ? fmtRange(current.window_from, current.window_to, current.digest.window?.label) : 'n/a';

  const lines = [
    `You are ${COOP_CHAT.agentName}, ${COOP_CHAT.persona}`,
    '',
    '## Guardrails',
    COOP_CHAT.guardrails,
    `If a request is out of scope, reply exactly: "${COOP_CHAT.refusal}"`,
    '',
    '## Output format',
    COOP_CHAT.output,
    '',
    `## Selected period: ${range}`,
    'Full digest for this period (your primary source of truth — all figures live here):',
    '```json',
    current ? JSON.stringify(current.digest) : '{}',
    '```',
  ];

  if (prior.length) {
    lines.push(
      '',
      '## Prior periods (compact — for trend/comparison questions only)',
      ...prior.map(trendRow),
    );
  }
  return lines.join('\n');
}
