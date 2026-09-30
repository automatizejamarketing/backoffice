# Saldo / fatura da conta de anúncios Meta no perfil do usuário

- **Data:** 30/09/2026
- **Repositório:** `backoffice` (o `automatize-frontend` não muda)
- **Branch / worktree:** `feat/backoffice-meta-ad-account-money` em
  `D:\automatize-marketing\backoffice-meta-ad-account-money`, a partir de `origin/main` (`94f68eb`)
- **Status:** design aprovado no brainstorming de 30/09/2026 (seções 1, 2 e 3)

## Contexto

No app do cliente (`automatize-frontend`, `/app/marketing`), a faixa "Facebook conectado"
mostra o dinheiro da conta de anúncios selecionada:

- **pré-paga** (`is_prepay_account = true`): o saldo disponível, no texto que a própria Meta
  devolve em `funding_source_details.display_string` (ex.: "R$ 15,63"), exibido sem alteração;
- **pós-paga**: "Fatura em aberto" = `balance / 100` (a Meta devolve centavos; é dívida, não
  saldo);
- **sem permissão** (só para conexão BISU no app): "Saldo indisponível", porque a Meta esconde
  `funding_source_details` de quem não tem a tarefa MANAGE na conta e `is_prepay_account` de quem
  não tem MANAGE nem ADVERTISE.

A regra vive em `lib/meta-business/marketing/ad-account-money.ts`, arquivo **espelhado** do
frontend para o backoffice pelo `sync:meta` (`resolveAdAccountMoney` e
`isAdAccountMoneyBlockedByPermission`). O glossário do frontend (`docs/CONTEXT.md`, "Saldo
disponível vs Fatura em aberto") fixa que `balance` nunca é "saldo disponível".

Hoje o backoffice não mostra esse dado em lugar nenhum. Quem atende o cliente (suporte,
consultores) precisa pedir print para saber se a conta está sem saldo ou com fatura travando a
veiculação.

## Objetivo

Quem abre o perfil do cliente no backoffice consulta, na aba Marketing, o saldo ou a fatura da
conta de anúncios selecionada. O número deve ser o mesmo que o cliente vê no app, diferindo no
máximo pelo cache de até 5 minutos. O card também mostra o status da conta na Meta. É só leitura.

**Quem vê:** os mesmos papéis que já abrem a aba Marketing do perfil (admin, dev, comercial,
consultor premium, e consultor de marketing só nos clientes da própria carteira), pelo guard
`marketing:read` existente.

## Fora de escopo

- Adicionar saldo, abrir a central de cobrança da Meta ou qualquer escrita.
- Mostrar todas as contas de uma vez (o card acompanha a conta do seletor).
- Limite de gastos (`spend_cap`), valor gasto (`amount_spent`) e demais campos que o app não mostra.
- Qualquer mudança no `automatize-frontend`, inclusive o `formatCurrency` que fixa BRL e a
  divergência de rótulos de status já existente lá ("Pagamento pendente" × "Não quitada").
- Auditoria da leitura (o backoffice só audita mutações hoje).
- Cache em Redis (o cache de leituras do backoffice é L1 em memória por instância).
- Editar arquivos espelhados (`sync:meta`).

## Design

### 1. Servidor e dados

#### 1.1 Leitor `lib/meta-business/ad-account-money-read.ts` (novo, só do backoffice)

`readAdAccountMoney({ adAccountId, accessToken, fresh? })` devolve um `AdAccountMoneyRead`:

```ts
type AdAccountMoneyState =
  | { kind: "available"; display: string } // pré-paga: display_string da Meta, sem alteração
  | { kind: "owed"; amountMajor: number }  // pós-paga: balance / 100 (Fatura em aberto)
  | { kind: "blocked" }                    // Meta escondeu os campos por permissão
  | { kind: "none" };                      // não há valor para mostrar

type AdAccountMoneyRead = {
  adAccountId: string;              // só dígitos, sem "act_"
  name: string | null;
  currency: string | null;          // código ISO da conta (ex.: "BRL")
  isPrepaid: boolean | null;        // null quando a Meta não devolveu is_prepay_account
  money: AdAccountMoneyState;
  accountStatus: number | null;
  accountStatusLabel: string | null; // null quando accountStatus é null
  fetchedAt: string;                // ISO 8601 do momento da leitura real na Meta
};
```

- **Leitura:** um único `GET act_<id>` via `callMeta` (`lib/meta-business/insights/client.ts`,
  que já cuida de appsecret_proof, log e um retry de rate limit), com
  `fields=name,currency,account_status,balance,is_prepay_account,funding_source_details{display_string}`.
- **Degradação:** se a Meta recusar essa leitura com erro de **permissão ou campo** (código 10,
  100 ou 200–299), o leitor repete a leitura pedindo só `name,currency,account_status` e o estado
  vira `blocked`. Não degrada, e deixa o erro subir, quando o token está inválido (190/102), a Meta
  limita a taxa, ou o erro é transitório. Se a leitura só de identidade também falhar, o erro dela
  sobe.
- **Estado do dinheiro, nesta ordem:**
  1. campos de dinheiro recusados → `blocked`;
  2. `resolveAdAccountMoney(raw)` não nulo → `available` ou `owed`;
  3. `isAdAccountMoneyBlockedByPermission(raw)` → `blocked`;
  4. caso contrário → `none`.
- **Rótulo do status:** função exportada `getAccountStatusLabel(status)` em
  `lib/meta-business/insights/account.ts` (pasta não espelhada), a partir do mapa
  `ACCOUNT_STATUS_PT` que já existe ali ("Ativa", "Desativada", "Não quitada", "Em revisão de
  risco", "Aguardando pagamento", "Em período de carência", "Fechamento pendente", "Fechada";
  qualquer outro número → "Desconhecida"). O `fetchAccountContext` passa a usar a mesma função,
  sem mudança de comportamento. Esses rótulos são os mesmos de `messages/pt-BR.json` do app.
- **Cache:** `cachedMetaRead` com TTL de 5 minutos (mesmo frescor do app) e chave
  `acctmoney:<tokenCacheId>:<dígitos da conta>`. `fresh: true` repassa `forceRefresh`.
  `fetchedAt` é gravado junto com o valor, então um valor servido do cache mantém a hora da
  leitura original.

#### 1.2 Cache: opção `forceRefresh` em `lib/meta-business/read-cache.ts`

`CachedMetaReadArgs` ganha `forceRefresh?: boolean`. Com `true`: ignora a entrada fresca da L1 e
vai à Meta; continua juntando chamadas concorrentes iguais; grava o resultado novo; sob rate limit
ainda serve a entrada existente (fresca ou velha). Sem a opção, o comportamento atual não muda.

#### 1.3 Rota `GET /api/users/[id]/ad-accounts/[accountId]/money`

Arquivo `app/api/users/[id]/ad-accounts/[accountId]/money/route.ts`, fino. A lógica fica num
handler com dependências injetadas (padrão de `lib/meta-business/create-pixel-handler.ts`) para
ser testada sem rede nem banco.

- **Autorização:** `requireMarketingUserAccessResponse(userId)` (default `marketing:read`), o mesmo
  guard da lista de contas.
- **Parâmetro:** `accountId` precisa casar `^(act_)?\d+$`; senão, 400
  `{ error: "invalid_account_id", message: "Conta de anúncios inválida." }`.
- **Token:** `getUserAccessTokenByUserId(userId)`. Falha → mesmo corpo e mesmo status do
  `/api/users/[id]/ad-accounts` (`error`, `message`, `solution`, `needsReconnect` e `reconnect:
  buildReconnectInfo()` quando precisa reconectar).
- **`?fresh=1`** → `readAdAccountMoney({ ..., fresh: true })`.
- **Sucesso (200):** `AdAccountMoneyRead & { connectionKind: "bisu" | "user" }`, com
  `connectionKind` vindo de `connection.tokenKind`.
- **Erro da Graph:** mesmo mapeamento do `/ad-accounts`: `graphErrorToClientError` + `code` +
  `errorSubcode`; código 190 → 409 com `needsReconnect: true` e `reconnect`; demais → o
  `statusCode` do erro.
- **Erro inesperado:** 500 no mesmo formato do `/ad-accounts`.
- Sem auditoria. Sem filtro de "conta habilitada" da seleção fixa: o backoffice inspeciona todas
  as contas concedidas, e o token do cliente só alcança as contas que ele enxerga.

### 2. Interface

#### 2.1 Lógica de exibição `lib/backoffice/describe-ad-account-money.ts` (pura)

`describeAdAccountMoney(response)` recebe a resposta de sucesso da rota e devolve o que desenhar:

- **tipo:** "Pré-paga" / "Pós-paga" quando `isPrepaid` não é null; senão, nenhum;
- **selo de status:** texto = `accountStatusLabel` (nenhum selo quando null); tom:
  - `1` (Ativa) → neutro;
  - `3`, `8`, `9` (Não quitada, Aguardando pagamento, Em período de carência) → âmbar;
  - `2`, `7`, `100`, `101` (Desativada, Em revisão de risco, Fechamento pendente, Fechada) →
    destrutivo;
  - qualquer outro → contorno;
- **linha principal:**
  - `available`: rótulo "Saldo disponível" + valor = `display` exatamente como veio. Se `display`
    já contém "saldo" (sem diferenciar maiúsculas), o rótulo some e fica só o valor;
  - `owed`: rótulo "Fatura em aberto" + valor em
    `Intl.NumberFormat("pt-BR", { style: "currency", currency })`, com a moeda da conta; moeda
    ausente ou inválida → BRL;
  - `blocked`: título "Saldo indisponível" (com ícone de alerta) + motivo escrito:
    - `connectionKind = "bisu"`: "A Meta só mostra o saldo para integrações com acesso de
      administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de
      anúncios à Automatize no Gerenciador de Negócios e reconectar."
    - `connectionKind = "user"`: "A Meta não devolveu o saldo para quem conectou esta conta —
      provavelmente não é administrador dela."
  - `none`: "A Meta não informou saldo nem fatura para esta conta."

#### 2.2 Componente `app/(admin)/marketing/components/ad-account-money-panel.tsx` (cliente)

- Props: `userId`, `accountId`.
- react-query, chave `["ad-account-money", userId, accountId]`, `GET` na rota; trocar de conta
  troca a chave e dispara leitura nova.
- Subtítulo "Saldo / fatura na Meta" no estilo dos outros `h3` da seção
  (`text-sm font-medium text-foreground`); conteúdo numa caixa
  `rounded-md border border-border bg-muted/30 p-4`, igual à de "Status da conta de marketing do
  Facebook".
- **Carregando:** "Consultando a Meta…".
- **Sucesso:** o que `describeAdAccountMoney` devolver, mais o rodapé "Atualizado às HH:mm"
  (`formatTimeInSaoPaulo(fetchedAt)`) e o botão "Atualizar" (variante ghost, tamanho pequeno,
  ícone `RefreshCw` girando durante a leitura, desabilitado enquanto lê). O botão chama a rota com
  `?fresh=1` e substitui o dado da query.
- **Erro:** "Não foi possível consultar o saldo", mais `message` e `solution` da rota (quando
  vierem), e o botão "Tentar de novo" (nova leitura normal).
- Layout com `flex-wrap`, sem estouro horizontal em largura de celular.

#### 2.3 Encaixe em `app/(admin)/marketing/components/marketing-workspace.tsx`

Dentro do bloco "Conta de anúncios", logo abaixo do `AdAccountSelector`, renderizar
`<AdAccountMoneyPanel userId={selectedUser.id} accountId={selectedAccountId} />` quando houver
conexão Meta (`metaAccount`) e conta selecionada (`selectedAccountId`). Como o
`MarketingWorkspace` também é usado na página global `/marketing`, o card aparece nos dois
lugares (aba Marketing do perfil `/users/[id]?tab=marketing`, a versão embed
`/embed/users/[id]` e `/marketing`).

### 3. Testes, verificação e entrega

#### 3.1 Testes unitários (`bun test`, estilo `node:test`, herméticos)

- **Leitor:** pré-paga → `available` com o texto intacto; pós-paga → `owed` (centavos → reais);
  recusa de permissão (10/100/200) → leitura só de identidade → `blocked` com status preenchido;
  token inválido (190) sobe sem segunda leitura; rate limit sobe sem segunda leitura; pré-paga sem
  `display_string` → `blocked`; pós-paga sem `balance` → `none`; rótulo de status; cache
  respeitado e `fresh` fura o cache.
- **Cache `forceRefresh`:** ignora a entrada fresca, grava o valor novo, serve a entrada existente
  sob rate limit; sem a flag, o comportamento é o de antes.
- **Rota (handler):** guard negando repassa a resposta dele; 400 para id inválido; falha de token
  (404 e 409 com `reconnect`); erro 190 da Graph → 409 `needsReconnect`; outro erro da Graph →
  status dele; sucesso com `connectionKind`; `?fresh=1` chega ao leitor como `fresh: true`.
- **`getAccountStatusLabel`:** todos os números mapeados e o "Desconhecida".
- **`describeAdAccountMoney`:** todos os estados; motivo BISU × usuário; regra do "saldo"; moeda
  da conta, moeda ausente e moeda inválida; tom de cada status.

#### 3.2 Portão de qualidade (na worktree)

- `bun test` da suíte inteira, com `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend`.
  **Baseline em `94f68eb`: 1428 pass / 8 fail**, falhas pré-existentes e alheias (5 precisam do
  container Postgres `:55432`, desligado; 3 são drift do journal de migrations entre os repos). A
  entrega não pode acrescentar falhas.
- Lint sem problemas novos: `bun run lint` já sai 1 na base (174 problemas: 58 errors, 116
  warnings, em arquivos alheios), então o portão é `bunx eslint` nos arquivos da branch — novos
  com 0 problemas e os alterados sem nada além dos pré-existentes. `bun run build` limpo.
- Paridade do espelhamento, no checkout principal do frontend:
  `BACKOFFICE_ROOT=D:/automatize-marketing/backoffice-meta-ad-account-money bun run sync:meta:check`
  sem divergência.

#### 3.3 Verificação da interface (agent-browser)

- Servidor: `bun dev:staging` na worktree (`localhost:3006`, banco e chaves da staging).
- Sessão: cookie de sessão mágica do backoffice assinado localmente com o segredo da staging para
  um e-mail que já é admin, aplicado só em `localhost`.
- **Estado real:** perfil de um usuário da staging com Meta conectada → aba Marketing →
  screenshot do card com a leitura real (só `GET` na Meta).
- **Demais estados** com `agent-browser network route` (corpo simulado) e `--abort` (erro):
  pré-paga, pós-paga, bloqueado BISU, bloqueado usuário, sem valor, erro; um screenshot de cada.
- Um screenshot em largura de celular.
- Evidências em `.scratch/meta-ad-account-money/screenshots/` (ignorado pelo git), junto com o
  ledger do SDD em `.scratch/meta-ad-account-money/sdd-ledger.md`.

#### 3.4 Entrega

Commits na `feat/backoffice-meta-ad-account-money`, push e PR contra `main`. O merge é do Rafael.

## Requisitos (matriz de aceitação)

| ID | Requisito |
|----|-----------|
| R1 | Rota `GET /api/users/[id]/ad-accounts/[accountId]/money` protegida por `requireMarketingUserAccessResponse` (`marketing:read`). |
| R2 | `accountId` fora de `^(act_)?\d+$` → 400 `invalid_account_id`. |
| R3 | Falha de token → mesmo corpo/status do `/ad-accounts`, com `reconnect` quando precisa reconectar. |
| R4 | Leitura única `GET act_<id>` com os seis campos de 1.1, via `callMeta`. |
| R5 | Recusa de permissão/campo (10, 100, 200–299) → leitura só de identidade → `blocked` com nome/moeda/status; 190/102, rate limit e transitórios sobem sem segunda leitura. |
| R6 | Estado do dinheiro segue a ordem de 1.1 usando as funções espelhadas `resolveAdAccountMoney` e `isAdAccountMoneyBlockedByPermission`, sem editar arquivos espelhados. |
| R7 | Rótulos de status via `getAccountStatusLabel` exportada de `insights/account.ts`; `fetchAccountContext` usa a mesma função sem mudança de comportamento. |
| R8 | Cache de 5 min com chave `acctmoney:<tokenCacheId>:<conta>`; `?fresh=1` usa `forceRefresh`; `fetchedAt` é a hora da leitura real. |
| R9 | `forceRefresh` em `cachedMetaRead` conforme 1.2; chamadores atuais não mudam de comportamento. |
| R10 | Resposta 200 = `AdAccountMoneyRead` + `connectionKind`; erro da Graph no formato do `/ad-accounts` (190 → 409 `needsReconnect`). |
| R11 | `describeAdAccountMoney` produz tipo, selo (texto e tom) e linha principal exatamente como em 2.1. |
| R12 | Card "Saldo / fatura na Meta" abaixo do seletor de conta no `MarketingWorkspace`, só com conexão e conta selecionada; aparece no perfil (`?tab=marketing`) e em `/marketing`. |
| R13 | Estados de carregando, erro (com "Tentar de novo"), rodapé "Atualizado às HH:mm" e botão "Atualizar" (`?fresh=1`) conforme 2.2. |
| R14 | Layout sem estouro horizontal em largura de celular. |
| R15 | Testes de 3.1 existem e passam; suíte inteira sem falhas novas em relação à baseline (1428/8); nenhum problema de lint novo (base: 58 errors/116 warnings pré-existentes) e build limpo; `sync:meta:check` sem divergência. |
| R16 | Verificação de interface de 3.3 feita, com screenshots salvos. |
| R17 | Nenhum arquivo do `automatize-frontend` alterado. |
