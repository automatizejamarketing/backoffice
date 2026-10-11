# Vínculo manual de indicado ao afiliado — design

Data: 2026-10-11 · Status: aprovado no brainstorming, aguardando revisão da spec escrita

## Contexto

O sheet "Indicados de <afiliado>" (`app/(admin)/referrals/affiliate-customers-sheet.tsx`, PR #86) lista as
linhas de `referral_customers` de um afiliado. Hoje um Indicado só nasce por **atribuição**: o visitante
clica no link do afiliado e cria a conta dentro da janela (`automatize-frontend/lib/referral/attribution*.ts`).
Não há como o operador corrigir uma indicação que se perdeu: cliente que veio pelo afiliado por outro
dispositivo, por WhatsApp, por indicação verbal.

O pedido: um administrador do backoffice vincula manualmente um cliente **já existente** da base como
Indicado de um afiliado, e as cobranças desse cliente passam a comissionar o afiliado.

## Decisões tomadas no brainstorming

| # | Decisão | Origem |
|---|---|---|
| D1 | **Cobranças passadas também comissionam.** O usuário aceitou (preferiu) considerar o histórico, com a condição de que o saldo do afiliado seja acrescido do **valor correto** dessas cobranças. | usuário |
| D2 | **Abordagem A:** o backoffice só cria o Indicado; o **motor de comissão existente** (frontend, varredura horária) calcula passado e futuro. Nenhuma mudança no motor, nenhuma migração. O valor é correto porque é o mesmo cálculo de toda comissão do programa — não uma cópia. | proposta aprovada |
| D3 | Cliente que **já é Indicado** (de qualquer afiliado) → **recusar com aviso**. Mantém "o primeiro afiliado é dono para sempre". | usuário |
| D4 | Só o cargo **`admin`**: `affiliates:manage` **e** `actor.role === "admin"`, conferidos no servidor. | proposta aprovada |
| D5 | Só afiliado **Aprovado** recebe vínculo manual (o botão nem aparece para os outros). | proposta aprovada |
| D6 | **Motivo obrigatório** — é uma ação que move dinheiro e fica na auditoria. | proposta aprovada |
| D7 | Prévia mostra a **base** (cobranças elegíveis, líquido somado, quantas aguardam liquidação) e o acordo, **sem estimativa de comissão** — estimar exigiria duplicar a regra do motor. | proposta aprovada |
| D8 | `signed_up_at` do Indicado manual = **criação da conta do cliente**, igual à atribuição ("o Indicado nasce datado pelo cadastro"). | proposta aprovada |
| D9 | Nova ação de auditoria `customer_linked` em `REFERRAL_ADMIN_ACTION_VALUES`, espelhada nos **dois** `schema.ts`. A coluna é `varchar` sem CHECK: **sem migração**. | proposta aprovada |
| D10 | Subagentes da execução: Opus 5.5, effort High (o modelo pedido, GPT-6 Luna, não existe neste harness). | usuário |

## Requisitos

Cada requisito é verificável e vira uma linha da matriz de aceitação.

**Interface**

- **R1.** O cabeçalho do sheet de indicados mostra o botão **"Vincular indicado"** apenas quando o afiliado
  está com status `approved`. Para `pending`, `rejected` e `blocked` o botão não aparece.
- **R2.** O botão abre um diálogo com busca de usuário por e-mail (mínimo 3 caracteres), reaproveitando
  `GET /api/users/search`. O operador escolhe exatamente um usuário.
- **R3.** Ao escolher o usuário, o diálogo carrega a **prévia** (`GET .../preview`) e mostra:
  - a **linha de cobranças**, com os textos exatos (dinheiro por `formatCentavos`, `lib/referral/write-off.ts`):
    - zero elegíveis: *"Nenhuma cobrança paga até agora — só as próximas vão comissionar"*;
    - uma: *"1 cobrança de assinatura paga · R$ 97,00 de líquido"*;
    - várias: *"6 cobranças de assinatura pagas · R$ 1.164,00 de líquido"*;
    - com aguardando liquidação, acrescenta *" · 1 aguardando liquidação"* (ou *" · 2 aguardando
      liquidação"*); com zero aguardando, nada é acrescentado;
  - o acordo vigente do afiliado (`describeAgreementValue(agreement)` + `" · "` + `describeAgreementDuration(agreement)`);
  - o **aviso de cota**, só quando o acordo tem cota Q (`first_sale` → 1, `n_cycles` → `durationCycles`) e há
    E ≥ 1 cobranças elegíveis. Com N = mín(E, Q):
    - N = 1: *"A cobrança mais antiga consome 1 de Q comissão|comissões do acordo."*
    - N > 1: *"As N cobranças mais antigas consomem N de Q comissões do acordo."*
    - quando N = Q, acrescenta *" As próximas cobranças não vão comissionar."*
    - (`comissão` no singular só quando Q = 1.) Acordo vitalício: sem aviso.
  - quando o vínculo é impossível (R7, linhas 409), a mensagem do bloqueio no lugar da prévia, com o botão
    "Vincular" desabilitado.
- **R4.** Campo **Motivo** obrigatório (texto, 1–500 caracteres após `trim`). "Vincular" fica desabilitado
  sem usuário elegível ou sem motivo.
- **R5.** Depois do vínculo: toast de sucesso, o diálogo fecha, o sheet recarrega e o novo Indicado aparece
  com a linha discreta *"Vinculado manualmente em DD/MM/AAAA por <e-mail do admin>"*. A contagem
  "N indicados" da fila também é recarregada.
- **R6.** Indicados vinculados manualmente continuam com essa marca em qualquer abertura posterior do sheet
  (lida da auditoria, não de estado do navegador).

**Servidor**

- **R7.** `POST /api/referrals/[affiliateId]/customers` com `{ userId, reason }` cria o vínculo. Recusas,
  na ordem em que são avaliadas:

  | Situação | Status | Mensagem |
  |---|---|---|
  | sem sessão | 401 | (padrão do RBAC: `Unauthorized`; pelo navegador o `proxy.ts` redireciona antes para `/login`) |
  | sem `affiliates:manage` | 403 | (padrão do RBAC: `Forbidden`) |
  | com `affiliates:manage` mas cargo ≠ `admin` | 403 | `Apenas administradores podem vincular indicados` |
  | `affiliateId` não é uuid | 404 | `Afiliado não encontrado` |
  | corpo inválido: não é JSON ou `userId` não é uuid | 400 | `Usuário inválido` |
  | motivo vazio ou > 500 caracteres | 400 | `Informe o motivo do vínculo (até 500 caracteres)` |
  | afiliado inexistente (conferido no banco) | 404 | `Afiliado não encontrado` |
  | usuário inexistente | 404 | `Usuário não encontrado` |
  | afiliado não `approved` | 409 | `Só afiliado aprovado pode receber indicado` |
  | afiliado sem acordo vigente | 409 | `Afiliado sem acordo vigente` |
  | usuário é a conta do próprio afiliado | 409 | `Esta é a conta do próprio afiliado` |
  | usuário já é Indicado deste afiliado | 409 | `Já é indicado deste afiliado desde DD/MM/AAAA` |
  | usuário já é Indicado de outro afiliado | 409 | `Já é indicado de <nome ou e-mail do afiliado> desde DD/MM/AAAA` |
  | corrida: a trava única de `referral_customers.user_id` dispara | 409 | a mesma mensagem de "já é indicado", relida |

- **R8.** O vínculo é **uma transação**: trava a linha do afiliado (`FOR UPDATE`, o idioma de
  aprovar/renegociar), relê as condições de R7, insere `referral_customers`
  `{ userId, affiliateId, agreementId: <acordo vigente>, signedUpAt: <users.created_at> }` e insere
  `referral_admin_actions` `{ affiliateId, adminEmail, action: "customer_linked", reason,
  details: { customerId, userId, userEmail, agreementId } }`. Falha em qualquer passo desfaz os dois.
- **R9.** `GET /api/referrals/[affiliateId]/customers/preview?userId=<uuid>` aplica a mesma autorização de
  R7 e devolve, sem escrever nada:
  `{ user: {id,email,name}, blocked: null | { message }, agreement: {...} | null,
     charges: { eligibleCount, netCentavos, awaitingSettlementCount } }`.
  `userId` ausente ou não-uuid → 400 `Usuário inválido`; afiliado ou usuário inexistente → 404 com as
  mensagens de R7; as recusas 409 de R7 **não** viram erro HTTP aqui: voltam 200 com `blocked.message`.
  "Elegível" usa **exatamente os cortes da varredura do motor**
  (`automatize-frontend/lib/referral/queries.ts → findPaymentsPendingCommission`):
  `status = 'succeeded'`, `purpose IS NULL OR purpose = 'subscription'`, `external_id IS NOT NULL`,
  `coalesce(gross_amount, amount) > 0`. `netCentavos` soma `net_amount` das elegíveis que o têm;
  `awaitingSettlementCount` conta as elegíveis com `net_amount IS NULL`.
- **R10.** O `GET /api/referrals/[affiliateId]/customers` (lista do sheet) passa a devolver, por Indicado,
  `manualLink: { linkedAt, adminEmail } | null`, lido de `referral_admin_actions` com
  `action = 'customer_linked'` e `details->>'customerId'` = id do Indicado.

**Dados e paridade**

- **R11.** `customer_linked` entra em `REFERRAL_ADMIN_ACTION_VALUES` em `backoffice/lib/db/schema.ts` **e**
  em `automatize-frontend/lib/db/schema.ts`. Nenhuma migração, nenhum `db:generate`.

**Comissão (motor do frontend, sem mudança de código)**

- **R12.** Depois do vínculo, a próxima passagem do motor (`runReferralCommissionEngine`, chamada pelo cron
  `/api/cron-job/billing/reconcile-settlements`, minuto 20 de cada hora em produção) materializa um evento
  por cobrança elegível do cliente e cria as comissões conforme o acordo, com estas consequências — que são
  o comportamento atual do motor, documentado aqui porque agora alcança cobranças antigas:
  1. comissionam cobranças de **qualquer data**, inclusive anteriores à aprovação do afiliado;
  2. não comissionam: cobrança paga durante um período de bloqueio do afiliado, estornada, ou sem
     identidade de gateway (acesso manual);
  3. a cota (`n_cycles`, `first_sale`) é consumida da **mais antiga para a mais nova** (a varredura ordena
     por `payments.created_at`); acordo vitalício comissiona todas;
  4. cada comissão retroativa entra na carência de 30 dias contada do **processamento**;
  5. cobrança sem líquido fica `awaiting_settlement` até o reconciliador completá-lo.
- **R13.** Verificação ponta a ponta na staging: depois de vincular um cliente de teste com cobranças pagas e
  rodar o motor, **cada** comissão criada é igual à regra do acordo sobre o líquido da cobrança
  (percentual: `round(líquido × bps / 10000)` conforme `calculateCommissionAmount`; fixo: o valor fixo),
  e o total no sheet bate com a soma das comissões.

**Qualidade**

- **R14.** A suíte completa dos dois repositórios fica igual à base, exceto pelos testes novos (que passam).
  Lint limpo e nenhum erro de tipo novo nos arquivos tocados.

## Fora do escopo

- Desvincular ou transferir um Indicado (correção de engano exige ação manual no banco por enquanto).
- Disparar o motor na hora a partir do backoffice (comissão aparece em até 1h em produção).
- Estimativa de comissão na prévia (D7).
- Avisar o afiliado ou o cliente do vínculo.
- Qualquer mudança no motor de comissão, na atribuição por clique ou no painel do afiliado.

## Arquitetura

### Backoffice

| Unidade | Responsabilidade | Depende de |
|---|---|---|
| `lib/referral/manual-link.ts` | Puro. `planManualReferralLink(state)` decide `ok` ou recusa `{status, message}` na ordem de R7 (do 404 de usuário em diante); `describeManualLinkCharges(charges, agreement)` produz os textos de R3 (linha de cobranças e aviso de cota); validação do motivo. | `agreement.ts` (cota/descrições), `datetime-format` |
| `lib/referral/manual-link.test.ts` | Testes de tabela das regras e textos (TDD). | — |
| `lib/referral/manual-link-queries.ts` | `previewManualReferralLink(affiliateId, userId)` (somente leitura) e `linkReferralCustomerManually({affiliateId, userId, reason, adminEmail})` (a transação de R8, erro de domínio com status via `ReferralOperationError`; 23505 vira 409). | `db`, schema, `manual-link.ts` |
| `lib/referral/customer-queries.ts` (existente) | Acrescenta `manualLink` por Indicado (R10). | `referral_admin_actions` |
| `app/api/referrals/[affiliateId]/customers/route.ts` (existente) | Ganha `POST` (R7/R8). | `requireBackofficePermissionResponse`, queries |
| `app/api/referrals/[affiliateId]/customers/preview/route.ts` | `GET` da prévia (R9). | idem |
| `app/(admin)/referrals/link-customer-dialog.tsx` | O diálogo de R2–R4: busca, prévia, motivo, submissão. | rotas acima, `/api/users/search` |
| `app/(admin)/referrals/affiliate-customers-sheet.tsx` (existente) | Botão de R1, marca de R5/R6, recarga após vínculo, callback `onCustomersChanged` para a página. | diálogo |
| `app/(admin)/referrals/page.tsx` (existente) | Passa o status do afiliado ao sheet e recarrega a fila quando o sheet avisa (R5). | — |

O autorizador "admin" fica num helper único usado pelas duas rotas
(`requireReferralLinkAdmin()` em `manual-link-queries.ts` ou na rota), para que preview e POST não
divirjam.

### Frontend

- `lib/db/schema.ts`: `"customer_linked"` em `REFERRAL_ADMIN_ACTION_VALUES` (R11). Mais nada.

### Fluxo

```
Admin clica "Vincular indicado"
  → busca /api/users/search?q=…        (users:read — admin tem)
  → escolhe usuário → GET …/preview     (só leitura; mostra base, acordo, bloqueio)
  → digita motivo → POST …/customers    (transação: trava afiliado, relê, insere indicado + auditoria)
  → sheet recarrega (marca "vinculado manualmente"); fila recarrega a contagem
… até 1h depois (produção) …
cron reconcile-settlements → runReferralCommissionEngine → eventos + comissões das cobranças elegíveis
  → coluna "Comissão" do sheet passa a mostrar os valores
```

## Erros e casos de borda

- Prévia e POST reavaliam tudo no servidor; a prévia é só informativa — o POST relê dentro da transação.
- Dois admins vinculando o mesmo cliente ao mesmo tempo: a trava única de `user_id` decide; o perdedor
  recebe 409 com a mensagem de "já é indicado".
- Afiliado bloqueado ou renegociado entre a prévia e o POST: a transação relê com a linha travada e
  usa o acordo vigente **naquele instante**.
- Falha de rede no diálogo: mensagem de erro no próprio diálogo, sem fechar, para o operador tentar de novo.

## Testes e verificação

1. **Unidade (TDD)** — `manual-link.test.ts`: cada linha da tabela de R7 a partir do 404 de usuário; textos
   de R3 (zero cobranças, com e sem aguardando liquidação, cota `n_cycles`/`first_sale`, vitalícia sem aviso);
   validação do motivo.
2. **Suíte completa** dos dois repositórios contra a base medida na mesma worktree (Docker desligado: os
   testes com Postgres local falham igual na base e na branch).
3. **Rotas** contra o dev server em staging (`curl` com a sessão local): 401/403/404/400/409/200 de R7 e R9.
4. **UI com agent-browser** contra `bun run dev:staging`, screenshots salvos em
   `docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/`: botão visível/oculto por
   status, diálogo com prévia, bloqueio "já é indicado", sucesso com a marca no sheet, largura de celular.
5. **Ponta a ponta do dinheiro (R13)** na staging: vincular um cliente de teste com cobranças pagas,
   rodar `runReferralCommissionEngine` do frontend contra a staging (o cron não roda lá), e comparar cada
   comissão com a regra do acordo. **Isso grava dados de teste na staging** (Indicado, eventos, comissões,
   lançamentos) e eles permanecem — não existe desvincular.

## Entrega e rollout

- Backoffice: worktree `.worktrees/referral-manual-link/backoffice`, branch `feat/referral-manual-customer-link`,
  PR contra `main`.
- Frontend: worktree `.worktrees/referral-manual-link/automatize-frontend`, branch
  `feat/referral-manual-link-action-type`, PR contra `main`.
- Os dois PRs são independentes e podem entrar em qualquer ordem (a coluna não tem CHECK). Produção não
  precisa de migração. O merge é do usuário.

## Riscos

- **Cobrança antiga sem líquido**: se o reconciliador não conseguir o líquido de uma cobrança antiga, o evento
  fica `awaiting_settlement` e acende o alerta de liquidação parada (3 dias) do painel de Métricas. É o
  comportamento atual do programa para qualquer cobrança; a prévia mostra quantas estão nessa situação.
- **Volume**: a varredura processa 200 pagamentos por passagem no programa inteiro; um cliente com histórico
  longo pode levar mais de uma passagem. Sem efeito no valor, só no tempo.
- **Paridade da prévia**: os cortes de "elegível" (R9) copiam os da varredura do frontend. Se a varredura
  mudar, a prévia precisa acompanhar — registrado em comentário no código apontando o arquivo de origem.
