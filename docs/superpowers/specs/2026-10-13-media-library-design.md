# Biblioteca de mídias — design

**Status:** aprovado no brainstorming de 2026-10-13 (seções 1–4 aprovadas pelo Rafael).
**Repos:** `automatize-frontend` (FE) e `backoffice` (BO), branch `feat/media-library` em ambos,
worktrees irmãs em `D:\automatize-marketing\.worktrees\media-library\{automatize-frontend,backoffice}`.
**Substitui:** ADR 0021 (retenção de 7 dias da mídia do dispositivo).
Este arquivo existe idêntico nos dois repos.

## 1. Objetivo

O cliente guarda as imagens e vídeos do produto dele numa **Biblioteca de mídias** permanente
(enquanto tiver acesso à plataforma), reaproveita essas mídias ao criar campanhas com IA, e a
equipe do backoffice vê, baixa, exclui e adiciona mídias na biblioteca de qualquer cliente,
ficando registrado quem subiu cada mídia e quando. O bucket R2 não acumula mídia de conta
abandonada: um mês depois da expiração, tudo é apagado.

**Sucesso:** uma mídia enviada pelo app ou pelo backoffice aparece nos dois lados e nos seletores
de campanha com IA; só desaparece por exclusão explícita ou quando a conta completa 1 mês
expirada; o admin vê o autor (cliente ou e-mail do admin) e a data/hora de cada mídia.

## 2. Conceitos

- **Biblioteca de mídias** — o conjunto, por usuário, das linhas de `blob_uploads` com
  `source = 'campaign_media'` e `deleted_at IS NULL`, cada uma com um objeto no bucket de mídia R2.
  É o que o glossário chamava de *device media library*; deixa de ter prazo de 7 dias. Fotos e
  vídeos que o cliente manda ao Mat pelo WhatsApp também entram nela (comportamento existente).
  Escopo: **por usuário** (não por empresa), como `blob_uploads`, as contas Meta e o ADR 0021.
- **Estado da biblioteca** — derivado de `users.expiration_date` (a regra de *Acesso à
  Plataforma* do domínio) e do bypass de cobrança:

| Estado | Condição | Cliente | Backoffice |
|---|---|---|---|
| `active` (Ativa) | bypass de cobrança, **ou** `expiration_date > now` | vê, sobe, baixa, exclui | vê, sobe, baixa, exclui |
| `grace` (Carência) | `expiration_date <= now < purgeAt` | bloqueado pelo gate de assinatura do `/app` (API: pode listar/baixar/excluir, **não** sobe) | vê, sobe, baixa, exclui |
| `closed` (Encerrada) | `expiration_date` nula, **ou** `now >= purgeAt` | nada; lista vazia | nada pode ser adicionado; lista vazia; download recusado |

- **purgeAt** = `expiration_date` + 1 mês de calendário, somado em UTC com *clamp* de fim de
  mês (31/01 → 28/02, ou 29/02 em ano bissexto). Nulo quando `active` por bypass ou quando
  `expiration_date` é nula.
- **Bypass de cobrança** = `BYPASS_STRIPE === "true"` **ou** `isBypassStripeEmail(email)`
  (lista fixa + `BYPASS_STRIPE_EMAILS`), a mesma regra do gate do app. O BO passa a ter o mesmo
  helper, espelhado byte a byte.
- Renovar o acesso devolve o estado `active`; mídias já apagadas não voltam.

## 3. Requisitos

IDs usados pela matriz de aceitação da avaliação final.

### App (FE)

- **R1 — Sidebar e rota.** Item de nível superior "Biblioteca de mídias" (ícone lucide `Images`)
  logo abaixo de "Marketing" na sidebar do `/app`, com chaves i18n pt-BR e en; rota
  `/app/biblioteca-de-midias` com o gate de assinatura normal (não entra na lista de isenção);
  título no header (`app-header-provider`); entrada no catálogo de rotas do Mat
  (`agent/lib/app-routes.ts`).
- **R2 — Enviar.** Botão "Enviar mídias" (seleção múltipla) e arrastar-e-soltar sobre a grade.
  Tipos/limites: JPEG/PNG até 5 MB; MP4/MOV/WebM até 300 MB (inalterados). Cada arquivo na fila
  mostra progresso e erro próprio (tipo, tamanho, estado, rede). Só no estado `active`.
- **R3 — Excluir.** Confirmação com o aviso de que anúncios já publicados não são afetados;
  apaga do R2 e marca a linha (`deleted_at`, `deleted_reason = 'user'`).
- **R4 — Baixar.** Baixa o arquivo com o nome original (presigned GET com
  `Content-Disposition: attachment`).
- **R5 — Ver.** Prévia ampliada (imagem; vídeo com player).
- **R6 — Listar.** Grade paginada (48 por página, "Carregar mais"), mais recente primeiro,
  filtro Todas/Imagens/Vídeos, contador; card com miniatura (vídeo com selo de play), nome,
  data e tamanho; selo "Equipe Automatize" quando subida pelo backoffice (o e-mail do admin não
  aparece para o cliente); estado vazio com chamada para enviar; linha discreta sobre retenção
  com o detalhe da regra de 1 mês num tooltip.
- **R7 — Seletor da campanha com IA.** No `MultiMediaSelector` (campanha com IA e wizard), a
  aba "Do dispositivo" vira "Biblioteca de mídias": enviar no topo + grade da biblioteca. O que é
  enviado entra na biblioteca e já vem selecionado se houver vaga (o excedente fica salvo, não
  selecionado). Some a divisão "enviados nesta sessão" × "biblioteca". O formato devolvido
  (`UploadedDeviceImage`, com `id = blob_uploads.id`) não muda. Corrige o bug do limite
  (`slice(0, Math.max(...))`) e o `image/jpg` que o servidor recusava.
- **R8 — Outro seletor do app.** A aba Upload do `MediaSourcePicker` (diálogo de criativo e chat
  do Mat) usa a mesma grade da biblioteca, em seleção única, rotulada "Biblioteca".

### Backoffice (BO)

- **R9 — Card no Marketing do cliente.** Card "Biblioteca de mídias" no `MarketingWorkspace`
  (logo após "Detalhes do usuário"), visível em `/users/[id]?tab=marketing`, no drawer
  `/embed/users/[id]` e em `/marketing`. Topo: estado ("Ativa até DD/MM/AAAA" /
  "Carência — exclusão em DD/MM/AAAA" / "Encerrada — o cliente precisa renovar") e botão
  "Adicionar mídias" (oculto sem `marketing:write`; desativado com explicação quando `closed`).
  Grade compacta (2 linhas) com "Ver todas (N)" que expande com paginação. Item: miniatura,
  nome, tamanho, "Enviada por: Cliente" ou o e-mail do admin, data/hora em
  America/Sao_Paulo; ações Ver, Baixar, Excluir (Excluir só com `marketing:write`).
- **R10 — Seletor da campanha com IA no BO.** No `MediaSourcePicker` do BO (fluxo de IA e diálogo
  de criativo), a aba "Upload" vira "Biblioteca": enviar + grade da biblioteca do cliente. Upload
  pelo admin fica registrado com o admin como autor. O formato devolvido
  (`{ source: "device", blobUrl, mediaType, previewUrl }`) não muda.
- **R11 — Autoria e auditoria.** Upload pelo BO grava `uploaded_by_backoffice_email` = e-mail do
  ator e uma linha em `backoffice_audit_logs` (`action = 'media_library_add'`); exclusão pelo BO
  grava `deleted_reason = 'backoffice'` e auditoria `media_library_delete`. As duas ações
  aparecem na aba Auditoria do cliente.
- **R12 — Permissões.** Leitura e download: `marketing:read`; adicionar e excluir:
  `marketing:write`; sempre via `requireMarketingUserAccessResponse(userId, …)` (consultores
  só nos clientes atribuídos).

### Regras e plataforma

- **R13 — Estados.** Todas as rotas, telas e o cron usam a mesma função pura de estado (§5).
  Upload pelo cliente só `active`; pelo BO `active` ou `grace`; ninguém em `closed`. Em `closed`
  a listagem vem vazia (com o estado) e o download é recusado, mesmo antes do cron rodar.
- **R14 — Retenção.** Cron diário no FE, `/api/cron-job/media-library/retention`, 06:00 UTC,
  autenticado por `CRON_SECRET` (`checkCronAuth`). Para cada cliente `closed` com mídia:
  apaga os objetos do R2 em lotes de até 1000 **conferindo o erro de cada chave** (hoje
  `Quiet: true` ignora `Errors`), marca só as linhas cujos objetos foram apagados
  (`deleted_reason = 'retention'`) e varre o prefixo `media/library/<userId>/` atrás de órfãos.
  Falha parcial é retentada no dia seguinte (idempotente). `BYPASS_STRIPE=true` → não faz nada.
  Orçamento de tempo com `maxDuration`.
- **R15 — Fim dos 7 dias.** Sai o branch de 7 dias do `cleanup-blob-storage` (fica a limpeza de
  24h do Post do Prato), o filtro de 7 dias da listagem e os textos de "7 dias". No BO sai
  `cleanupBlobAfterMetaIngestion` (módulo e as duas chamadas). Nenhum outro caminho apaga mídia
  da biblioteca além de: exclusão pelo cliente, exclusão pelo BO e o cron de retenção.
- **R16 — Segurança do upload.** Uploads novos vão para `media/library/<userId>/<nome>-<aleatório>.<ext>`.
  A confirmação só aceita chave no prefixo do dono, confere por HEAD no R2 existência, tamanho
  (≤ limite do tipo) e tipo permitido, e confere o estado de novo; se reprovar, apaga o objeto e
  responde erro. A ação `register` antiga de `/api/files/upload` (que aceitava qualquer URL) é
  removida nos dois apps; as chaves antigas já gravadas continuam válidas.
- **R17 — WhatsApp.** A ingestão de mídia do WhatsApp continua gravando `campaign_media` como
  hoje (sem checagem de estado — é insumo do agente); o cron limpa se o cliente estiver `closed`.
- **R18 — Rotas de anúncio inalteradas.** As checagens de posse em `blob_uploads`
  (`source='campaign_media'`, `deleted_at IS NULL`) nas rotas de criativo/vídeo dos dois apps
  continuam aceitando mídias selecionadas da biblioteca.

### Não funcionais

- **N1 — Migração gêmea aditiva** nos dois repos, mesmo SQL e mesmo `when` (> `1802000000000`,
  maior que o último `when` dos dois journals), `IF NOT EXISTS`, `--> statement-breakpoint`
  entre statements, arquivos `.sql` com fim de linha LF e bytes idênticos nos dois repos; não
  introduz falha nova em `tests/migration-journal.test.ts` (BO) — as 2 falhas atuais desse
  arquivo (`0110`/`0116` e `0116`/`0121`) são dívida anterior, medida na base.
  Renumerada para FE `0144` / BO `0135` e `when` 1802300000000 em 2026-10-13, depois que a main avançou (0143/0134 usam 1802100000000).
- **N2 — Módulo de política espelhado** (`lib/media-library/policy.ts`) e o helper de bypass
  (`lib/access/billing-bypass.ts`) byte-idênticos nos dois repos, cobertos pelo teste de
  paridade e pelo `sync:meta` (lista em `tests/helpers/source-parity.ts`).
- **N3 — Sem regressão.** Suítes completas (`bun test --timeout 30000`) sem falha nova frente à
  base medida na mesma worktree; `tsc --noEmit` limpo nos dois; lint por arquivo no BO.
- **N4 — UI.** FE segue `docs/DESIGN.md` (Urbane/IvyMode, uma palavra em IvyMode itálico no
  título: "Biblioteca de *mídias*"); BO segue shadcn new-york e textos pt-BR fixos. Informação
  secundária discreta. Sem scroll horizontal a 375 px.
- **N5 — Documentação.** ADR novo no FE substituindo o 0021; `CONTEXT.md` dos dois repos; tabela
  de crons do `CLAUDE.md`/`AGENTS.md` do FE.
- **N6 — Runbook de deploy no PR.** Migrar staging e produção à mão **antes** do deploy (o código
  lê as colunas novas; a Vercel não migra); conferir `BYPASS_STRIPE_EMAILS` no projeto do BO;
  conferir o CORS do bucket de mídia para os dois domínios.

## 4. Modelo de dados

`blob_uploads` (nos dois `schema.ts`), colunas novas, todas nulas:

| Coluna | Tipo | Significado |
|---|---|---|
| `size_bytes` | `bigint` | tamanho lido do HEAD do R2 na confirmação |
| `uploaded_by_backoffice_email` | `varchar(255)` | e-mail do admin que subiu; nulo = o próprio cliente (app ou WhatsApp) |
| `deleted_reason` | `varchar(20)` | `user` \| `backoffice` \| `retention` |

Índice parcial `blob_uploads_media_library_idx` em `(user_id, created_at DESC, id DESC)
WHERE source = 'campaign_media' AND deleted_at IS NULL`.

Linhas existentes não são reescritas (sem backfill). Paginação por cursor `(created_at, id)`.

## 5. Módulo de política (puro, espelhado)

`lib/media-library/policy.ts`, sem I/O e sem `process.env` implícito:

- Constantes: tipos aceitos (`image/jpeg`, `image/png`, `video/mp4`, `video/quicktime`,
  `video/webm`), extensões, limites (5 MB / 300 MB), `MEDIA_LIBRARY_PAGE_SIZE = 48`,
  `MEDIA_LIBRARY_KEY_PREFIX = "media/library/"`.
- `getMediaLibraryStatus({ expirationDate, hasBillingBypass, now }) → { state, purgeAt }`.
- `addOneCalendarMonthUtc(date)` (clamp de fim de mês).
- `canCustomerUpload(state)`, `canBackofficeUpload(state)`, `canViewLibrary(state)`.
- `buildMediaLibraryKey(userId, filename, randomSuffix)` (nome sanitizado, extensão do tipo) e
  `isMediaLibraryKeyOwnedBy(key, userId)`.
- `validateMediaLibraryUpload({ contentType, size })` → ok ou código de erro.

Cada app resolve `hasBillingBypass` com `process.env.BYPASS_STRIPE === "true" ||
isBypassStripeEmail(email)`.

## 6. APIs

### FE (dono = usuário da sessão)

| Rota | Faz | Regra |
|---|---|---|
| `GET /api/files/media-library?cursor=&type=all\|image\|video` | `{ items, nextCursor, library: { state, purgeAt } }` | `closed` → `items: []` |
| `POST /api/files/media-library/uploads` `{ filename, contentType, size }` | presigned PUT na chave da biblioteca | só `active`; tipo/tamanho válidos |
| `POST /api/files/media-library` `{ key, filename }` | confirma (prefixo, HEAD, tipo, tamanho, estado) e grava a linha; devolve o item | reprovou → apaga o objeto |
| `DELETE /api/files/media-library/[id]` | R2 e depois `deleted_at` + `deleted_reason='user'` | só o dono |
| `GET /api/files/media-library/[id]/download` | 302 para presigned GET (5 min, attachment, nome original) | só o dono; não em `closed` |

### BO (cliente = `[id]`, autorização por `requireMarketingUserAccessResponse`)

| Rota | Permissão | Regra |
|---|---|---|
| `GET /api/users/[id]/media-library?cursor=&type=` | `marketing:read` | itens + `uploadedByBackofficeEmail` + `library: { state, purgeAt, expirationDate }` |
| `POST /api/users/[id]/media-library/uploads` | `marketing:write` | `active` ou `grace` |
| `POST /api/users/[id]/media-library` | `marketing:write` | confirma como no FE + autor = ator + auditoria `media_library_add` |
| `DELETE /api/users/[id]/media-library/[mediaId]` | `marketing:write` | `deleted_reason='backoffice'` + auditoria `media_library_delete` |
| `GET /api/users/[id]/media-library/[mediaId]/download` | `marketing:read` | não em `closed` |

Item (os dois apps): `{ id, url, filename, contentType, isVideo, sizeBytes, createdAt,
uploadedBy: "customer" | "backoffice" }`; o BO acrescenta `uploadedByBackofficeEmail`.

Erros: estado recusado → 403 `{ code: "library_closed" | "subscription_required", message }`
(pt-BR); tipo/tamanho → 400 `{ code: "unsupported_type" | "file_too_large" }`; chave de outro
dono / objeto ausente → 400 `{ code: "invalid_upload" }`; R2 indisponível → 502 (tentável de
novo); falha ao apagar no R2 → 502 e a linha não é marcada.

## 7. UI

- **FE `components/media-library/`**: `media-library-grid` (modos seleção e gestão),
  `use-media-library` (lista, paginação, filtro, exclusão, estado), `use-media-library-upload`
  (presign → PUT com progresso → confirmação), `media-preview-dialog`. A página
  `/app/biblioteca-de-midias`, o `MultiMediaSelector` e o `MediaSourcePicker` usam essas peças.
  `DeviceMediaLibrary` e `DeviceUploadGrid` são removidos.
- **BO `app/(admin)/marketing/components/media-library/`**: as mesmas peças apontando para as
  rotas do BO (recebem `userId`), mais `media-library-card` no `MarketingWorkspace` e a aba
  "Biblioteca" no `MediaSourcePicker`.
- Data/hora no BO em America/Sao_Paulo (`datetime-format`); o FE mostra só a data.

## 8. Retenção (cron)

1. `checkCronAuth`. `BYPASS_STRIPE === "true"` → `{ skipped: true }`.
2. Candidatos: usuários com linha viva em `campaign_media` e `expiration_date IS NULL OR
   expiration_date < now() - interval '28 days'` (pré-filtro largo); a decisão final é
   `getMediaLibraryStatus(...).state === 'closed'`, com bypass por e-mail.
3. Por usuário, até o orçamento de tempo: chaves das linhas vivas (`mediaUrlToKey`; URL legada
   do Vercel Blob → `del` do Blob) + objetos listados no prefixo `media/library/<userId>/`;
   `DeleteObjects` em lotes de até 1000; marca como `retention` só as linhas cujas chaves não
   voltaram em `Errors`.
4. Responde `{ users, deletedRows, deletedObjects, failedKeys }` e loga.

## 9. Testes e verificação

- TDD por tarefa. Unidade: função de estado (limites exatos, fim de mês, nula, bypass), chave e
  posse, validação. Rotas FE/BO: posse, permissão, estado, HEAD reprovado, auditoria, autor,
  paginação. Cron: seleção, erro parcial do R2, órfãos, bypass. Paridade do módulo espelhado e
  do bypass. Journal de migração.
- Portões: suíte completa dos dois repos (`bun test --timeout 30000`, Postgres de teste na
  porta 55452) sem falha nova frente à base da mesma worktree; `tsc --noEmit`; lint por arquivo
  no BO. Base medida em 2026-10-13 nas worktrees (commit da `main`: FE `6f518c15`, BO
  `434b06a`): FE 3878 pass / 17 skip / 124 fail / 77 errors (48 testcases falhando no junit,
  todos de integração/ambiente); BO 1872 pass / 32 fail / 24 errors. A comparação é por nome de
  teste (junit).
- UI com agent-browser em toda tarefa de tela (página e sidebar FE, seletor FE, card BO, seletor
  BO), screenshots no workspace do plano. Estados `grace`/`closed` simulados numa conta de teste
  da allowlist na staging (restaurada no fim).
- Ambiente de verificação autorizado: migração aditiva aplicada no banco de **staging** (nunca
  produção); variáveis do R2 de staging puxadas da Vercel para arquivos locais ignorados; se o
  CORS do bucket recusar `localhost`, MinIO local (imagem oficial) com `MEDIA_R2_ENDPOINT`
  opcional (sem efeito quando ausente).

## 10. Fora de escopo

Cota de armazenamento por usuário; renomear mídia; pastas/tags; HEIC/WebP; aviso por e-mail
antes da exclusão; biblioteca por empresa; mover mídias legadas para o prefixo novo; limpar
órfãos de clientes ativos; remover o `MediaSelector` morto; aplicar migração em produção.
