// F7: color follows the ENTITY (dog is always the same color), never its rank. Tokens only, never hex: the UI resolves
// them per theme (knowledge/design/style-guide.md). Gray (chart-5) is reserved for "No tag" and "Other". Status colors
// (--status-*) are never returned: they are not part of the ColorToken type. Pure, no server-only.
import type {ColorToken} from './block-types';

export const NEUTRAL: ColorToken = 'chart-5';

/** The categorical palette: four distinct hues, in the style guide's order. */
export const CATEGORICAL: readonly ColorToken[] = ['cat-1', 'cat-2', 'cat-3', 'cat-4'];

/** Used only by assignSeriesColors for the 5th to 7th series (relief channels carry the difference: labels, legend, table). */
export const OVERFLOW: readonly ColorToken[] = ['chart-2', 'chart-3', 'chart-4'];

const NEUTRAL_KEYS = new Set(['no tag', 'untagged', 'other']);

// Known entities. Dog, cat and both get the three distinct categorical tokens. Payment methods and channels reuse the
// tokens (they never share a chart with the pets). qrph shares a token with gcash: assignColors resolves a clash.
const FIXED: Record<string, ColorToken> = {
  dog: 'cat-1', cat: 'cat-2', both: 'cat-3',
  cash: 'cat-1', gcash: 'cat-2', maya: 'cat-3', card: 'cat-4', qrph: 'cat-2',
  website: 'cat-1', shopee: 'cat-2', lazada: 'cat-3', offline: 'cat-4',
};

const norm = (entity: string): string => entity.trim().toLowerCase();

export function isNeutral(entity: string): boolean {
  return NEUTRAL_KEYS.has(norm(entity));
}

/** FNV-1a, 32 bit: deterministic, no dependency. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The preferred token for one entity: fixed table, neutral for "No tag"/"Other", else a stable hash. */
export function colorFor(entity: string): ColorToken {
  const key = norm(entity);
  if (NEUTRAL_KEYS.has(key)) return NEUTRAL;
  return FIXED[key] ?? CATEGORICAL[hash(key) % CATEGORICAL.length];
}

/**
 * Distinct tokens for the entities of ONE chart. Each entity gets its preferred token (colorFor). If two clash, the
 * later one in sorted order takes the next free categorical token; known entities are placed before unknown ones so
 * a hash can never displace dog, cat or both. At most 4 non-neutral entities: a 5th is the caller's job to fold into
 * "Other" (this throws so a bug cannot silently reuse a color).
 */
export function assignColors(entities: string[]): Record<string, ColorToken> {
  const unique = [...new Set(entities)];
  const out: Record<string, ColorToken> = {};
  const solid = unique.filter((e) => !isNeutral(e));
  if (solid.length > CATEGORICAL.length) {
    throw new Error(`At most ${CATEGORICAL.length} distinct colors per chart; fold the rest into "Other" (got ${solid.length}).`);
  }
  for (const e of unique) if (isNeutral(e)) out[e] = NEUTRAL;
  const used = new Set<ColorToken>();
  const known = solid.filter((e) => norm(e) in FIXED).sort();
  const unknown = solid.filter((e) => !(norm(e) in FIXED)).sort();
  for (const e of [...known, ...unknown]) {
    let i = CATEGORICAL.indexOf(colorFor(e));
    while (used.has(CATEGORICAL[i])) i = (i + 1) % CATEGORICAL.length;
    used.add(CATEGORICAL[i]);
    out[e] = CATEGORICAL[i];
  }
  return out;
}

/** Like assignColors, but allows 5 to 7 non-neutral series (the series-count ladder): the extras take OVERFLOW tokens. */
export function assignSeriesColors(entities: string[]): Record<string, ColorToken> {
  const unique = [...new Set(entities)];
  const solid = unique.filter((e) => !isNeutral(e));
  const max = CATEGORICAL.length + OVERFLOW.length;
  if (solid.length > max) throw new Error(`At most ${max} series colors; fold the rest into "Other" (got ${solid.length}).`);
  const head = new Set([...solid.filter((e) => norm(e) in FIXED).sort(), ...solid.filter((e) => !(norm(e) in FIXED)).sort()].slice(0, CATEGORICAL.length));
  const out = assignColors(unique.filter((e) => isNeutral(e) || head.has(e)));
  let next = 0;
  for (const e of [...solid].sort()) if (!head.has(e)) out[e] = OVERFLOW[next++];
  return out;
}
