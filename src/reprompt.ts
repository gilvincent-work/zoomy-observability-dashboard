import type {DigestDocument} from './types';

// MOCK re-synthesis. The real thing runs server-side (never in the browser —
// the Anthropic key stays on the server) and re-runs synthesize() + grounding.
// This simulates the UX client-side so we can design the interaction.
//
// - empty instruction  → "re-run" (fresh identical synthesis)
// - with instruction    → "re-prompt": steer/focus, echoing the instruction
export function mockReprompt(base: DigestDocument, instruction: string): DigestDocument {
  const steer = instruction.trim();
  if (!steer) return {...base};

  const keywords = steer.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const hit = (s: string) => keywords.some((k) => s.toLowerCase().includes(k));
  const focused = base.themes.filter((t) => hit(t.displayName) || hit(t.quote) || hit(t.theme));

  return {
    ...base,
    headline: `Re-prompted — “${steer}”: ${base.headline}`,
    themes: focused.length ? focused : base.themes,
    recommendations: [`Steered by: “${steer}”.`, ...base.recommendations],
  };
}
