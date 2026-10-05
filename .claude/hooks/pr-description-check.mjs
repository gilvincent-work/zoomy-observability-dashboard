#!/usr/bin/env node
// Claude Code PreToolUse hook (shared via .claude/settings.json): guards `gh pr create` and `gh pr edit --body*`.
// The PR body must follow .github/pull_request_template.md (its section headings), and a given title must be a Conventional Commit.
// It NEVER creates or edits a PR: it only allows or blocks. Bypass for one command: PR_CHECK=off in the environment.
// Any internal error allows the command (fail open).
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const REQUIRED = ['## Summary', '## Changes', '## How I tested', '## Checklist', '## Rollout'];
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|tests|build|ci|chore|revert)(\([^)]+\))?(!)?: \S/;
const HINT = 'Use the pr-description skill: read the diff, fill every section of .github/pull_request_template.md (tables, real rows), then pass it with --body-file.';

/** Pure decision. `readFile` returns a file's text or null, so tests need no disk. */
export function decide(command, {off = false, readFile = () => null} = {}) {
  if (off) return {allow: true};
  const m = /\bgh\s+pr\s+(create|edit)\b/.exec(command);
  if (!m) return {allow: true};
  const rest = command.slice(m.index);
  const file = /--body-file[=\s]+["']?([^\s"']+)/.exec(rest)?.[1];
  const hasBodyFlag = /(--body\b|-b\s|--body-file|--fill)/.test(rest);
  if (m[1] === 'edit' && !hasBodyFlag) return {allow: true}; // title/label-only edit
  if (/--fill/.test(rest) && !file && !/--body\b/.test(rest)) return {allow: false, reason: `--fill gives a commit-log body, not the template. ${HINT}`};
  const body = file === '-' || file === undefined ? rest : (readFile(file) ?? rest);
  const missing = REQUIRED.filter((h) => !body.includes(h));
  if (m[1] === 'create' && !hasBodyFlag) return {allow: false, reason: `No PR body given (it would open an editor or an empty PR). ${HINT}`};
  if (missing.length) return {allow: false, reason: `PR body is missing template sections: ${missing.join(', ')}. ${HINT}`};
  const title = /(?:--title|-t)[=\s]+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(rest);
  const t = title?.[1] ?? title?.[2] ?? title?.[3];
  if (t && !CONVENTIONAL.test(t)) return {allow: false, reason: `PR title must be a Conventional Commit, e.g. "feat(chat): add X". Got: "${t.slice(0, 80)}"`};
  return {allow: true};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input);
    const command = payload?.tool_input?.command;
    if (payload?.tool_name !== 'Bash' || typeof command !== 'string' || !/\bgh\b/.test(command)) process.exit(0);
    const verdict = decide(command, {
      off: process.env.PR_CHECK === 'off',
      readFile: (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null),
    });
    if (!verdict.allow) {
      process.stderr.write(`${verdict.reason}\n`);
      process.exit(2); // exit 2 blocks the tool call and shows this message to Claude
    }
  } catch (e) {
    process.stderr.write(`PR description hook skipped (${e?.message ?? e})\n`); // fail open
  }
  process.exit(0);
}
