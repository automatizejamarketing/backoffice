
## Residual round 1 — Important I1

Base: `c13ab1efe4446ee1ab9f04998351161aa822bc3d`.
Commit: `e75828ea34579d64c5dc9a0d2877d7ff4fc80ca7` on `feat/backoffice-audiences`.
Status: DONE for the assigned residual; independent final evaluation remains pending.

Only production change: `app/(admin)/marketing/ai/ai-advanced-audience-sheet.tsx:54`, `z-50` → `z-[50]`. Both Tailwind classes produce z-index50. The existing layering extractor accepts explicit numeric arbitrary syntax; retaining this syntax restores its checks while preserving the tested local sheet/portal order. No tests, global UI primitives, callbacks, auth/backend, frontend or other product files changed.

Exact RED/GREEN command from backoffice root, with explicit `FRONTEND_ROOT=D:/automatize-marketing/.worktrees/backoffice-audiences/automatize-frontend`, `BACKOFFICE_ROOT=D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice`, and `POSTGRES_URL=postgres://postgres:referral@127.0.0.1:55452/referral_test`:

```powershell
bun test tests/review-sheet-stacking.test.ts tests/audience-library-manager.test.ts tests/ai-audience-inclusions.test.ts tests/ai-audience-exclusions.test.ts
```

- Before fix: 18 pass / 2 fail, 20 tests across4files, exit1. Failing names: `o wrapper dos overlays Radix fica acima dos sheets de revisão, com !important`; `o PopoverContent fica acima dos sheets de revisão e recebe cliques`. Full output: `final-fix-red.log`; exact exit: `final-fix-red.exit`.
- After fix: 20 pass / 0 fail, 20 tests across4files, exit0. Both unchanged stacking contracts pass. Full output: `final-fix-green.log`; exact exit: `final-fix-green.exit`.
- `git diff --check`: empty output, exit0 (`final-fix-diff-check.log`, `final-fix-diff-check.exit`).
- Self-review: staged diff is exactly one equivalent Tailwind class replacement, one insertion/one deletion, only the owned production file. No skip/weaken/remove test, no alteration of stacking semantics, no unexpected working-tree change.
- TSC was not repeated for this CSS-class-only change, as explicitly directed. Browser/full-suite replay is reserved for the sole final evaluator on corrected HEAD; no duplicate browser was started and the controller-owned stopped server was untouched.
- Commit contains only the production file. Ignored report/logs remain under `.superpowers/sdd/2026-10-05-backoffice-meta-audiences/`. No push/PR/merge was performed by this worker.
