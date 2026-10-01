import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {buildStaticSystem} from '../src/chat/context';
import {SMALL_SAMPLE_N} from '../src/chat/checks';
import {estimateTokens, renderSkill} from '../src/chat/skills/load';
import {RULES, SKILL_CONSTANTS, SKILL_TOPICS} from '../src/chat/skills/rules';

const SKILL_DIR = path.join(process.cwd(), 'src/chat/skills/ask-coop-data-analyst');
const text = renderSkill();
const tags = [...text.matchAll(/\[([A-Z]+-\d+)( ⚙)?\]/g)].map((m) => ({id: m[1], gear: Boolean(m[2])}));

function fixtureDir(files: {skill: string; topic?: string}): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-'));
  mkdirSync(path.join(dir, 'topics'));
  writeFileSync(path.join(dir, 'SKILL.md'), files.skill);
  for (const t of SKILL_TOPICS) writeFileSync(path.join(dir, 'topics', `${t}.md`), files.topic ?? `# ${t}\n\nPlain.`);
  return dir;
}
const skillWith = (body: string) => `---\nname: ask-coop-data-analyst\ndescription: test\n---\n\n# Title\n\n${body}\n`;

describe('rule ids stay in sync between the text and rules.ts', () => {
  it('every tag in the text exists in RULES', () => {
    const known = new Set(RULES.map((r) => r.id));
    expect(tags.filter((t) => !known.has(t.id)).map((t) => t.id)).toEqual([]);
  });
  it('every RULES id appears exactly once in the text', () => {
    const counts = new Map<string, number>();
    for (const t of tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
    expect(RULES.filter((r) => counts.get(r.id) !== 1).map((r) => r.id)).toEqual([]);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
  it('the gear tag is on exactly the rules enforced in code', () => {
    const byId = new Map(RULES.map((r) => [r.id, r.enforcedBy]));
    expect(tags.filter((t) => t.gear !== (byId.get(t.id) === 'code')).map((t) => t.id)).toEqual([]);
  });
});

describe('placeholders and constants', () => {
  it('leaves no placeholder in the rendered text', () => {
    expect(text).not.toMatch(/\{\{.*?\}\}/);
  });
  it('throws when a placeholder has no constant', () => {
    const dir = fixtureDir({skill: skillWith('Use {{NOPE}} here.')});
    expect(() => renderSkill({dir, constants: {}})).toThrow(/NOPE/);
  });
  it('throws when a constant is never used', () => {
    const dir = fixtureDir({skill: skillWith('No placeholders.')});
    expect(() => renderSkill({dir, constants: {UNUSED: 1}})).toThrow(/UNUSED/);
  });
  it('fills a placeholder from the injected constants', () => {
    const dir = fixtureDir({skill: skillWith('Under {{N}} rows.')});
    expect(renderSkill({dir, constants: {N: 7}})).toContain('Under 7 rows.');
  });
  it('the text carries the code constant in BI-13 and BI-34', () => {
    expect(SKILL_CONSTANTS.SMALL_SAMPLE_N).toBe(SMALL_SAMPLE_N);
    for (const id of ['BI-13', 'BI-34']) {
      const line = text.split('\n').find((l) => l.includes(`[${id} ⚙]`)) ?? '';
      expect(line).toContain(`${SMALL_SAMPLE_N} rows`);
    }
  });
});

describe('size and caching', () => {
  it('fits the token budget (4,500) with a tighter current-size guard (3,500)', () => {
    const tokens = estimateTokens(text);
    console.log(`rendered skill: ${text.length} characters, about ${tokens} tokens`);
    expect(tokens).toBeLessThan(4500);
    expect(tokens).toBeLessThan(3500);
  });
  it('renderSkill is identical across calls', () => {
    expect(renderSkill()).toBe(renderSkill());
  });
  it('buildStaticSystem is byte-identical across calls and carries the whole skill', () => {
    const a = buildStaticSystem();
    expect(buildStaticSystem()).toBe(a);
    expect(a).toContain(text);
    expect(a).toContain('## How you think');
    for (const t of SKILL_TOPICS) expect(a).toContain(`## Topic: ${t} (`);
  });
});

describe('scope: F7 content does not leak in early', () => {
  it.each(['KPI', 'render_chart', 'Save report', 'orientation'])('no "%s" in the rendered skill', (word) => {
    expect(text).not.toContain(word);
  });
});

describe('frontmatter follows the Agent Skills rules', () => {
  const raw = readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? '';
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1].trim() ?? '';
  const description = /^description:\s*(.+)$/m.exec(fm)?.[1].trim() ?? '';
  it('name', () => {
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toMatch(/claude|anthropic/);
  });
  it('description', () => {
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });
  it('the frontmatter is stripped from the prompt text', () => {
    expect(text).not.toMatch(/^---$/m);
    expect(text.split('\n')[0]).toContain(`(${name})`);
  });
});

describe('the two rules that replaced the F5 stopgaps', () => {
  it('ANL-04 (number words) and BI-08 (cut list) are present with their ids', () => {
    expect(text).toMatch(/\[ANL-04\] .*two thirds/);
    expect(text).toMatch(/\[BI-08 ⚙\] When a list is cut .*Showing the first N of M.*among these/);
  });
});

describe('what must never be inside the prompt', () => {
  const text = renderSkill();

  it('contains no production-derived figures (a prompt gets parroted, and the data changes)', () => {
    for (const figure of ['106,950', '147,300', '40,350', '71,050', '18,050', '17,850', '139,360', '32,410', '23.3', '66.4', '16.9', '16.7', '11,822', '99,250']) {
      expect(text, `figure ${figure} must not appear in the skill`).not.toContain(figure);
    }
  });

  it('never has Coop claim an action it cannot take (logged, saved, reported, sent)', () => {
    expect(text).not.toMatch(/\bthe team gets it logged\b|\bI('ve| have) (logged|saved|reported|sent|notified)\b/i);
    expect(text).toMatch(/never say you logged, saved or reported anything/i);
  });
});

describe('every rule enforced by code has a test titled with its id', () => {
  const titles = (): string[] => {
    const src = readFileSync(path.join(process.cwd(), 'test/skill-rules-enforced.test.ts'), 'utf8');
    return [...src.matchAll(/\bit\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  };
  const codeIds = RULES.filter((r) => r.enforcedBy === 'code').map((r) => r.id);

  it('finds a test whose title starts with "<ID>: " for every ⚙ rule, and none for a guide-only rule', () => {
    const t = titles();
    const missing = codeIds.filter((id) => !t.some((title) => title.startsWith(`${id}: `)));
    expect(missing, `⚙ rules without a test: ${missing.join(', ')}`).toEqual([]);
    const guideWithTest = RULES.filter((r) => r.enforcedBy === 'guide' && t.some((title) => title.startsWith(`${r.id}: `))).map((r) => r.id);
    expect(guideWithTest, 'a guide-only rule must not claim a code test').toEqual([]);
  });

  it('the finder really fails when a test title is missing (the gate can fail)', () => {
    const fake = ["BI-02: parts add up", "BI-04: round rows"];
    const missing = codeIds.filter((id) => !fake.some((title) => title.startsWith(`${id}: `)));
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).toContain('BI-01');
  });
});
