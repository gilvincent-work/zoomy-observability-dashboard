---
name: pr-description
description: Use when opening, writing or editing a pull request in this repo ("open a PR", "PR description", "PR body", "raise a PR"). Fills .github/pull_request_template.md from the real diff and commits, then opens the PR against the right base.
---

# PR description (Coop)

Fill `.github/pull_request_template.md` from **the diff and commits**, not from memory of the conversation.
A hook (`.claude/hooks/pr-description-check.mjs`) blocks `gh pr create` if the body lacks the template sections or the title is not a Conventional Commit.

## Steps

1. **Base branch.** Feature work targets `develop`; promotions go `develop → staging → main`. Never target `main` from a feature branch, and never without sign-off.
2. **Read the change.** `git log --oneline <base>..HEAD`, `git diff --stat <base>..HEAD`, then skim the diff for what commits missed (schema/SQL, env vars, contract shapes, deleted code).
3. **Copy the template** to a scratch file and fill every section. Keep the tables; replace the example rows with real ones.
   - Summary table: type, domain, linked brief/issue, target branch.
   - Changes: one row per area/file touched.
   - How I tested: only checks you actually ran, with real results. Never invent output. If you could not run something, say so in the Result cell.
   - Checklist: tick Done or N/A per row. Do not tick what you did not verify.
   - Rollout / risk: env vars, manual SQL, redeploy, rollback. "None" is a valid answer.
   - Delete unused example rows and the HTML comments.
4. **Title:** Conventional Commit, under 70 chars, e.g. `feat(chat): add health endpoint`.
5. **Open it:** `gh pr create --base develop --title "<title>" --body-file <scratch-file>`. Show the user the title and body first if they asked to review.

## Rules

- No secrets, `.env` values, lead data or PII in the description (the UI repo is public).
- Screenshots table: fill for UI changes, delete for non-UI.
- Do not add an AI signature line to the body.
- Bypass for one command only if the user asks: `PR_CHECK=off`.
