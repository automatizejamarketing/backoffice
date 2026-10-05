# Meta audience verification evidence

These screenshots exercise the real local Backoffice UI with deterministic browser API fixtures. They contain synthetic customers and accounts (`fixture-user`, `111`, `222`). No live Meta or shared-database mutation was performed. Fixture success does not prove production Meta permissions, CSV parsing/hashing, durable imports or publication.

## Reproduce the product checks

From the Backoffice feature worktree, with Bun 1.3.4 and the paired Frontend checkout:

```powershell
$env:POSTGRES_URL = 'postgres://postgres:referral@127.0.0.1:55452/referral_test'
$env:FRONTEND_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/automatize-frontend'
$env:BACKOFFICE_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice'
bun test --timeout 30000
bunx tsc --noEmit -p .
bun docs/superpowers/plans/2026-10-05-backoffice-meta-audiences/evidence/browser-support/verify-fixtures.mjs
```

Run the first two commands again from the paired Frontend root. The disconnected local PostgreSQL address makes database tests reproducible without touching staging. The prepared main baseline already has test and TypeScript failures; compare named failures and diagnostics, not just exit codes.

## Browser fixture boundary

Run the app locally and use an authenticated, task-owned agent-browser session. Verification used agent-browser 0.38.1, installed Chromium 149 and `http://127.0.0.1:3016`. Pass the same `--session`, `--executable-path`, `--init-script` and `--allowed-domains 127.0.0.1` options on **every** invocation. Use the native Windows agent-browser executable; its npm PowerShell wrapper does not forward stdin to `eval --stdin`.

The init script is `browser-support/audiences.init.js`; the upload sample is `browser-support/customers.csv`. Before opening a protected page, additionally install abort rules for `**/api/meta-marketing/**`, `**/api/meta-marketing`, `**/api/users/**`, `**/api/upload**` and `**/api/geo/**`. Before any mutation, evaluate `({version: window.__audienceFixture?.version, userId: window.__audienceFixture?.userId, accounts: window.__audienceFixture?.accounts})` and require version string `"1"`, user `fixture-user` and accounts 111/222. `inspect()` returns the catalogs, history, configuration and sanitized request log separately. Unknown API paths/actions and campaign publication fail closed. These browser guards do not intercept server-component requests.

Entry paths:

- `/marketing?userId=fixture-user&accountId=222`: click the actual Públicos button.
- `/marketing/audiences?userId=fixture-user&accountId=222`: standalone library.
- `/embed/marketing/audiences?userId=fixture-user&accountId=222`: direct embedded entry.
- `/embed/marketing/ai?userId=fixture-user&accountId=222`: proceed through objective, proven ad, budget and synthetic Instagram post to review; open advanced audience settings, then Públicos da conta.

`window.__audienceFixture.configure({scenario: 'reconcile'})` changes subsequent API responses; use real refresh/retry controls. Supported scenarios include `default`, `accounts-empty`, `accounts-error`, `library-empty`, `library-error`, `sources-empty`, `slow`, `confirm-error`, `reconcile`, `terms-pending`, and `import-disabled`. Full navigation resets fixture state. The fixture log records sanitized method/path/query/action/status and is the authoritative mock-request evidence; intercepted fetches do not appear in the browser network list.

Account-scoped catalogs support pagination, rule review/confirm/reconciliation, dependency-aware deletion, customer mapping/preview/terms/history and the minimal marketing/AI reads needed to reach review. CSV previews are fixed synthetic counts: 3 read, 2 valid, 1 invalid. Customer `manageMembers: available` is a synthetic coverage state; the existing real reader returns unknown capability and the UI preserves that restriction.

## Evidence limits

Embedded screenshots demonstrate the actual embedded route and AI sheet. The exact embedded client-hub click requires a server-side UUID customer profile that browser fixtures cannot supply; URL construction/component contracts cover that link. The local server used the existing allowlisted-admin recovery path with an unavailable local database, so database-backed admin lookup is not proved. Chromium 153 compatibility is not proved by these Chromium 149 runs. Diagnostic RED captures are retained locally and do not count as final acceptance evidence.

The [delivery report](../delivery.md) maps the implementation to the approved spec and includes exact validation commands, test results, known limits and all 20 execution rulings. The [independent final evaluation](../final-evaluation.md) records **APROVADO**, R1–R10 PASS and its own browser screenshots/probes. Full suites and TypeScript are not green; their baseline comparisons and the two additional unchanged-Frontend subprocess timeouts are disclosed in both reports. The inherited AI Sheet close-to-BODY focus behavior remains an explicit nonblocking Minor.
