# Release framework

**Branch flow:** `feature → develop → staging → main`
**Rule:** nothing reaches `main` without the owner's sign-off.

## 1. Pick your path

| Path | Use when | Section |
|---|---|---|
| **A. Normal** | Your change ships together with everything else on `develop` | 2 |
| **B. Selective** | Only your change should reach `main`; `staging` holds others' unfinished work | 3 |
| **C. Hotfix** | Urgent fix to what is live on `main` | 4 |

## 2. Path A: normal release

1. **Branch from `develop`.** Use a separate worktree or folder so your main checkout stays clean.
2. **Open a PR to `develop`.**
   - Title: Conventional Commit (`feat(scope): ...`, `fix(scope): ...`).
   - Body: follow the PR template, every section.
   - Draft until checks pass, then mark ready.
   - Add a changelog entry that records the decision, not only the change.
   - State what is **not verified**. "Tests pass" alone is not enough.
3. **Merge to `develop` quickly.** The changelog changes at the top with every merge, so old PRs conflict.
4. **Promote `develop → staging`.** Run a test merge first. PR title: `chore(release): promote develop to staging`. List the PRs included. Merge with a **merge commit**.
5. **Verify on staging** (section 5).
6. **Promote `staging → main`.** PR with owner sign-off, merge commit.
7. **Check the sync:** `main` must not contain anything `develop` lacks.

## 3. Path B: selective release (only your changes to `main`)

**Never branch from `staging`.** It carries every commit `main` lacks, so they would all ship.

1. List your commits from your PR. Skip merge commits.
2. Branch from `main` into a separate worktree.
   - Shortcut: if your feature branch was already cut from `main`, use it as the base.
3. Cherry-pick your commits, oldest first. On a changelog conflict, keep both entries.
4. Check scope: list the files changed against `main`. Only your files may appear.
5. Verify: install, tests, typecheck, build.
6. Open a **draft PR to `main`**. Say it is selective, list your commits, state what is not verified.
7. Prove the change on `staging` first (section 5).
8. Get sign-off, mark ready, merge with a **merge commit**.
9. **Sync back:** open `main → develop`, then `main → staging` (merge commit). This prevents conflicts on the next promotion.
10. Delete the worktree and branch.

## 4. Path C: hotfix

1. Branch from `main`. Make the smallest possible fix, with a test.
2. Draft PR to `main`, owner sign-off, merge commit.
3. **Sync back right away** to `develop` and `staging`.
4. Record a lesson if a process gap caused it.

## 5. Verify on staging (before anything reaches `main`)

| Check | How |
|---|---|
| Deploy | The staging build is green |
| Configuration | Confirm the settings the deploy actually sees, without exposing values |
| Real use | Run one real action in the app and read the result, not only pass or fail |
| Logs | Scan the runtime log for errors in the first minutes |
| Gaps | List anything you could not check in the PR, openly |

## 6. Changes that need database or config changes

1. **Ship it off by default** behind a flag, so merging is safe before setup is done.
2. **Database changes:** apply by hand, staging first, then production by whoever has production access.
3. **Config and secrets:** set per environment. Staging and production never share secrets. Redeploy after every config change.
4. **Make it diagnosable:** expose a reason when a feature is off, and a health check that shows what the deploy sees without showing values.
5. **Rollback:** turn the flag off and redeploy. Revert code only if the code itself is broken.

## 7. Secrets

- Never put secrets in chat, PRs or messaging tools. Only in the secret manager or the config page.
- Never commit environment files, data exports or personal data.
- Generate passwords randomly. Rotate any secret that appeared in a transcript.

## 8. Merge rules

- Promotions use a **merge commit**. Never squash or rebase them: it makes the branches diverge again.
- Changelog conflicts: merge the target into your branch, keep both entries, run the tests, push.
- Delete merged branches and worktrees right away.

## 9. Checklist before merging to `main`

- [ ] Tests, typecheck and build pass
- [ ] Verified on staging
- [ ] Rollback and the not-verified list are written in the PR
- [ ] Database and config steps are listed, and production has its own secrets
- [ ] Owner sign-off
- [ ] Sync-back PRs planned (`main → develop`, `main → staging`)

## 10. Never

- Push to `main` without sign-off.
- Change production before staging.
- Copy staging secrets to production.
- Squash a promotion.
- Run writes against the production database from a local machine.
- Branch from `staging` for a selective release.
