# Migração Vindi — resultados dos testes em staging

**Ambiente:** staging (`wsbsnzgzqiehqnklzchm`) + sandbox Vindi (merchant 5529).
**Período:** 18–19/08/2026. **Executor:** Claude, conduzido pelo Rafael.

> Este documento foi **reconstruído** em 19/08 a partir do registro da sessão: a versão
> original vivia em `.scratch/vindi-migration/`, que é gitignored, e foi perdida quando as
> worktrees `vindi/*` foram removidas do disco. Por isso agora mora em `docs/`.
> O que se perdeu foi a tabela caso a caso; o que importa — resultados, defeitos e
> pendências — está aqui.

## Placar

**86 casos PASS · 14 defeitos corrigidos · 4 bloqueados pelo sandbox · 2 inverificáveis
pela ponte de verificação · 4 dependentes de passagem de tempo · 3 fora de escopo (canário
de produção).**

Seções cobertas: **A** (fundações e webhook) e **B** (produtos, cartão) completas;
**C**, **D**, **E**, **F**, **G**, **H**, **I**, **J**, **K**, **M**, **N**, **O** em
quase toda a extensão.

## Defeitos encontrados e corrigidos

| # | Onde | O que era | Correção |
|---|---|---|---|
| 1 | `selectPixQrMethodCode` | O sandbox tem `pix` e `pix_bank_slip` ("Bole**pix**"); o heurístico casava por substring e a API devolve o Bolepix primeiro. O seed cuspia `VINDI_PIX_METHOD_CODE=pix_bank_slip` — boleto com QR, semântica de vencimento e baixa diferentes. | `f91b544` — descarta híbridos de boleto, prefere o tipo exato do gateway. |
| 2 | `handleVindiWebhookRequest` | Evento cujo recurso não existe mais devolvia **500**. A Vindi reentregaria para sempre algo que nunca liquida. | `f91b544` — 4xx na reconsulta vira falha permanente (log + 200); 5xx e rede continuam propagando. |
| 3 | 4 checkouts de Pix | Sem QR, logavam "shape desconhecido" quando o motivo estava em `gateway_message`, e estouravam **antes de persistir** — fatura órfã viva a cada tentativa. | `c06ac93` — `failVindiPixBill` separa recusa de shape e cancela a órfã. |
| 4 | Migrações gêmeas `0049`/`0061` | Mesmo `when` de propósito, mas **não eram byte-a-byte** — o próprio teste que protege contra colisão falhava. | `a3d7784` + `acbb0b2` — texto idêntico nos dois repos. |
| 5 | Página pública do Pix | `/pix/vindi/nao-e-uuid` devolvia **500** (`invalid input syntax for type uuid`). | `4d88f3d` — `isVindiPixLinkId` valida antes da consulta. |
| 6 | `applyVindiChargeRejected` | **Nenhuma** recusa de cobrança de assinatura chegava ao dunning: `GET /v1/charges/{id}` embute a fatura só como `{id, code}`. Sem `past_due`, sem e-mail, sem WhatsApp. | `f2cb273` — busca a fatura, que traz `subscription` e `metadata`. |
| 7 | `subscription_events` | Reentrega de `charge_rejected` (rotina da Vindi, com `created_at` novo) criava um `payment_failed` por entrega. | `3cc45ca` — migração **0062** com índice parcial + `onConflictDoNothing`. |
| 8 | `claimVindiSettlementCharge` | **Pagar a assinatura em atraso levava o dinheiro e não entregava nada.** O guard tratava a linha `failed` da recusa como prova de liquidação. | `c2f300e` — só `succeeded` conta como liquidado. |
| 9 | `supersedeVindiBills` | Fatura que o gateway não anula derrubava o cancelamento inteiro — o usuário ficava assinado contra a vontade. | `9e46772` — anulação virou melhor esforço, com log. |
| 10 | TTL do link Pix | Nosso link valia **7 dias**, o QR da Vindi vale **~24h**. A página mostrava como válido um código que o PSP recusaria. | `82cc347` — vale o que expira primeiro. |
| 11 | Liquidação de Pix | **A Vindi não persiste `metadata` de fatura.** Todo parser começa em `metadata.purpose`, então nenhum Pix liquidava: o cliente pagava e não recebia. | `9524fc3` — reconstrói o metadata a partir de `vindi_payment_links`. |
| 12 | Cancelamento de PA no trial | O caminho pago avisava que o consentimento fica no banco; o de trial, não. | `05d115e` — mesma copy e metadata nos dois. |
| 13 | Relatórios financeiros | Toda venda `vindi_split_v1` reportava a venda **inteira** como receita nossa (R$100 em vez de R$18,90). | `21e8302` + `e6e073c` — lê os valores do split, já congelados na venda. |
| 14 | (ambiente) | As flags são **independentes por projeto** na Vercel; ligadas só no frontend, o backoffice devolvia 500 sem explicar. Faltava também `RESEND_FROM_EMAIL` no backoffice. | Corrigido na configuração. No corte, virar nos **dois** projetos. |

## Pendências que não são nossas

**Extensão "Transação de verificação"** — não liberada. Contornada por uma **ponte
temporária** (`VINDI_SKIP_CARD_VERIFICATION=true`), que só tem efeito quando a API é a de
sandbox. Enquanto ela estiver ligada, **D04 e E04 são inverificáveis** e um cartão recusado
cria assinatura sem cobrar. Remoção em 3 passos, documentada em
`lib/vindi/card-verification-bypass.ts`.

**Endereço obrigatório no Pix** — o gateway exige endereço **completo** (logradouro,
número, bairro, CEP, cidade, UF, país). O suporte disse que bastavam nome, e-mail,
CPF/CNPJ, telefone e CEP; testamos e **não basta**. A app não coleta endereço. Decisão de
produto pendente.

**Validade do QR de 24h vs. régua em D-3** — o `due_at` move o vencimento da fatura mas
**não** a validade do QR. O aviso de renovação sai 3 dias antes; o QR morre em 1.
Perguntado ao suporte (`mensagem-suporte-vindi-3.md`). Alternativa: mandar o QR só no D-1.

**Cancelamento de Pix no sandbox** — o suporte confirmou que boleto/Pix/BolePix **não**
cancelam no sandbox, só cartão, e que em produção funciona. Logo **I04 e K07** não são
defeitos: dependem do ensaio em produção.

**Metadata** — o suporte diz que é suportado; no merchant 5529 volta vazio em **bills,
subscriptions e customers**, inclusive com o payload de exemplo deles. Reperguntado.

**Repasse do split** — registra certo (o painel mostra "Participantes da venda — R$ 75,61"
em fatura pendente), mas some do painel e da API depois de paga. Não conseguimos observar o
repasse acontecendo.

**Template de WhatsApp `cobranca_falhou_v1`** — não existe em `pt_BR` na WABA. O e-mail de
dunning sai; o WhatsApp falha e registra o motivo. Precisa ser criado e aprovado na Meta,
com 3 variáveis no corpo (nome, plano, valor) e um botão de URL com sufixo dinâmico.

## O que falta testar

| Bloco | Casos | Depende de |
|---|---|---|
| Passagem de tempo | E05, F07, F09, H05 | O dia 7 chegar / a janela D-2 abrir. Os **agendamentos** já foram validados. |
| App do banco | F10, J07 | Autorizar um consentimento com teto abaixo da mensalidade. |
| Vindi liquidar Pix | G02, L02 | Geramos o QR; eles pagam. |
| Stripe test mode | L01, L04, L05 | **Nosso** — a chave é `sk_test_`, dá para montar. |
| Mercado Pago | K06 | **Nosso** — semear um link antigo e simular o webhook da cauda. |
| Canário de produção | Q01, Q02, Q03 | Decisão do Rafael. |

## Achados sem correção, para decidir

- **Retry depois do reissue** devolve `422 invalid_parameter: inválido(a)` — a cobrança
  virou Pix e `POST /v1/charges/{id}/charge` não se aplica. Esconder o botão ou traduzir.
- **Reembolso de produto** não toca a linha de `payments` (fica `succeeded`, sem
  `refunded_at`/`reversal_kind`), embora o caminho do Mercado Pago preencha. Sem impacto em
  número hoje, mas as duas tabelas ficam inconsistentes.
- **Rótulo "Mercado Pago Pix"** sobra no card de uma assinatura Pix Automático; num
  assinante QR aparece correto como "Pix de renovação".
- **`plan_type` fora do enum** derruba `/api/stripe/subscription` com 500 — a coluna é
  varchar sem CHECK.
- **Marca d'água de migração** foi para `1794200000000` por uma migração de outra branch.
  Toda migração Vindi nova precisa de `when` acima disso.
