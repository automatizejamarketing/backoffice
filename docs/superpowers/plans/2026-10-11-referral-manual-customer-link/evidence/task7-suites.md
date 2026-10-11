# Task 7 — suítes completas, lint e tipos (2026-10-11)

Docker desligado: os testes que usam o Postgres local (porta 55452) falham igual na base e na branch.
Por isso a comparação é pelo **nome** das falhas (junit), não pelos totais.

Base = junit medido antes de qualquer mudança, nas mesmas worktrees. Branch = HEAD das branches
`feat/referral-manual-customer-link` (BO, 74b51a0) e `feat/referral-manual-link-action-type` (FE, 23f0c5fa).

## Rodapés

| Repo | Execução | pass | skip | fail | errors | testes / arquivos |
|---|---|---|---|---|---|---|
| BO | base | 1835 | — | 32 | 24 | 1867 / 252 |
| BO | branch | **1871** | — | 32 | 24 | 1903 / 254 |
| FE | base | 3659 | 17 | 110 | 67 | 3786 / 633 |
| FE | branch (1ª) | 3654 | 17 | 110 | 68 | 3781 / 633 |
| FE | branch (2ª, confirmação) | 3654 | 17 | 110 | 68 | 3781 / 633 |

**BO:** +36 pass = os testes novos, todos passando — 35 em `lib/referral/manual-link.test.ts` e 1 em
`tests/referral-admin-action-parity.test.ts` (diff dos casos do junit: só esses 36 aparecem a mais;
nenhum caso some). 1835 + 36 = 1871.

**FE:** −5 pass, +1 error. Os 5 casos que somem são todos de
`app/app/(main)/marketing/new/wizard/_state/steps.test.ts` ("whatsapp wizard step machine"): o arquivo é
abortado por um `# Unhandled error between tests` — `ReferenceError: window is not defined` disparado por um
timer `lodash.debounce` (de `useDebounceValue(searchTerm, 400)` do `usehooks-ts`, em
`hooks/use-location-search.ts`) que sobra de
`app/app/(main)/marketing/new/components/location-targeting-section.interaction.test.tsx` e dispara depois que
o happy-dom daquele arquivo é liberado. Não é falha nova, é corrida de tempo pré-existente:

- `steps.test.ts` sozinho na branch: **5 pass, 0 fail**.
- Os 4 arquivos vizinhos juntos na branch (`location-targeting-section.interaction.test.tsx`,
  `use-instagram-business-selection.test.tsx`, `resolve-endpoint.test.ts`, `steps.test.ts`), 12 execuções:
  10 com o erro (13 testes), 2 limpas (18 testes) — o resultado varia entre execuções idênticas.
- Nenhum dos 4 arquivos importa `lib/db/schema.ts` (conferido no bundle `bun build` dos quatro: nem
  `REFERRAL_ADMIN_ACTION_VALUES` nem `pgTable` aparecem). A única mudança do FE (23f0c5fa) são 2 linhas nesse
  arquivo, então ela não alcança esse caminho.

## Falhas por nome (`comm` sobre `junit-failures.ts`)

```
$ comm -13 bo-base-fail.txt bo-branch-fail.txt    # falhas NOVAS no BO
(vazio — nenhuma falha nova)
$ comm -23 bo-base-fail.txt bo-branch-fail.txt    # falhas que deixaram de falhar no BO
(vazio)
$ comm -13 fe-base-fail.txt fe-branch-fail.txt    # falhas NOVAS no FE
(vazio — nenhuma falha nova)
$ comm -23 fe-base-fail.txt fe-branch-fail.txt    # falhas que deixaram de falhar no FE
(vazio)
```

BO: 32 nomes únicos na base e na branch. FE: 44 nomes únicos (os 110 `fail` repetem nomes) na base e na
branch. Os 5 casos de `steps.test.ts` não aparecem como falha porque o arquivo abortado nem registra os casos
no junit — ver acima.

## Lint

```
$ cd BO && bunx eslint lib/referral/manual-link.ts lib/referral/manual-link.test.ts lib/referral/manual-link-queries.ts lib/referral/customer-queries.ts "app/api/referrals/[affiliateId]/customers/route.ts" "app/api/referrals/[affiliateId]/customers/preview/route.ts" "app/(admin)/referrals/link-customer-dialog.tsx" "app/(admin)/referrals/affiliate-customers-sheet.tsx" "app/(admin)/referrals/page.tsx" tests/referral-admin-action-parity.test.ts
(sem saída)
eslint-exit 0
```

## Tipos

```
$ cd BO && bunx tsc --noEmit -p . 2>&1 | grep -E "manual-link|customer-queries|referrals/|referral-admin-action-parity|lib/db/schema.ts" ; echo "exit-grep $?"
docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/support/_rml-verify-commissions.ts(44,9): error TS2339: Property 'findPaymentsPendingCommission' does not exist on type 'typeof import("D:/automatize-marketing/.worktrees/referral-manual-link/backoffice/lib/referral/queries")'.
exit-grep 0
```

Nenhum erro nos arquivos de código tocados. A linha casada é do script de apoio da Task 6 (casou pelo caminho
absoluto da worktree, `.../referral-manual-link/...`). Esse script roda **dentro do frontend**
(`scripts/_rml-verify-commissions.ts`) e foi guardado aqui só como evidência; o `tsc` do BO o resolve contra o
BO e dá 4 erros (TS2307 × 3 e TS2339 × 1, linhas 11, 43, 44, 45). Total do `tsc` do BO: 33 erros = 29 da base
(mesmo total medido na Task 1) + 4 desse script. Nenhum código de produção afetado.

```
$ cd FE && bunx tsc --noEmit -p . 2>&1 | grep -E "lib/db/schema.ts" ; echo "exit-grep $?"
exit-grep 1
```

Total do `tsc` do FE: 150 erros, igual à Task 1. `tsconfig.tsbuildinfo` restaurado com `git checkout`.
