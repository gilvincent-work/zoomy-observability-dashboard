## Summary
<!-- What and why, 1-3 lines. Link brief / registry row / issue. -->

| Field | Value |
|---|---|
| Type | feat / fix / refactor / docs / chore / ci / test |
| Domain | e.g. offline-sales, inventory, customers, ask-coop |
| Linked | e.g. `knowledge/product_docs/domain-features/...`, #123 |
| Target branch | `develop` (feature) · `staging` (promotion) · `main` (sign-off only) |

## Changes
<!-- Replace the example rows. -->

| Area | File | What changed |
|---|---|---|
| Page | `app/sales/page.tsx` | Add custom range picker |
| Compute | `src/custom-range.ts` | Clamp range to 366 days |
| Tests | `test/custom-range.test.ts` | Cover clamp |

## How I tested
<!-- Paste real output or screenshots. Mock mode is fine when archive env is unset. -->

| Check | Command / where | Result |
|---|---|---|
| Types | `npm run typecheck` | e.g. 0 errors |
| Unit tests | `npm test` | e.g. 88 passed |
| Browser | `npm run dev` → `/sales` (mock data) | e.g. chart + table render, no console errors |

## Screenshots
<!-- Before / after for UI changes. -->

| Before | After |
|---|---|
| | |

## Checklist
<!-- Mark Done or N/A. -->

| Item | Done | N/A |
|---|:-:|:-:|
| Conventional Commit messages | ☐ | ☐ |
| No secrets, `.env`, lead CSVs, or PII committed (public repo) | ☐ | ☐ |
| `CHANGELOG.md` entry added (the decision, not just the change) | ☐ | ☐ |
| Follows `knowledge/design/style-guide.md` | ☐ | ☐ |
| `DigestDocument` change is additive-only; mirrored with backend; mocks updated | ☐ | ☐ |
| Hand-kept copies updated together (QRR, forecast, repricer labels) | ☐ | ☐ |
| No `pos_*` DDL added here (owned by `zoomy-pos`) | ☐ | ☐ |

## Rollout / risk

| Need | Detail |
|---|---|
| Env vars | e.g. none |
| Manual SQL | e.g. apply `supabase/x.sql` |
| Redeploy | e.g. Vercel redeploy after env change |
| Rollback | e.g. revert commit |
