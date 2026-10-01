import 'server-only';
import type {DigestArchiveRow} from '../types';
import {pickIndex, fmtRange} from '../week';
import {COOP_CHAT} from './config';
import {buildStaticCatalog} from './preamble';
import {COOP_KNOWLEDGE} from './knowledge';
import {READ_ONLY_STATEMENT} from './read-only-statement';

// Reference facts (brand, glossary, ad products, policies) — appended to every
// prompt. Explicitly framed as background, NOT a source of live figures.
const KNOWLEDGE_BLOCK = [
  '',
  '## Brand knowledge base (reference — NOT live data)',
  'Use this to interpret the numbers and answer brand/definitional questions. Figures still come ONLY from a tool result or the digest; never quote a metric from here.',
  COOP_KNOWLEDGE,
].join('\n');

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

// Home ("getting started") mode: the user hasn't opened a period/channel, so no digest numbers are loaded.
// Offline POS questions still work through the tools.
function homeText(): string {
  return [
    '## Mode: getting started (home screen)',
    'The user is on the Coop home screen and has NOT opened a specific reporting period or channel yet, so no weekly digest is loaded right now. Do NOT cite or invent any Shopee, Lazada or Website figures.',
    'You CAN answer questions about offline POS sales (revenue, orders, products, bundles, payments, pets, events) with your tools. For anything else, orient them and point them to where they can act:',
    '- Open **Sales** to see the unified cross-channel comparison (Shopee · Lazada · Website): revenue, orders, AOV, units, ad spend and ROAS, plus top products and recommended actions.',
    '- Use the **reporting-period picker** in the top bar to choose a timeframe.',
    '- **Marketing** (AI content studio) is coming soon.',
    'If they ask for Shopee, Lazada or Website numbers (e.g. "which channel has the best ROAS?"), tell them to open Sales (or pick a period) where the figures live, and offer to dig into it there. Keep replies warm and brief.',
  ].join('\n');
}

// Degraded mode (the live-data path is not available, e.g. production before the read-only database role is applied):
// no tools are sent and no POS data is read, so Coop answers from the weekly digest only.
const NO_TOOLS_NOTICE =
  'Live offline POS data is not available right now and you have no tools. Answer only from the weekly digest below. If asked about offline POS sales, products, bundles, payments or events, say plainly that this data is not available right now and offer what the digest can answer.';

/**
 * The STATIC, cached part of the system prompt: persona, guardrails, output format, brand knowledge and the metric
 * catalog. Byte-identical on every call (no dates, no digest, no counts) so the prompt cache holds.
 */
export function buildStaticSystem(opts: {tools?: boolean} = {}): string {
  const withTools = opts.tools !== false;
  return [
    `You are ${COOP_CHAT.agentName}, ${COOP_CHAT.persona}`,
    '',
    '## Guardrails',
    COOP_CHAT.guardrails,
    READ_ONLY_STATEMENT,
    `If a request is out of scope, reply exactly: "${COOP_CHAT.refusal}"`,
    '',
    '## Output format',
    COOP_CHAT.output,
    KNOWLEDGE_BLOCK,
    '',
    withTools ? buildStaticCatalog() : NO_TOOLS_NOTICE,
  ].join('\n');
}

/**
 * The per-request digest block: the selected period's full (PII-masked) digest plus compact trend rows for the prior
 * periods, or the home-mode orientation text. `rows` come from getDigests() (already masked).
 */
export function buildDigestBlock(rows: DigestArchiveRow[], week?: string, opts?: {home?: boolean}): string {
  if (opts?.home) return homeText();
  const idx = rows.length ? pickIndex(rows, week) : -1;
  const current = idx >= 0 ? rows[idx] : null;
  const prior = idx >= 0 ? rows.slice(idx + 1, idx + 5) : []; // older periods
  const range = current ? fmtRange(current.window_from, current.window_to, current.digest.window?.label) : 'n/a';

  const lines = [
    `## Selected period: ${range}`,
    'Weekly digest for this period (Shopee, Lazada and Website figures live here; offline POS figures come from tools):',
    '```json',
    current ? JSON.stringify(current.digest) : '{}',
    '```',
  ];
  if (prior.length) {
    lines.push('', '## Prior periods (compact: for trend/comparison questions only)', ...prior.map(trendRow));
  }
  return lines.join('\n');
}

/** The whole prompt as one string (static part, then the digest block). Kept for callers and tests that want one string. */
export function buildCoopSystemPrompt(rows: DigestArchiveRow[], week?: string, opts?: {home?: boolean}): string {
  return `${buildStaticSystem()}\n\n${buildDigestBlock(rows, week, opts)}`;
}
