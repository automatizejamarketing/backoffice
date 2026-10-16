# Destravar a criação de públicos de site e do Instagram

Data: 2026-09-30 · Branch: `fix/audience-period-unblock` (frontend e backoffice) · Base: `origin/main`

## 1. Problema

Em produção, a cliente `lirborges898@gmail.com` abriu **Criar público → Site** e não conseguiu criar o público: o campo de período não aparece, o botão **Revisar** fica desabilitado e a tela mostra *"O Gerenciador da Meta ainda não comprovou esta combinação de origem e critério… a criação ou a troca para esta combinação está impedida."*

**Não é limitação da Meta. É um bloqueio do próprio app.**

### Causa raiz

O commit `8ea54cf0` (ticket-24, 10/09/2026) introduziu um registro de "evidência de período" por origem/critério e só libera a criação quando todos os campos estão comprovados:

- `lib/meta-business/marketing/audiences/website.ts` — `WEBSITE_PERIOD_EVIDENCE` com `initialDays: null`, `editable: "unknown"`, `metaMinimumDays: null`, `metaMaximumDays: null`, `historicalFill: "unknown"` para `visitors`, `url` e `event`.
- `lib/meta-business/marketing/audiences/instagram.ts` — `INSTAGRAM_PERIOD_EVIDENCE` com os mesmos campos vazios para os 5 critérios.
- `websitePeriodEvidenceStatus()` / `instagramPeriodEvidenceStatus()` devolvem `"ready"` só se tudo estiver preenchido → sempre `"blocked"`.

A observação "autenticada do Gerenciador" que preencheria o registro nunca foi feita, então a trava ficou permanente:

- **Cliente:** `website-audience-editor.tsx` / `instagram-audience-editor.tsx` escondem o campo de período e desabilitam **Revisar** (`periodEvidenceReady`).
- **Servidor:** `reviewWebsiteAudience` devolve `WEBSITE_PERIOD_EVIDENCE_REQUIRED` e `reviewInstagramAudience` devolve `INSTAGRAM_PERIOD_EVIDENCE_REQUIRED` para todo público novo; o confirm re-executa a revisão.
- **Backoffice:** tem cópia própria (não espelhada; commit `fd30325`, mesmo ticket-24) com o mesmo defeito.

Evidência em produção (leitura, 30/09): a tabela `meta_audience_commands` está vazia para todos os usuários desde o release de 10/09 (`f485d5cd`). A cliente existe (`a68c40df-…`) e tem 1 conexão Meta.

Fora do bloqueio: o Mat/MCP (`agent/tools/createCustomAudience.ts`) não passa pela revisão e não é afetado.

## 2. Fatos da Meta (documentação oficial, conferida em 30/09/2026)

| Fato | Valor | Fonte |
|---|---|---|
| Período de público de site (`retention_days`) | **1 a 180 dias** | [Website Custom Audiences](https://developers.facebook.com/docs/marketing-api/audiences/guides/website-custom-audiences) — "Between 1 and 180 days" |
| `prefill` de público de site | padrão `true`, inclui atividade anterior à criação; máximo de 180 dias | mesma página — "The maximum prefill is 180 days" |
| Conflito no site | o FAQ da mesma página cita 365 dias | adotamos 180 (vale nas duas leituras) |
| Valor de referência do site | 30 dias (exemplo oficial `retention_days=30`; Central de Ajuda cita "last 30 days") | [Sobre públicos de site](https://www.facebook.com/business/help/610516375684216) |
| Período de público do Instagram (Gerenciador) | **máximo de 365 dias**; período é dinâmico e o público é reabastecido | [Criar público da conta do Instagram](https://www.facebook.com/business/help/214981095688584) — "(Maximum of 365 days.)" |
| Conflito no Instagram | a doc de desenvolvedor lista 730 dias | [Engagement Custom Audiences](https://developers.facebook.com/docs/marketing-api/audiences/guides/engagement-custom-audiences); adotamos 365 (vale nas duas) |
| Valor pré-preenchido pelo Gerenciador para Instagram | **não documentado** | 365 é escolha de produto, dentro do permitido |

## 3. Decisões aprovadas

- **Abordagem A:** preencher o registro de evidência com valores documentados, mantendo tipos, forma da resposta da API e as funções de status. Nada de remover o mecanismo (abordagem B) nem esconder atrás de flag (C).
- **Valores iniciais:** site 30 dias, Instagram 365 dias.
- **Limites:** site 1–180, Instagram 1–365.
- **Escopo:** frontend e backoffice, mesmos valores e mesmo comportamento.
- **Textos:** trocar os que ficam falsos e remover o jargão técnico do bloco de período.

## 4. Requisitos

### R1 — Contrato de período (frontend e backoffice, valores idênticos)

| Origem / critério | `initialDays` | `metaMinimumDays` | `metaMaximumDays` | `localValidationMaximumDays` | `editable` | `historicalFill` |
|---|---|---|---|---|---|---|
| Site: `visitors`, `url`, `event` | 30 | 1 | 180 | 180 | `"yes"` | `"available"` |
| Instagram: `all`, `engaged`, `profile_visit`, `messaged`, `saved` | 365 | 1 | 365 | 365 | `"yes"` | `"available"` |

- `observedAt: "2026-09-30"`.
- `source` cita as URLs oficiais da seção 2.
- `context` registra o conflito (site 180×365 no FAQ; Instagram 365 na Central de Ajuda × 730 na doc de desenvolvedor) e por que o menor valor foi adotado.
- `unit` continua `"days"`.
- Consequência esperada: `websitePeriodEvidenceStatus(c)` e `instagramPeriodEvidenceStatus(c)` devolvem `"ready"` para todos os critérios, e as respostas `GET …/audiences?sources=website|instagram` carregam esses valores em `periodEvidence` / `periodEvidenceByProfile` sem mudança de forma.

### R2 — Checagem de intervalo no servidor

- Em `reviewWebsiteAudience` e `reviewInstagramAudience` (frontend e backoffice), recusar o período fora de `[metaMinimumDays, metaMaximumDays]` da evidência:
  - Site: issue `WEBSITE_PERIOD_OUT_OF_RANGE`, mensagem *"O período do público do site deve ficar entre 1 e 180 dias."*
  - Instagram: issue `INSTAGRAM_PERIOD_OUT_OF_RANGE`, mensagem *"O período do público do Instagram deve ficar entre 1 e 365 dias."*
- **Exceção de preservação:** quando é edição e a seleção de período não mudou (`websitePeriodSelectionsEqual(before, selection)` / `selectionEqual`/`sameSelection(before, selection)` — mesma origem, critério e dias), o período é aceito mesmo fora do intervalo (público criado fora do app).
- Como o confirm re-executa a revisão, a checagem também vale no confirm.
- A checagem antiga `*_PERIOD_EVIDENCE_REQUIRED` permanece no código como proteção (evidência futura incompleta volta a bloquear), mas não dispara com R1.
- As validações puras `validateWebsiteAudienceSelection` / `validateInstagramAudienceSelection` e o `compileAudienceRule` genérico (`rule.ts`) **não** mudam: um teto ali quebraria a edição de nome de públicos antigos e o caminho do Mat.

### R3 — Tela (editores de site e Instagram, frontend e backoffice)

- O campo **Período de participação (dias)** aparece para público novo, pré-preenchido com 30 (site) ou 365 (Instagram), com `min`/`max` da evidência; o botão **Revisar** fica habilitado quando há fonte (Pixel/perfil).
- As checagens de mínimo/máximo que já existem no cliente passam a valer (site 181 → erro; Instagram 366 → erro), antes de qualquer requisição.
- Espelho da exceção de preservação de R2 no cliente: em edição, se origem e critério são os do público (`isCurrentPeriod`) e os dias digitados são iguais aos atuais, as checagens de mínimo/máximo do cliente não disparam (ex.: público existente com 400 dias continua salvável sem mudar o período).
- Linha de ajuda logo abaixo do campo:
  - Site: *"Entre 1 e 180 dias. Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação."*
  - Instagram: *"Entre 1 e 365 dias. Quem interagiu com o perfil nesse período entra no público."*
- Remover da tela o jargão técnico do bloco de período:
  - o parágrafo *"A fonte acessível, a atividade recebida e o estado do público são fatos diferentes…"* (só site);
  - a grade de 6 itens: Valor inicial / Editável / Limites Meta / Limite local / Unidade enviada / Preenchimento histórico (site e Instagram).
- Permanecem: os avisos de bloqueio (protegidos pela condição `!periodReady`), o status de período preservado em edição, a linha "Fonte: …", o aviso de "Eventos registrados" sem evento observado, o painel de revisão e o fluxo Revisar → Confirmar.

### R4 — Orientação da API de fontes do site

`GET …/audiences?sources=website` (frontend `app/api/meta-business/marketing/[accountId]/audiences/route.ts`, backoffice `app/api/meta-marketing/[accountId]/audiences/route.ts`) troca a orientação com Pixel ativo por: *"Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."* A mensagem sem Pixel ativo não muda.

### R5 — Fora do escopo (não mudar)

- A trava de **Eventos registrados**, que exige evento observado nos stats do Pixel.
- O Mat/MCP e o `rule.ts` genérico (site até 730 por lá; a Meta é a última barreira).
- O painel pós-**Revisar** e seus rótulos.
- Públicos de lista de clientes e semelhantes.

## 5. Testes

TDD nos dois repositórios.

- **Contrato (substitui os testes que exigiam "bloqueado"):** para cada critério de site e de Instagram, status `"ready"` e os valores exatos de R1.
  - Frontend: `tests/website-audience.test.ts` ("records unknown period evidence…") e `tests/instagram-audience.test.ts` ("does not invent a period default…").
  - Backoffice: `tests/website-audience.test.ts` ("keeps every website period criterion blocked…") e `tests/instagram-audience.test.ts` ("records unknown period evidence…").
- **Revisão no servidor (novos)**, com a Meta isolada por stub de `globalThis.fetch`, sem `mock.module` de módulos compartilhados:
  - Site: novo com 30 → `ok: true`; novo com 181 → `WEBSITE_PERIOD_OUT_OF_RANGE`.
  - Instagram: novo com 365 → `ok: true`; novo com 366 → `INSTAGRAM_PERIOD_OUT_OF_RANGE`.
  - Edição de público existente com 400 dias e seleção de período inalterada → aceita.
- **Suíte completa** (`bun test` puro) nos dois repositórios, comparada com a base medida na mesma worktree antes da mudança. Nenhuma falha nova.

## 6. Verificação de tela

Com o `agent-browser` contra o app rodando localmente (frontend: `next dev --webpack`, Eve desligado, ambiente staging; backoffice: `dev:staging` + cookie de sessão mágica):

- Respostas que dependem da Meta (fontes do site, perfis do Instagram e lista da biblioteca) são simuladas no navegador, **sem `periodEvidence`**, para exercitar as constantes empacotadas no cliente.
- Screenshots salvos no workspace do plano:
  - site com 30 e **Revisar** habilitado;
  - Instagram com 365;
  - erro ao digitar 181 no site;
  - ausência do jargão.
- **Confirmar** nunca é acionado contra conta real da Meta.

## 7. Critérios de aceitação

1. Público novo de site: o campo de período aparece com 30, aceita 1–180 e libera **Revisar** (frontend e backoffice).
2. Público novo do Instagram: o campo aparece com 365, aceita 1–365 e libera **Revisar** (frontend e backoffice).
3. O servidor recusa site > 180 e Instagram > 365 em público novo ou com período alterado, e aceita o período inalterado de público existente.
4. Nenhum texto da tela afirma que o período está "impedido" quando não está; o jargão do bloco de período sumiu.
5. Testes novos e atualizados passam; a suíte completa não tem falhas novas em relação à base.
