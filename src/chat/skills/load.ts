// Renders the Ask Coop Data Analyst skill into one system-prompt section (design 4d). Pure Node: no server-only, so
// vitest can import it. Reads the markdown once per process and caches the result.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {SKILL_CONSTANTS, SKILL_TOPICS} from './rules';

const DEFAULT_SKILL_DIR = 'src/chat/skills/ask-coop-data-analyst';
const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;

let cached: string | null = null;

function parseFrontmatter(raw: string): {name: string; description: string; body: string} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error('SKILL.md has no frontmatter');
  const field = (key: string): string => {
    const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    if (!line) throw new Error(`SKILL.md frontmatter is missing "${key}"`);
    return line.slice(key.length + 1).trim();
  };
  return {name: field('name'), description: field('description'), body: m[2]};
}

function fillConstants(text: string, constants: Record<string, number>): string {
  const used = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_all, key: string) => {
    if (!(key in constants)) throw new Error(`Skill placeholder {{${key}}} has no constant`);
    used.add(key);
    return String(constants[key]);
  });
  const unused = Object.keys(constants).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`Skill constants never used in the text: ${unused.join(', ')}`);
  return out;
}

/** Offline token estimate (characters / 3.5), used by the budget test. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * The whole skill as one string: the core, then each topic under a heading in SKILL_TOPICS order. Cached for the
 * default directory; an injected `dir` or `constants` (tests) is always read fresh.
 */
export function renderSkill(opts?: {dir?: string; constants?: Record<string, number>}): string {
  const isDefault = !opts?.dir && !opts?.constants;
  if (isDefault && cached !== null) return cached;
  const dir = opts?.dir ?? path.join(process.cwd(), DEFAULT_SKILL_DIR);
  const {name, description, body} = parseFrontmatter(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  // The name and description live only in the heading line of the rendered text.
  const core = body.trim().replace(/^# (.+)$/m, (_h, title: string) => `# ${title} (${name}): ${description}`);
  const topics = SKILL_TOPICS.map((topic) => {
    const text = readFileSync(path.join(dir, 'topics', `${topic}.md`), 'utf8').trim();
    return text.replace(/^# (.+)$/m, (_h, title: string) => `## Topic: ${topic} (${title})`);
  });
  const rendered = fillConstants([core, ...topics].join('\n\n'), opts?.constants ?? SKILL_CONSTANTS);
  if (isDefault) cached = rendered;
  return rendered;
}
