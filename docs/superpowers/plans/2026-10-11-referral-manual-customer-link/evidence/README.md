# Evidências — vínculo manual de Indicado (2026-10-11)

Spec: `docs/superpowers/specs/2026-10-11-referral-manual-customer-link-design.md`.
Plano: `docs/superpowers/plans/2026-10-11-referral-manual-customer-link.md`.

Tudo contra a **staging** (projeto Supabase `wsbsnzgzqiehqnklzchm`), afiliado de teste `VINDITESTE`
(`26dcdc4f-4c07-4dd2-b8f9-4e255d52af1f`, aprovado, 20% vitalícia sobre o líquido). Nenhum segredo neste
diretório: o cookie de sessão aparece como `<cookie>` e o telefone como `<redacted>`.

## Requisito → evidência

| Req. | O que prova | Evidência |
|---|---|---|
| R1 | Botão "Vincular indicado" só para afiliado `approved` | `task5-button-approved.png`, `task5-button-hidden-blocked.png`; `task5-checks.json` 1, 2a, 2b |
| R2 | Busca por e-mail, um usuário escolhido; resposta antiga não sobrescreve a nova; editar a busca desfaz a seleção | `task5-checks.json` 7a–7c (Review Focus 2) e 8 (Review Focus 1, resposta atrasada 1500 ms) |
| R3 | Linha de cobranças, acordo, aviso de cota, bloqueio no lugar da prévia | `task5-preview-zero.png`, `task5-preview-awaiting.png`, `task5-preview-b.png`, `task5-blocked-existing.png`, `task5-blocked-own.png`; `task5-checks.json` 3a, 4, 5a, 6, 9a; `lib/referral/manual-link.test.ts` (`describeManualLinkCharges`, `describeManualLinkQuota`) |
| R4 | Motivo obrigatório (1–500 após `trim`); "Vincular" desabilitado sem usuário elegível ou sem motivo | `task5-checks.json` 3b, 3c, 5b, 6; `manual-link.test.ts` (`parseManualLinkReason`) |
| R5 | Toast, diálogo fecha, sheet recarrega com a marca, contagem da fila recarregada | `task5-linked-b.png`; `task5-checks.json` 9b, 9c, 9d |
| R6 | Marca lida da auditoria em qualquer abertura posterior | `task4-sheet-manual-marker.png`, `task4-customers-api.json` (`manualLink` de A); `task6-sheet-commissions.png` (A e B marcados numa abertura nova) |
| R7 | `POST .../customers`: recusas na ordem da tabela, mensagens literais, 201 no vínculo, 409 no reenvio | `task3-api.txt` curls #10–#16 (linhas 50–82): corpo não-JSON → 400, motivo vazio → 400, conta própria → 409, já indicado → 409, vínculo → 201, reenvio → 409 `Já é indicado deste afiliado desde 05/09/2026`, sem cookie → 307 `/login` (#16, pelo `proxy.ts`); `manual-link.test.ts` (`planManualReferralLink` — tabela de recusas e ordem; `manualLinkActorAllowed` — só cargo `admin`) |
| R8 | Transação: `referral_customers` + `referral_admin_actions` gravados juntos; trava única relida como "já é indicado" | `task3-api.txt` "Step 6" (linhas 84–115: as duas linhas com o mesmo `created_at`, `details` completo, `signed_up_at` = `users.created_at`); `manual-link.test.ts` (`isReferralCustomerUserUniqueViolation`, datação pelo cadastro e fallback sem `created_at`) |
| R9 | `GET .../preview` sem escrita: 200 com `blocked.message` para recusas 409; 400/404 com as mensagens de R7 | `task3-api.txt` curls #1–#9 (linhas 5–48) |
| R10 | Lista do sheet devolve `manualLink: { linkedAt, adminEmail } \| null` | `task4-customers-api.json`; `manual-link.test.ts` (`indexManualLinks`) |
| R11 | `customer_linked` nos dois `schema.ts`, sem migração | `tests/referral-admin-action-parity.test.ts`; commits BO `aa7d892` e FE `23f0c5fa` (2 linhas em `lib/db/schema.ts`, nenhum arquivo em `migrations/`) |
| R12 | Próxima passagem do motor materializa evento e comissão para cobrança elegível; carência contada do processamento | `task6-engine.json` (`pickedBySweep: true`, evento `settled`, comissão `foreseen` criada, `releases_at` = processamento + 30 dias). Itens 2, 3 e 5 de R12 são comportamento atual do motor, sem mudança de código (`commission*.ts`/`queries.ts` do FE intocados), não exercitados na staging |
| R13 | Cada comissão = `round(líquido × bps / 10000)`; total do sheet = soma | `task6-engine.json` (`failures: 0`; A e B: líquido 47678 → esperado 9536, real 9536; reprocessar não cria segunda comissão); `task6-sheet-commissions.png` (R$ 95,36 em cada, cabeçalho "R$ 190,72 em comissão"); script de apoio `support/_rml-verify-commissions.ts` (roda no frontend) |
| R14 | Suítes iguais à base exceto testes novos; lint limpo; sem erro de tipo novo nos arquivos tocados | `task7-suites.md` |

## Escritas feitas na staging

| # | Tarefa | Escrita | Ids |
|---|---|---|---|
| 1 | Task 3 (`curl` #14) | **A** vinculado: 1 `referral_customers` + 1 `referral_admin_actions` (`customer_linked`) | usuário `02b26403-9ce7-496d-b601-c7923ea88ea8` (`rafaeliffeng+r1u1@gmail.com`) · Indicado `a5a9a918-69c7-4854-875f-7d050dc390ec` · acordo `303350de-84bf-4d05-aa1c-ceb9c090701f` · 2026-10-11 03:52:30 UTC |
| 2 | Task 5 (UI) | **B** vinculado: 1 `referral_customers` + 1 `referral_admin_actions` (`customer_linked`) | usuário `0f0f625d-0c02-488a-b75b-fa647eb00ec4` (`educacaoleg+001@gmail.com`) · Indicado `530fa1a3-ed7b-4a48-bfe0-c7945b95d689` · 2026-10-11 04:05:59 UTC |
| 3 | Task 6 | 2 eventos de comissão | A: `88b4cdbe-04cf-4d3f-aeee-7a3beb326806` (pagamento `5420bd35-504e-44a6-8384-0eb0dbf31fce`) · B: `f2f5d781-88b2-4458-a558-bdcc014d8ede` (pagamento `fd98259c-0671-44ec-ac09-dff993ace043`) |
| 4 | Task 6 | 2 comissões `foreseen` de 9536 centavos (R$ 95,36), liberação 2026-11-10 | A: `140bed2b-bb58-4c9f-9aae-1b4836c8d1ee` · B: `5bd687d6-45c6-4372-b744-260423b44bf0` |
| 5 | Task 6 | 2 lançamentos no extrato (1 por comissão) | contados em `task6-engine.json` (`ledger_entries: 1` em cada comissão); ids não capturados — localizáveis pelo id da comissão |

Observação: o motivo gravado no vínculo de A contém U+FFFD (artefato do `curl` do Git Bash, ver nota no fim
de `task3-api.txt`); a linha não foi corrigida.
