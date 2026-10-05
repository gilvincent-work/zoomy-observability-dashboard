import {describe, expect, it} from 'vitest';
// @ts-expect-error plain .mjs hook with no type declarations
import {decide} from '../.claude/hooks/pr-description-check.mjs';

const body = '## Summary\n## Changes\n## How I tested\n## Checklist\n## Rollout / risk';
const files: Record<string, string> = {'ok.md': body, 'bad.md': '## Summary only'};
const readFile = (f: string) => files[f] ?? null;

describe('pr-description hook', () => {
  it('ignores other commands', () => expect(decide('git status', {readFile}).allow).toBe(true));
  it('allows a templated body file and a conventional title', () =>
    expect(decide('gh pr create --title "feat(chat): add X" --body-file ok.md', {readFile}).allow).toBe(true));
  it('allows an inline heredoc body that has the sections', () =>
    expect(decide(`gh pr create -t "fix: y" --body "$(cat <<'EOF'\n${body}\nEOF\n)"`, {readFile}).allow).toBe(true));
  it('blocks a body file missing sections', () => {
    const d = decide('gh pr create --title "feat: x" --body-file bad.md', {readFile});
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/Changes/);
  });
  it('blocks --fill and no-body creates', () => {
    expect(decide('gh pr create --fill', {readFile}).allow).toBe(false);
    expect(decide('gh pr create --title "feat: x"', {readFile}).allow).toBe(false);
  });
  it('blocks a non-conventional title', () =>
    expect(decide('gh pr create --title "updated stuff" --body-file ok.md', {readFile}).allow).toBe(false));
  it('lets a title-only edit through and honours the bypass', () => {
    expect(decide('gh pr edit 12 --title "fix: z"', {readFile}).allow).toBe(true);
    expect(decide('gh pr create --fill', {off: true, readFile}).allow).toBe(true);
  });
});
