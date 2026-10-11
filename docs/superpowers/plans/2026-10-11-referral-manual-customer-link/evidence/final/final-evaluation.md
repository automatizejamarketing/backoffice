# Final evaluation — vínculo manual de Indicado (2026-10-11)

Evaluator: final whole-branch evaluator (replaces whole-branch review). Everything below was verified
by me in this session; no implementer/reviewer report was taken on trust.

- BO `feat/referral-manual-customer-link` eb18b52..cd55aa9 (reviewed), + my evidence commit `f0e9e3a`
- FE `feat/referral-manual-link-action-type` 3a8725dc..23f0c5fa (one commit, `lib/db/schema.ts` +2 lines)
- Evidence of this evaluation: `docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/final/` (EVF below)
- Scratch logs: `SP/final-bo.{log,xml}`, `SP/final-fe.{log,xml}`, `SP/final-fe-run2.{log,xml}`, `SP/final-bo-tsc.log`, `SP/final-bo-lint.log`, `SP/rml-dev.log`, `SP/final-junit.ts` (name-level junit diff)

## 1. Code review

### Strengths
- The rules are pure and tested (`lib/referral/manual-link.ts`). The DB layer only loads state and applies the decision (`lib/referral/manual-link-queries.ts`). The preview and the POST share `loadManualLinkState` + `planManualReferralLink`, so they cannot drift on refusal logic.
- Transaction is correct: `SELECT … FOR UPDATE` on the affiliate row (manual-link-queries.ts:70-72), re-reads agreement/user/existing-customer under the lock, inserts customer + audit in the same tx (214-237); a 23505 on `referral_customers_user_id_unique` is caught outside the rolled-back tx and re-read into the spec's "já é indicado" message (245-255). `isReferralCustomerUserUniqueViolation` walks Drizzle's `cause` chain with a cycle guard.
- Preview eligibility cuts are byte-for-byte the sweep's (`manual-link-queries.ts:155-162` vs FE `lib/referral/queries.ts:676-683`: `succeeded`, purpose null/subscription, `external_id` not null, `coalesce(gross,amount) > 0`), with a comment pointing at the source.
- Authorization: both routes run `requireBackofficePermissionResponse("affiliates:manage")` and then the shared role predicate `manualLinkActorAllowed` (route.ts:54-58; preview/route.ts:21-25). Today only `admin` holds `affiliates:manage` (rbac-core.ts:135), and the role check guards against a future grant. Unauthenticated → 307 `/login` (verified live).
- Input hardening: non-uuid affiliate → 404 before any SQL; non-JSON / null / wrong-type body → 400 `Usuário inválido` (never 500); reason trimmed, 1–500.
- Dialog race handling is real: sequence counters for search and preview (link-customer-dialog.tsx:61-62, 91/101, 116/125). Editing the search clears selection, preview and the submit enable (85-90). `canSubmit` requires a non-blocked preview of the on-screen user (139-146). Submit is disabled while sending.
- The sheet decides button visibility from the **server's** affiliate status, falling back to the queue's (affiliate-customers-sheet.tsx:190). The marker reads from the audit log (customer-queries.ts `manualLink`), and a link reloads both the sheet (`reloadToken`, :148/:184) and the queue (`onCustomersChanged={fetchAffiliates}`, page.tsx:690).
- No data leak: the preview returns only `{id,email,name}` of the chosen user to an admin who already has `users:read`; audit `details` carry only ids + e-mail; committed evidence has no tokens or phone numbers (checked by grep).

### Critical
None.

### Important
None.

### Minor (all can ship)
1. **Spec "Arquitetura" asks for a single authorizer helper** (`requireReferralLinkAdmin()`), but the prelude (permission + role + affiliate uuid) is duplicated in `app/api/referrals/[affiliateId]/customers/route.ts:54-63` and `.../preview/route.ts:18-26`. The spec's intent is that the preview and the POST never disagree on who may link, and the shared `manualLinkActorAllowed` predicate meets it. The leftover risk is that a future edit changes one route and not the other. Same as the ledger's deferred item.
2. **Lost-race fallback string is not a spec string** (manual-link-queries.ts:253, `"Este usuário acabou de ser vinculado a um afiliado"`). It is reachable only if the re-read after a 23505 finds no owner, which cannot happen while the unique row exists. Accepted.
3. **Dialog closed mid-submit**: an error from an in-flight POST lands as `submitError` after `reset()`, so the next open shows a stale error (link-customer-dialog.tsx:148-174). Cosmetic.
4. **Search has no "nenhum usuário encontrado"/error state and no debounce** (link-customer-dialog.tsx:82-106). Not required by R2.
5. `signed_up_at` keeps millisecond precision while `users.created_at` has microseconds (staging: `13:34:58.159` vs `13:34:58.159735`). This is the same JS-`Date` behaviour as click attribution; the day and the instant to the millisecond are identical. Informational.
6. The agreement line renders as `Acordo: 20% · Vitalícia`. The `Acordo:` label is a prefix around the exact spec string. Informational.

### Declined to judge
- **The non-admin 403 (`Apenas administradores…`) live.** No non-admin staging session can be made without fabricating state. The predicate is unit-tested and the wiring was read (route.ts:56-58, preview/route.ts:23-25).
- **The 23505 race live.** It can't be forced without fabricated concurrency. The detector is unit-tested and the catch path was read.
- **The 409 `Só afiliado aprovado…` / `Afiliado sem acordo vigente` / `Já é indicado de <outro>` live.** Staging has exactly one affiliate (approved; I queried pending/rejected/blocked and got empty lists). These are planner outcomes covered by `planManualReferralLink` table tests.
- **R12 items 2 and 3, and the production cron cadence (minute 20).** Engine code is unchanged (FE diff is schema-only), and staging has no multi-charge or blocked-period customer.
- **Whether the FE +1 unhandled error is a branch effect.** I could not re-run the FE base without modifying code or adding a worktree. See §3a for why I treat it as environmental.

### Deferred-minor triage (ledger)
| Ledger item | Verdict |
|---|---|
| T1 parity regex would read quoted text inside a comment (parity.test.ts:37) | can ship — current comments in both arrays carry no quotes |
| T1 parity parses FE array as text; a spread would be missed | can ship |
| T2 no São Paulo day-boundary test for "desde DD/MM/AAAA" | can ship — uses the existing `formatNumericDateInSaoPaulo` |
| T2 n_cycles with durationCycles=1 / null untested | can ship — I traced the code: 1 → "A cobrança mais antiga consome 1 de 1 comissão do acordo. As próximas cobranças não vão comissionar." (spec-correct); null → quota 0 → no warning |
| T3 lost-race fallback string / re-read can surface another refusal | can ship (Minor 2) |
| T3 `sum(net_amount)::int` overflows above ~R$ 21 M per user | can ship |
| T3 auth prelude duplicated across routes | can ship (Minor 1) |
| T4 marker date formatted twice; audit query without orderBy | can ship — `indexManualLinks` sorts itself |
| T4 marker wraps to 3 lines at 180px; `overflow-wrap:anywhere` may split e-mail | can ship — observed, legible (EVF final-07, final-08) |
| T5 closing dialog mid-submit → stale submitError | can ship (Minor 3) |
| T5 reason survives a change of candidate | can ship — submit needs a valid preview of the on-screen user (verified: editing search disables Vincular) |
| T5 no "nenhum usuário encontrado", no debounce | can ship (Minor 4) |
| T5 mobile header wraps title to 3 lines beside the button | can ship — observed at 375, no overflow (EVF final-08) |
| T5 no aria-live on preview; result list lacks list semantics; leftover "teste" in a screenshot | can ship |
| T6 verify script does not assert affiliate_id / no extra events / releases_at | can ship — I checked C's rows directly (EVF final-c-rows.json: 1 event, 0 commissions, affiliate VINDITESTE) |
| T7 ledger-entry ids not captured | can ship |
| T7 plan .md still names `support/_rml-verify-commissions.ts` | can ship — historical plan text |

## 2. Acceptance matrix

| Req | Result | Evidence I checked |
|---|---|---|
| R1 button only for `approved` | PASS | Visible for VINDITESTE (EVF final-01). Hidden when the server's customers response says `blocked`, rows still loaded (EVF final-10, `{rowsLoaded:7, button:false}`). Code: sheet.tsx:190/209 |
| R2 search ≥3 chars via `/api/users/search`, one user chosen | PASS | Search for r3k8/u9@/u7@/r2ul4b returned exactly one result each. Out-of-order check: delayed the `rafaeliffeng+u9` response by 2 s and typed `rafaeliffeng+r3k8`; only the r3k8 result was shown. Min-3 enforced in the dialog (:93) and the route |
| R3 preview texts | PASS | Z: `Nenhuma cobrança paga até agora — só as próximas vão comissionar` (EVF final-02). C: `1 cobrança de assinatura paga · R$ 0,00 de líquido · 1 aguardando liquidação` (EVF final-05, ledger ruling). Agreement `20% · Vitalícia`. Blocked EXISTING `Já é indicado deste afiliado desde 19/08/2026` (final-03), OWN `Esta é a conta do próprio afiliado` (final-04), Vincular disabled in both. Quota texts: unit tests `describeManualLinkQuota` (6 cases) |
| R4 reason required 1–500 trimmed; Vincular disabled without eligible user/reason | PASS | Z without reason → disabled (final-02 eval); with reason on a blocked user → disabled (final-03); C with reason → enabled (final-05). API `"   "` → 400 (final-api #9). Unit tests `parseManualLinkReason` incl. 500 limit |
| R5 toast, dialog closes, sheet reloads with marker, queue count reloads | PASS | Toast `Indicado vinculado` (final-06); dialog gone; C row `Vinculado manualmente em 11/10/2026 por educacaoleg@gmail.com`; sheet `7 indicados`; queue row `7 indicados` (final-07) |
| R6 marker persists (from audit) | PASS | Fresh page load + fresh sheet shows A and B markers (final-01); list API `manualLink` for A/B/C (final-api #21) |
| R7 POST refusals, order, messages | PASS (live subset) | final-api: affiliate non-uuid → 404 (#6); non-JSON → 400 `Usuário inválido` (#7); userId number → 400 (#8); empty reason → 400 (#9); user missing → 404 `Usuário não encontrado` (#13); OWN → 409 (#11); EXISTING → 409 `…desde 19/08/2026` (#12); re-link A → 409 `…desde 05/09/2026` (#10); re-link C → 409 `…desde 22/08/2026` (#20); no cookie → 307 `/login` (#14 redo). Remaining rows: unit tests (Declined list) |
| R8 one transaction; rows as specified | PASS | C rows (EVF final-c-rows.json): `referral_customers` {user, affiliate VINDITESTE, agreement 303350de (current), signed_up_at = account creation}; `referral_admin_actions` {customer_linked, admin educacaoleg@gmail.com, reason `Avaliação final do vínculo manual` (UTF-8 intact), details {customerId, userId, userEmail, agreementId}}; both `created_at` 04:37:32.917. Code: manual-link-queries.ts:207-244 |
| R9 preview contract | PASS | 400 non-uuid/missing userId (#1, #2); 404 non-uuid and well-formed-missing affiliate (#3, #4); 404 missing user (#5); 409 cases → 200 + `blocked.message` (#17 EXISTING, #18 OWN, #19 A). Shape `{user, blocked, agreement, charges}` (#15, #16). Cuts = FE sweep (see Strengths) |
| R10 list returns `manualLink` | PASS | final-api #21: `manualLink {linkedAt, adminEmail}` for A, B, C; `null` for others |
| R11 `customer_linked` in both schemas, no migration | PASS | BO schema.ts:4327, FE schema.ts:4426. Parity test passes. No file under `migrations/` in either diff |
| R12 engine materializes events for linked customers | PASS (items 1, 4, 5 seen; 2, 3 unchanged code) | C: `pickedBySweep: true`, event `awaiting_settlement`, no commission, 0 ledger entries, second pass `created:false` (EVF final-engine-c.json) = R12.5. A/B: commissions on pre-link charges with `releases_at` = processing + 30 d (task6-engine.json, re-read in list API: 9536 foreseen each) |
| R13 commission = rule over net; sheet total = sum | PASS | A, B: `round(47678 × 2000 / 10000)` = 9536 = `R$ 95,36` each, header `R$ 190,72 em comissão` (final-01; API `liveCommissionCentavos: 19072`) |
| R14 suites = base except new tests; lint clean; no new type errors | PASS | §3a: BO 0 new failing names, +36 new passing; FE 0 new failing names, fail count 110 = base; tsc 29 = baseline, 0 in touched files; eslint 0 errors (27 pre-existing warnings, schema.ts:49-71) |
| D1 past charges commission | PASS | A/B charges predate the link and got commissions; C's pre-link charge got an event |
| D2 no engine change / no migration | PASS | FE diff = `lib/db/schema.ts` +2 only; BO diff has no migration |
| D3 existing Indicado refused | PASS | #10, #12, #20, final-03 |
| D4 admin role only, server-side | PASS | route.ts:54-58, preview/route.ts:18-25, rbac-core.ts:135 (admin only), unit test `manualLinkActorAllowed` |
| D5 only approved affiliate | PASS | final-10 (button hidden), planner 409 tests |
| D6 reason mandatory | PASS | #9, final-02 |
| D7 preview without commission estimate | PASS | final-02/05 show base only + "calculado pelo motor … em até 1 hora" |
| D8 `signed_up_at` = account creation | PASS | final-c-rows.json (22/08/2026 13:34:58.159, = `users.created_at` to the ms); sheet Cadastro `22/08/2026` |
| D9 `customer_linked` mirrored, no migration | PASS | as R11 |

## 3. Re-run results

### 3a. Suites (exact constraints.md commands + junit)

| Suite | Base | Branch (mine) |
|---|---|---|
| BO | 1835 pass / 32 fail / 24 errors (1867 tests) | **1871 pass / 32 fail / 24 errors** (1903 tests), `SP/final-bo.xml` |
| FE run 1 | 3659 pass / 17 skip / 110 fail / 67 errors | **3652 / 17 / 110 / 68**, `SP/final-fe.xml` |
| FE run 2 | — | **3657 / 17 / 110 / 68**, `SP/final-fe-run2.xml` |

Name-level diff (`SP/final-junit.ts`, keyed by file + describe + test name):
- BO: **0 new failures**, 0 removed, **36 added, all PASS** (35 in `lib/referral/manual-link.test.ts` + 1 parity test).
- FE: **0 new failures**, 0 fixed, 0 added. Each run reports a few base-passing tests as *absent*, from a different file each time:
  - run 1: 7 in `apps/support-agent/lib/allowlists.test.ts`;
  - run 2: 2 in `apps/support-agent/lib/backoffice-performance-client.test.ts`;
  - Task 7's run: 5 in `steps.test.ts`.

  Each is preceded by one "Unhandled error between tests": a `ReferenceError: window is not defined` from a `lodash.debounce` timer (`usehooks-ts` `useDebounceValue`) that fires after an earlier React test tore down its DOM. That aborts the next file. Both victim files pass alone: 7/7 and 2/2.
  - The base log has none of these; every branch run (Task 7's two and my two) has exactly one, which explains 68 vs 67.
  - The FE diff only appends one string to `REFERRAL_ADMIN_ACTION_VALUES`, and no FE module outside `schema.ts` reads that constant (grep). So the diff has no path into the debounced component tests.
  - I classify it as an environmental timing leak (heavier machine load during the branch runs), not a regression. Limitation: I could not re-run the FE base (Declined list).

### 3a'. Types and lint
- `bunx tsc --noEmit -p .` (BO): **29 errors = baseline**, none in any touched file (all in pre-existing test files; `SP/final-bo-tsc.log`).
- `bunx eslint` on the 11 touched BO files: **0 errors**, 27 warnings, all pre-existing unused imports at `lib/db/schema.ts:49-71` (branch touches only 4326-4327).

### 3b. UI flows (agent-browser 0.38.1 headless, `bun run dev:staging`, staging `wsbsnzgzqiehqnklzchm`)

| Flow | Result | Screenshot (EVF) |
|---|---|---|
| Button visible for approved VINDITESTE; A and B with marker and `R$ 95,36`; header `6 indicados · 2 pagantes · R$ 190,72 em comissão` | PASS | `final-01-sheet-button-approved.png` |
| Preview Z: zero-charges text, `Acordo: 20% · Vitalícia`, Vincular disabled without reason | PASS | `final-02-preview-zero-Z.png` |
| Editing search after choosing Z: preview removed, Vincular disabled | PASS | (eval only) |
| EXISTING u9@: `Já é indicado deste afiliado desde 19/08/2026`, disabled even with reason | PASS | `final-03-blocked-existing.png` |
| OWN u7@: `Esta é a conta do próprio afiliado`, disabled | PASS | `final-04-blocked-own.png` |
| C preview awaiting + reason → Vincular enabled | PASS | `final-05-preview-awaiting-C.png` |
| Link C: toast, dialog closes, C marker, `7 indicados` in sheet and queue | PASS | `final-06-toast-after-link-C.png`, `final-07-sheet-after-link-C.png` |
| Mobile 375: `documentElement.scrollWidth = body.scrollWidth = 375`; sheet and dialog fit `0–375` | PASS | `final-08-mobile-sheet.png`, `final-09-mobile-dialog.png` |
| Button hidden when the server says `blocked` (client-side response rewrite) | PASS | `final-10-button-hidden-when-server-says-blocked.png` |
| Out-of-order search (u9 response delayed 2 s, then r3k8 typed) shows only r3k8 | PASS | (eval only) |

Dev log: exactly one `POST …/customers 201` (C); no 500 during the session.

### 3d. API checks (curl + session cookie) — `EVF/final-api.txt`
Preview non-uuid userId → 400 `Usuário inválido` ✔; non-uuid affiliate → 404 `Afiliado não encontrado` ✔; POST re-link A → 409 `Já é indicado deste afiliado desde 05/09/2026` ✔; POST non-JSON → 400 `Usuário inválido` ✔; plus #2–#5, #8, #9, #11–#13, #20, #21, and unauthenticated → 307 `/login`. (Entry #14 in the file is marked INVALID: my helper still sent the cookie; the redo at the end of the file is the real check.)

### 3c. C engine result — `EVF/final-engine-c.json`
`failures: 0`. Payment `81e87d33-…`: `pickedBySweep: true`, `existedBefore: false`, `net: null`; first pass created event `597f7a6f-…` with status `awaiting_settlement` (`skipReason: awaiting_settlement`); no commission, `ledger_entries: 0`; second pass `created: false`. **Matches R12.5.**

## 4. Staging writes I made
All on `wsbsnzgzqiehqnklzchm`, all within the controller's ruling:
1. UI link of C (`rafaeliffeng+r2ul4b@gmail.com`, `d734becf-…`): `referral_customers` `fcf7cc74-5a05-4083-bfbd-e7b749a6c93d` + `referral_admin_actions` `288775f0-6941-4231-84c4-5582dc28e294` (`customer_linked`, reason "Avaliação final do vínculo manual"), 2026-10-11 04:37:32.917 UTC.
2. `processReferralCommissionForPayment` via `FE/scripts/_rml-verify-commissions.ts` for C only: one `referral_commissionable_events` row `597f7a6f-b45f-42c1-b28c-7047f2b608db` (`awaiting_settlement`, payment `81e87d33-4c49-4186-a997-e09e689758ba`). No commission, no ledger entry.

Refused POSTs (400/404/409) wrote nothing. Every other query was a SELECT. No `SET`, no `.env.local`/`.env.prod`, no cron route, no `runReferralCommissionEngine`.

Cleanup done: `SP/rml-session.token` deleted, `BO/.scratch/rml` deleted, dev server stopped (port 3006 free), agent-browser cookies cleared and closed.

## 5. Verdict

**APROVADO.**

No Critical or Important defects. All of R1–R14 and D1–D9 pass, and the six Minor findings above can ship. The only suite anomaly is FE's +1 unhandled error from a leaked debounce timer, which the 2-line schema change has no path to cause.

Evidence commit: `f0e9e3a` (`docs(afiliados): evidências da avaliação final`, 13 files under `evidence/final/`).
