# Biblioteca de mídias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a biblioteca de mídias do dispositivo (`blob_uploads`/`campaign_media`, hoje com 7 dias) numa Biblioteca de mídias permanente por usuário, com página própria no app, card e seletor no backoffice, autoria do admin, retenção atrelada ao acesso e seletores de campanha com IA refatorados nos dois apps.

**Architecture:** As regras puras (estado Ativa/Carência/Encerrada, limites, chave R2), o serviço com injeção de dependências, os handlers HTTP, o cliente de upload, os hooks React e os componentes de UI vivem em arquivos **espelhados byte a byte** do frontend para o backoffice (`MIRRORED_SOURCES` + `bun run sync:meta`, comparados por `tests/meta-duplicate-parity.test.ts`). Cada app só tem o que é seu: repositório Drizzle, fábrica de dependências, rotas (auth do cliente × RBAC do admin), auditoria (BO), cron de retenção (FE) e as telas que montam os componentes compartilhados.

**Tech Stack:** Next.js 16 (App Router), React 19, Drizzle 0.45 / Postgres, NextAuth v5, AWS SDK v3 (S3 → Cloudflare R2), next-intl (FE), shadcn/ui + Tailwind 4, `bun test` (`node:test` + `bun:test`), happy-dom + Testing Library (FE), agent-browser 0.38.1.

**Spec:** `docs/superpowers/specs/2026-10-13-media-library-design.md` (idêntico nos dois repos). Harness de verificação: `docs/superpowers/plans/2026-10-13-media-library/verification.md`.

## Global Constraints

- Worktrees: FE `D:\automatize-marketing\.worktrees\media-library\automatize-frontend`, BO `D:\automatize-marketing\.worktrees\media-library\backoffice`, branch `feat/media-library` nas duas. Nunca commitar na `main`; nunca `cd` para os checkouts principais.
- Package manager: **bun** apenas. Nada de npm/yarn.
- `blob_uploads.source = 'campaign_media'` é a biblioteca (nome histórico, não renomear).
- Estados: `active` (bypass, ou `expiration_date > now`), `grace` (`expiration_date <= now < purgeAt`), `closed` (`expiration_date` nula, ou `now >= purgeAt`); `purgeAt` = `expiration_date` + 1 mês de calendário em UTC com clamp de fim de mês.
- Upload: cliente só `active`; backoffice `active` ou `grace`; ninguém em `closed`. Em `closed` a lista vem vazia e o download é recusado.
- Tipos/limites: `image/jpeg`, `image/png` até **5 MB**; `video/mp4`, `video/quicktime`, `video/webm` até **300 MB**. `image/jpg` é normalizado para `image/jpeg`.
- Chave R2 nova: `media/library/<userId>/<slug>-<aleatório>.<ext>`.
- Página do FE: rota `/app/biblioteca-de-midias`, item "Biblioteca de mídias" (ícone lucide `Images`) logo abaixo de "Marketing".
- Card do BO "Biblioteca de mídias" no `MarketingWorkspace`, logo após "Detalhes do usuário". Abas: FE `MultiMediaSelector` → "Biblioteca de mídias"; FE `MediaSourcePicker` → "Biblioteca"; BO `MediaSourcePicker` → "Biblioteca".
- Cron: `/api/cron-job/media-library/retention`, `0 6 * * *` (06:00 UTC), `checkCronAuth`, `maxDuration = 300`, aceita `?dryRun=1`. **Contra a staging, só com `dryRun=1`** (a staging tem `BYPASS_STRIPE=false` e o S3 local aceita apagar chave inexistente — uma chamada real marcaria linhas de outros usuários).
- Migração gêmea: FE `0141_media_library` / BO `0132_media_library`, `when = 1802100000000`, mesmo SQL byte a byte (LF no arquivo; o checkout pode virar CRLF — os dois iguais).
- Textos de UI em pt-BR. FE via next-intl (`messages/pt-BR.json` e `messages/en.json`); BO e componentes espelhados com textos injetados (`MediaLibraryLabels`).
- FE segue `docs/DESIGN.md` (uma palavra em IvyMode itálico por título via `<Accent>`); sem scroll horizontal a 375 px.
- Testes: `node:test` + `node:assert/strict` (ou `bun:test` onde já é o padrão do arquivo vizinho). Rodar um arquivo: `bun test <caminho>`. Portão final por tarefa: arquivo(s) da tarefa verdes + `bunx tsc --noEmit -p .` sem erro novo (comparar com `support/compare-tsc.py`).
- FE: `docs/`, `scripts/`, `tests/` e `.scratch/` estão no `.gitignore`. Arquivo **novo** nessas pastas entra com `git add -f`; arquivo já versionado em `tests/` com `git add -u`. Depois de `tsc`/dev server: `git checkout -- tsconfig.tsbuildinfo next-env.d.ts` (o que existir) antes de commitar.
- Arquivos espelhados: editar **só no FE** e rodar `cd $FE && bun run sync:meta`; commitar os dois repos na mesma tarefa. Confira na saída do `sync:meta` que o destino é `.worktrees\media-library\backoffice`.
- Banco: **nunca** rodar `db:migrate`, `db:push`, `db:migrate:repair` nem `bun dev` no BO. Aplicar migração na staging é passo do orquestrador (O1), não de implementer.
- Verificação de UI: sempre agent-browser headless contra o app rodando, seguindo `verification.md`; screenshots em `docs/superpowers/plans/2026-10-13-media-library/evidence/` do repo dono da tela, nome `task-NN-<estado>.png`. Nunca publicar campanha.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **MIME vazio ou variante vindo do navegador** (Windows manda `""` para `.mov`, alguns mandam `image/jpg`): o esperado é normalizar `image/jpg` e mostrar "Formato não suportado" na linha do arquivo para tipo vazio, sem chamar o servidor. Testes: Tarefa 1 (normalização) e Tarefa 8 (linha de erro na fila).
2. **Nomes de arquivo com acento, emoji, caminho ou muito longos**: nome exibido limpo, chave R2 ASCII e download com o nome original. Testes: Tarefa 1 (`sanitizeMediaLibraryFilename`, `buildMediaLibraryPathname`) e Tarefa 3 (`buildAttachmentContentDisposition`).
3. **Confirmação repetida do mesmo upload** (duplo clique, retry de rede): nenhuma linha duplicada; a segunda confirmação devolve o mesmo item. Teste: Tarefa 4 (serviço devolve o registro existente) + revisão do `onConflictDoNothing` nos repositórios (Tarefas 5 e 7).
4. **Excluir uma mídia que está selecionada no seletor**: ela sai da seleção na hora. Teste: Tarefa 8 (painel chama `onDeleted`) + Tarefas 10 e 12 (consumidores removem da seleção).
5. **Paginação com uploads novos no topo**: "Carregar mais" depois de enviar mídias não duplica itens. Teste: Tarefa 4 (`mergeMediaLibraryPages`) + verificação com 50 itens semeados (Tarefa 9).

---

## Mapa de arquivos

**Espelhados (editar no FE; `sync:meta` copia para o BO):**
- `lib/media-library/policy.ts` — regras puras (estado, limites, chave, cursor, mensagens de erro).
- `lib/media-library/service.ts` — casos de uso (listar, pré-assinar, confirmar, excluir, baixar) com dependências injetadas.
- `lib/media-library/handlers.ts` — Request → serviço → NextResponse.
- `lib/media-library/storage.ts` — adaptador do serviço para `lib/storage/media-r2.ts`.
- `lib/media-library/client.ts` — fetch/XHR do navegador (endpoints, upload com progresso, download, exclusão).
- `lib/media-library/hooks.ts` — `useMediaLibrary`, `useMediaLibraryUpload`, `mergeMediaLibraryPages`.
- `lib/access/billing-bypass.ts` — já existe no FE; passa a existir igual no BO.
- `components/media-library/labels.ts`, `media-library-grid.tsx`, `media-preview-dialog.tsx`, `media-library-delete-dialog.tsx`, `media-library-upload-queue.tsx`, `media-library-panel.tsx`.

**Só FE:** `lib/media-library/repository.ts`, `lib/media-library/server.ts`, `lib/media-library/retention.ts`, `components/media-library/use-media-library-labels.ts`, rotas em `app/api/files/media-library/**`, cron em `app/api/cron-job/media-library/retention/route.ts`, página `app/app/(main)/biblioteca-de-midias/**`, ADR `docs/adr/0042-media-library-retention-by-access.md`.

**Só BO:** `lib/media-library/repository.ts`, `lib/media-library/server.ts`, `lib/media-library/audit.ts`, `lib/media-library/backoffice-context.ts`, rotas em `app/api/users/[id]/media-library/**`, `app/(admin)/marketing/components/media-library-card.tsx`.

**Removidos:** FE `components/media-selector/device-upload-grid.tsx`, `components/media-selector/device-media-library.tsx`, `lib/blob/device-media.ts`, `lib/blob/register-campaign-blob-upload.ts`, ação `register` de `app/api/files/upload/route.ts`; BO `lib/meta-business/marketing/cleanup-blob-after-meta.ts`, `app/(admin)/marketing/components/device-upload-tab.tsx`, `app/api/files/upload/route.ts`.

Variáveis de shell usadas nos passos:
```bash
FE=/d/automatize-marketing/.worktrees/media-library/automatize-frontend
BO=/d/automatize-marketing/.worktrees/media-library/backoffice
PLAN=$FE/docs/superpowers/plans/2026-10-13-media-library
BO_EVID=$BO/docs/superpowers/plans/2026-10-13-media-library/evidence
SCRATCH="C:/Users/rafae/AppData/Local/Temp/claude/D--automatize-marketing/e4b12813-4a56-4b63-80c0-6f66a437c3a9/scratchpad"
FIX="$SCRATCH/verification/fixtures"   # produto-roxo.png, produto-teste.jpg, video-curto.mp4, imagem-grande.png (17 MB)
```

---

### Task 1: Módulo de política e bypass espelhados

**Files:**
- Create: `$FE/lib/media-library/policy.ts`
- Create: `$FE/lib/media-library/policy.test.ts`
- Modify: `$FE/tests/helpers/source-parity.ts` (lista `MIRRORED_SOURCES`)
- Create (via sync): `$BO/lib/media-library/policy.ts`, `$BO/lib/access/billing-bypass.ts`

**Interfaces:**
- Produces (todas exportadas de `@/lib/media-library/policy`): constantes `MEDIA_LIBRARY_SOURCE`, `MEDIA_LIBRARY_KEY_PREFIX`, `MEDIA_LIBRARY_PAGE_SIZE` (48), `MEDIA_LIBRARY_IMAGE_TYPES`, `MEDIA_LIBRARY_VIDEO_TYPES`, `MEDIA_LIBRARY_ACCEPTED_TYPES`, `MEDIA_LIBRARY_ACCEPT_ATTRIBUTE`, `MEDIA_LIBRARY_MAX_IMAGE_BYTES`, `MEDIA_LIBRARY_MAX_VIDEO_BYTES`, `MEDIA_LIBRARY_ERROR_MESSAGES`; tipos `MediaLibraryContentType`, `MediaLibraryState`, `MediaLibraryStatus`, `MediaLibraryUploadErrorCode`, `MediaLibraryErrorCode`, `MediaLibraryClientErrorCode`, `MediaLibraryDeletedReason`, `MediaLibraryTypeFilter`, `MediaLibraryCursor`; funções `isUuidLike`, `normalizeMediaLibraryContentType`, `isMediaLibraryVideo`, `validateMediaLibraryUpload`, `addOneCalendarMonthUtc`, `getMediaLibraryStatus`, `canCustomerUpload`, `canBackofficeUpload`, `canViewLibrary`, `mediaLibraryUserPrefix`, `isMediaLibraryKeyOwnedBy`, `buildMediaLibraryPathname`, `sanitizeMediaLibraryFilename`, `parseMediaLibraryTypeFilter`, `encodeMediaLibraryCursor`, `parseMediaLibraryCursor`, `formatMediaLibraryBytes`, `isMediaLibraryClientErrorCode`.

- [ ] **Step 1: Escrever o teste que falha** — crie `$FE/lib/media-library/policy.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEDIA_LIBRARY_MAX_IMAGE_BYTES,
  MEDIA_LIBRARY_MAX_VIDEO_BYTES,
  addOneCalendarMonthUtc,
  buildMediaLibraryPathname,
  canBackofficeUpload,
  canCustomerUpload,
  canViewLibrary,
  encodeMediaLibraryCursor,
  formatMediaLibraryBytes,
  getMediaLibraryStatus,
  isMediaLibraryClientErrorCode,
  isMediaLibraryKeyOwnedBy,
  isMediaLibraryVideo,
  normalizeMediaLibraryContentType,
  parseMediaLibraryCursor,
  parseMediaLibraryTypeFilter,
  sanitizeMediaLibraryFilename,
  validateMediaLibraryUpload,
} from "./policy";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;

describe("addOneCalendarMonthUtc", () => {
  it("soma um mês preservando a hora", () => {
    assert.equal(
      addOneCalendarMonthUtc(new Date("2026-09-15T02:59:59.999Z")).toISOString(),
      "2026-10-15T02:59:59.999Z",
    );
  });
  it("faz clamp no fim do mês e respeita ano bissexto", () => {
    assert.equal(addOneCalendarMonthUtc(new Date("2026-01-31T10:00:00.000Z")).toISOString(), "2026-02-28T10:00:00.000Z");
    assert.equal(addOneCalendarMonthUtc(new Date("2028-01-31T10:00:00.000Z")).toISOString(), "2028-02-29T10:00:00.000Z");
    assert.equal(addOneCalendarMonthUtc(new Date("2026-03-31T10:00:00.000Z")).toISOString(), "2026-04-30T10:00:00.000Z");
  });
  it("vira o ano em dezembro", () => {
    assert.equal(addOneCalendarMonthUtc(new Date("2026-12-15T10:00:00.000Z")).toISOString(), "2027-01-15T10:00:00.000Z");
  });
});

describe("getMediaLibraryStatus", () => {
  it("bypass é sempre ativa, sem data de exclusão", () => {
    assert.deepEqual(getMediaLibraryStatus({ expirationDate: null, hasBillingBypass: true, now: NOW }), { state: "active", purgeAt: null });
  });
  it("expiração nula é encerrada", () => {
    assert.deepEqual(getMediaLibraryStatus({ expirationDate: null, hasBillingBypass: false, now: NOW }), { state: "closed", purgeAt: null });
  });
  it("expiração futura é ativa e informa a data de exclusão", () => {
    const status = getMediaLibraryStatus({ expirationDate: new Date(NOW.getTime() + 5 * DAY), hasBillingBypass: false, now: NOW });
    assert.equal(status.state, "active");
    assert.equal(status.purgeAt?.toISOString(), "2026-11-18T12:00:00.000Z");
  });
  it("expiração exatamente agora já não é ativa (carência)", () => {
    assert.equal(getMediaLibraryStatus({ expirationDate: NOW, hasBillingBypass: false, now: NOW }).state, "grace");
  });
  it("carência até 1 ms antes do purgeAt; encerrada no purgeAt", () => {
    const expirationDate = new Date("2026-09-13T12:00:00.000Z");
    const purgeAt = new Date("2026-10-13T12:00:00.000Z");
    assert.equal(getMediaLibraryStatus({ expirationDate, hasBillingBypass: false, now: new Date(purgeAt.getTime() - 1) }).state, "grace");
    assert.equal(getMediaLibraryStatus({ expirationDate, hasBillingBypass: false, now: purgeAt }).state, "closed");
  });
});

describe("permissões por estado", () => {
  it("cliente só sobe ativa; backoffice sobe ativa e carência; ninguém vê encerrada", () => {
    assert.deepEqual(["active", "grace", "closed"].map((s) => canCustomerUpload(s as never)), [true, false, false]);
    assert.deepEqual(["active", "grace", "closed"].map((s) => canBackofficeUpload(s as never)), [true, true, false]);
    assert.deepEqual(["active", "grace", "closed"].map((s) => canViewLibrary(s as never)), [true, true, false]);
  });
});

describe("tipos e tamanhos", () => {
  it("normaliza image/jpg e parâmetros; recusa tipo vazio", () => {
    assert.equal(normalizeMediaLibraryContentType("image/jpg"), "image/jpeg");
    assert.equal(normalizeMediaLibraryContentType("Image/PNG; charset=binary"), "image/png");
    assert.equal(normalizeMediaLibraryContentType(""), null);
    assert.equal(normalizeMediaLibraryContentType("text/plain"), null);
  });
  it("identifica vídeo", () => {
    assert.equal(isMediaLibraryVideo("video/quicktime"), true);
    assert.equal(isMediaLibraryVideo("image/png"), false);
    assert.equal(isMediaLibraryVideo(null), false);
  });
  it("valida limites", () => {
    assert.deepEqual(validateMediaLibraryUpload({ contentType: "image/jpg", size: 10 }), { ok: true, contentType: "image/jpeg" });
    assert.deepEqual(validateMediaLibraryUpload({ contentType: "image/png", size: MEDIA_LIBRARY_MAX_IMAGE_BYTES + 1 }), { ok: false, code: "file_too_large" });
    assert.deepEqual(validateMediaLibraryUpload({ contentType: "video/mp4", size: MEDIA_LIBRARY_MAX_VIDEO_BYTES }), { ok: true, contentType: "video/mp4" });
    assert.deepEqual(validateMediaLibraryUpload({ contentType: "image/png", size: 0 }), { ok: false, code: "empty_file" });
    assert.deepEqual(validateMediaLibraryUpload({ contentType: "", size: 10 }), { ok: false, code: "unsupported_type" });
  });
});

describe("chaves e nomes", () => {
  it("monta o caminho com slug ASCII e extensão do tipo", () => {
    assert.equal(buildMediaLibraryPathname(USER, "Foto Água Fresca!.JPG", "image/jpeg"), `library/${USER}/foto-agua-fresca.jpg`);
    assert.equal(buildMediaLibraryPathname(USER, "🧀.png", "image/png"), `library/${USER}/midia.png`);
    assert.equal(buildMediaLibraryPathname(USER, "C:\\fotos\\bolo.jpg", "image/png"), `library/${USER}/bolo.png`);
  });
  it("posse da chave", () => {
    assert.equal(isMediaLibraryKeyOwnedBy(`media/library/${USER}/a-123.png`, USER), true);
    assert.equal(isMediaLibraryKeyOwnedBy(`media/library/${USER}/sub/a.png`, USER), false);
    assert.equal(isMediaLibraryKeyOwnedBy(`media/library/${USER}/`, USER), false);
    assert.equal(isMediaLibraryKeyOwnedBy(`media/library/${USER}/../x.png`, USER), false);
    assert.equal(isMediaLibraryKeyOwnedBy("media/library/22222222-2222-4222-8222-222222222222/a.png", USER), false);
    assert.equal(isMediaLibraryKeyOwnedBy(`media/${USER}/a.png`, USER), false);
  });
  it("nome exibido sem caminho, sem controle e com no máximo 120 caracteres", () => {
    assert.equal(sanitizeMediaLibraryFilename("C:\\Users\\x\\Pão de queijo 🧀.jpg", "image/jpeg"), "Pão de queijo 🧀.jpg");
    assert.equal(sanitizeMediaLibraryFilename("  \u0007 ", "image/png"), "midia.png");
    const long = sanitizeMediaLibraryFilename(`${"a".repeat(200)}.mp4`, "video/mp4");
    assert.equal(long.length, 120);
    assert.ok(long.endsWith(".mp4"));
  });
});

describe("cursor, filtro, bytes e códigos", () => {
  it("cursor faz ida e volta; inválido é recusado; ausente é nulo", () => {
    const cursor = { createdAt: new Date("2026-10-01T10:00:00.123Z"), id: USER };
    assert.deepEqual(parseMediaLibraryCursor(encodeMediaLibraryCursor(cursor)), { ok: true, cursor });
    assert.deepEqual(parseMediaLibraryCursor(null), { ok: true, cursor: null });
    assert.deepEqual(parseMediaLibraryCursor("lixo!"), { ok: false });
    assert.deepEqual(parseMediaLibraryCursor(btoa("2026-10-01T10:00:00.000Z|nao-uuid")), { ok: false });
  });
  it("filtro de tipo cai em all", () => {
    assert.equal(parseMediaLibraryTypeFilter("video"), "video");
    assert.equal(parseMediaLibraryTypeFilter("x"), "all");
    assert.equal(parseMediaLibraryTypeFilter(null), "all");
  });
  it("formata bytes em pt-BR", () => {
    assert.equal(formatMediaLibraryBytes(null), "—");
    assert.equal(formatMediaLibraryBytes(512), "512 B");
    assert.equal(formatMediaLibraryBytes(1536), "1,5 KB");
    assert.equal(formatMediaLibraryBytes(300 * 1024 * 1024), "300 MB");
  });
  it("reconhece códigos de erro do cliente", () => {
    assert.equal(isMediaLibraryClientErrorCode("library_closed"), true);
    assert.equal(isMediaLibraryClientErrorCode("network_error"), true);
    assert.equal(isMediaLibraryClientErrorCode("toString"), false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd $FE && bun test lib/media-library/policy.test.ts`
Expected: FAIL — `Cannot find module './policy'`.

- [ ] **Step 3: Implementar** — crie `$FE/lib/media-library/policy.ts`:

```ts
/**
 * Biblioteca de mídias — regras puras compartilhadas pelo app e pelo backoffice.
 *
 * Espelhado BYTE A BYTE em ../backoffice (lista `MIRRORED_SOURCES` em
 * tests/helpers/source-parity.ts; `bun run sync:meta` copia). Sem I/O e sem
 * process.env: quem chama injeta o relógio e o bypass de cobrança. Também é
 * importado por componentes client (validação antes do upload).
 * Spec: docs/superpowers/specs/2026-10-13-media-library-design.md
 */

/** `blob_uploads.source` das linhas que formam a biblioteca (nome histórico). */
export const MEDIA_LIBRARY_SOURCE = "campaign_media";
/** Prefixo das chaves R2 enviadas pela biblioteca: `media/library/<userId>/...`. */
export const MEDIA_LIBRARY_KEY_PREFIX = "media/library/";
export const MEDIA_LIBRARY_PAGE_SIZE = 48;

export const MEDIA_LIBRARY_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export const MEDIA_LIBRARY_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const MEDIA_LIBRARY_ACCEPTED_TYPES = [
  ...MEDIA_LIBRARY_IMAGE_TYPES,
  ...MEDIA_LIBRARY_VIDEO_TYPES,
] as const;
/** Valor do atributo `accept` do input de arquivo. */
export const MEDIA_LIBRARY_ACCEPT_ATTRIBUTE = MEDIA_LIBRARY_ACCEPTED_TYPES.join(",");
export const MEDIA_LIBRARY_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MEDIA_LIBRARY_MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export type MediaLibraryContentType = (typeof MEDIA_LIBRARY_ACCEPTED_TYPES)[number];
export type MediaLibraryState = "active" | "grace" | "closed";
export type MediaLibraryStatus = { state: MediaLibraryState; purgeAt: Date | null };
export type MediaLibraryUploadErrorCode = "unsupported_type" | "file_too_large" | "empty_file";
export type MediaLibraryErrorCode =
  | "not_found"
  | "library_closed"
  | "subscription_required"
  | MediaLibraryUploadErrorCode
  | "invalid_upload"
  | "invalid_cursor"
  | "storage_unavailable";
export type MediaLibraryClientErrorCode = MediaLibraryErrorCode | "network_error" | "upload_failed";
export type MediaLibraryDeletedReason = "user" | "backoffice" | "retention";
export type MediaLibraryTypeFilter = "all" | "image" | "video";
export type MediaLibraryCursor = { createdAt: Date; id: string };

export const MEDIA_LIBRARY_ERROR_MESSAGES: Record<MediaLibraryClientErrorCode, string> = {
  not_found: "Mídia ou cliente não encontrado.",
  library_closed: "A biblioteca está encerrada: o acesso expirou há mais de 1 mês.",
  subscription_required: "A assinatura expirou. Renove para enviar novas mídias.",
  unsupported_type: "Formato não suportado. Use JPG, PNG, MP4, MOV ou WEBM.",
  file_too_large: "Arquivo acima do limite (imagens até 5 MB, vídeos até 300 MB).",
  empty_file: "O arquivo está vazio.",
  invalid_upload: "Upload inválido. Envie a mídia novamente.",
  invalid_cursor: "Página inválida.",
  storage_unavailable: "Armazenamento indisponível. Tente novamente em instantes.",
  network_error: "Falha de conexão. Verifique a internet e tente de novo.",
  upload_failed: "Não foi possível enviar o arquivo. Tente de novo.",
};

const EXTENSION_BY_TYPE: Record<MediaLibraryContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function normalizeMediaLibraryContentType(
  value: string | null | undefined,
): MediaLibraryContentType | null {
  if (!value) return null;
  const base = value.split(";")[0]?.trim().toLowerCase() ?? "";
  const canonical = base === "image/jpg" || base === "image/pjpeg" ? "image/jpeg" : base;
  return (MEDIA_LIBRARY_ACCEPTED_TYPES as readonly string[]).includes(canonical)
    ? (canonical as MediaLibraryContentType)
    : null;
}

export function isMediaLibraryVideo(contentType: string | null | undefined): boolean {
  const normalized = normalizeMediaLibraryContentType(contentType);
  return (
    normalized !== null &&
    (MEDIA_LIBRARY_VIDEO_TYPES as readonly string[]).includes(normalized)
  );
}

export function validateMediaLibraryUpload(input: {
  contentType: string | null | undefined;
  size: number;
}):
  | { ok: true; contentType: MediaLibraryContentType }
  | { ok: false; code: MediaLibraryUploadErrorCode } {
  const contentType = normalizeMediaLibraryContentType(input.contentType);
  if (!contentType) return { ok: false, code: "unsupported_type" };
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, code: "empty_file" };
  }
  const max = isMediaLibraryVideo(contentType)
    ? MEDIA_LIBRARY_MAX_VIDEO_BYTES
    : MEDIA_LIBRARY_MAX_IMAGE_BYTES;
  if (input.size > max) return { ok: false, code: "file_too_large" };
  return { ok: true, contentType };
}

/** Mesmo dia do mês seguinte em UTC; dia inexistente vira o último dia do mês. */
export function addOneCalendarMonthUtc(date: Date): Date {
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + 1;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      targetMonth,
      Math.min(date.getUTCDate(), lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function getMediaLibraryStatus(input: {
  expirationDate: Date | null;
  hasBillingBypass: boolean;
  now: Date;
}): MediaLibraryStatus {
  if (input.hasBillingBypass) return { state: "active", purgeAt: null };
  if (!input.expirationDate) return { state: "closed", purgeAt: null };
  const purgeAt = addOneCalendarMonthUtc(input.expirationDate);
  if (input.expirationDate.getTime() > input.now.getTime()) {
    return { state: "active", purgeAt };
  }
  return {
    state: input.now.getTime() < purgeAt.getTime() ? "grace" : "closed",
    purgeAt,
  };
}

export function canCustomerUpload(state: MediaLibraryState): boolean {
  return state === "active";
}

export function canBackofficeUpload(state: MediaLibraryState): boolean {
  return state !== "closed";
}

export function canViewLibrary(state: MediaLibraryState): boolean {
  return state !== "closed";
}

export function mediaLibraryUserPrefix(userId: string): string {
  return `${MEDIA_LIBRARY_KEY_PREFIX}${userId}/`;
}

/** A chave pertence ao prefixo do dono e não tem subpastas nem `..`. */
export function isMediaLibraryKeyOwnedBy(key: string, userId: string): boolean {
  if (!userId || key.includes("..")) return false;
  const prefix = mediaLibraryUserPrefix(userId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

function lastPathSegment(filename: string): string {
  return filename.split(/[\\/]/).pop() ?? "";
}

function slugifyBaseName(filename: string): string {
  const last = lastPathSegment(filename);
  const dot = last.lastIndexOf(".");
  const base = dot > 0 ? last.slice(0, dot) : last;
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Caminho (sem `media/`) passado ao presign. O storage acrescenta
 * `-<aleatório>` antes da extensão, então a chave final é
 * `media/library/<userId>/<slug>-<aleatório>.<ext>`.
 */
export function buildMediaLibraryPathname(
  userId: string,
  filename: string,
  contentType: MediaLibraryContentType,
): string {
  const slug = slugifyBaseName(filename) || "midia";
  return `library/${userId}/${slug}.${EXTENSION_BY_TYPE[contentType]}`;
}

/** Nome mostrado: só o arquivo, sem caracteres de controle, até 120 caracteres. */
export function sanitizeMediaLibraryFilename(
  filename: string,
  contentType: MediaLibraryContentType,
): string {
  const clean = lastPathSegment(filename)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return `midia.${EXTENSION_BY_TYPE[contentType]}`;
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf(".");
  const extension = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : "";
  return `${clean.slice(0, 120 - extension.length)}${extension}`;
}

export function parseMediaLibraryTypeFilter(
  value: string | null | undefined,
): MediaLibraryTypeFilter {
  return value === "image" || value === "video" ? value : "all";
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeMediaLibraryCursor(cursor: MediaLibraryCursor): string {
  return toBase64Url(`${cursor.createdAt.toISOString()}|${cursor.id}`);
}

export function parseMediaLibraryCursor(
  value: string | null | undefined,
): { ok: true; cursor: MediaLibraryCursor | null } | { ok: false } {
  if (!value) return { ok: true, cursor: null };
  try {
    const [iso, id, extra] = fromBase64Url(value).split("|");
    const createdAt = new Date(iso ?? "");
    if (extra !== undefined || !id || !isUuidLike(id) || Number.isNaN(createdAt.getTime())) {
      return { ok: false };
    }
    return { ok: true, cursor: { createdAt, id } };
  } catch {
    return { ok: false };
  }
}

export function formatMediaLibraryBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = value.toLocaleString("pt-BR", {
    maximumFractionDigits: value < 10 ? 1 : 0,
  });
  return `${formatted} ${units[unit]}`;
}

export function isMediaLibraryClientErrorCode(
  value: unknown,
): value is MediaLibraryClientErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MEDIA_LIBRARY_ERROR_MESSAGES, value)
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd $FE && bun test lib/media-library/policy.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Registrar os espelhos** — em `$FE/tests/helpers/source-parity.ts`, acrescente ao fim do array `MIRRORED_SOURCES` (depois de `"lib/meta-business/cbo-dayparting-release.ts",`):

```ts
  // Biblioteca de mídias (spec 2026-10-13): regras, serviço, handlers, cliente,
  // hooks e UI idênticos nos dois painéis — o admin vê e mexe na mesma
  // biblioteca que o cliente, com as mesmas regras de estado.
  "lib/access/billing-bypass.ts",
  "lib/media-library/policy.ts",
```

- [ ] **Step 6: Espelhar e conferir a paridade**

Run: `cd $FE && bun run sync:meta && bun test tests/meta-duplicate-parity.test.ts`
Expected: a saída do sync mostra `synced  lib/access/billing-bypass.ts -> ...\.worktrees\media-library\backoffice\lib\access\billing-bypass.ts` e o mesmo para `policy.ts`; o teste de paridade PASS.

- [ ] **Step 7: Commit (dois repos)**

```bash
cd $FE && git add -f tests/helpers/source-parity.ts && git add lib/media-library/policy.ts lib/media-library/policy.test.ts && git commit -m "feat(biblioteca): regras puras da Biblioteca de mídias espelhadas no backoffice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add lib/media-library/policy.ts lib/access/billing-bypass.ts && git commit -m "feat(biblioteca): espelho das regras da Biblioteca de mídias e do bypass de cobrança

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Se `tests/helpers/source-parity.ts` já for versionado, `git add -u tests/helpers/source-parity.ts` também serve.)

---

### Task 2: Migração gêmea e colunas no schema

**Files:**
- Create: `$FE/lib/db/migrations/0141_media_library.sql`, `$BO/lib/db/migrations/0132_media_library.sql` (bytes idênticos)
- Modify: `$FE/lib/db/migrations/meta/_journal.json`, `$BO/lib/db/migrations/meta/_journal.json`
- Modify: `$FE/lib/db/schema.ts` (tabela `blobUpload`, ~linha 223) e `$BO/lib/db/schema.ts` (~linha 373)
- Create: `$FE/lib/media-library/migration.test.ts`

**Interfaces:**
- Produces: colunas Drizzle `blobUpload.sizeBytes` (`number | null`), `blobUpload.uploadedByBackofficeEmail` (`string | null`), `blobUpload.deletedReason` (`string | null`) nos dois `schema.ts`; índice `blob_uploads_media_library_idx`.

- [ ] **Step 1: Teste que falha** — crie `$FE/lib/media-library/migration.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { readBackofficeFile } from "../../tests/helpers/backoffice-root";
import { blobUpload } from "../db/schema";

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const FE_SQL = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations", "0141_media_library.sql");

describe("migração 0141/0132 da Biblioteca de mídias", () => {
  it("o SQL é o mesmo nos dois repos e só adiciona", () => {
    const fe = lf(readFileSync(FE_SQL, "utf8"));
    const bo = lf(readBackofficeFile("lib/db/migrations/0132_media_library.sql"));
    assert.equal(fe, bo);
    assert.match(fe, /ADD COLUMN IF NOT EXISTS "size_bytes" bigint/);
    assert.match(fe, /ADD COLUMN IF NOT EXISTS "uploaded_by_backoffice_email" varchar\(255\)/);
    assert.match(fe, /ADD COLUMN IF NOT EXISTS "deleted_reason" varchar\(20\)/);
    assert.match(fe, /CREATE INDEX IF NOT EXISTS "blob_uploads_media_library_idx"/);
    assert.doesNotMatch(fe, /\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE)\b/i);
  });

  it("os dois journals registram o mesmo when, acima de todos os anteriores", () => {
    const feJournal = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations", "meta", "_journal.json"), "utf8"));
    const boJournal = JSON.parse(readBackofficeFile("lib/db/migrations/meta/_journal.json"));
    const fe = feJournal.entries.find((e: { tag: string }) => e.tag === "0141_media_library");
    const bo = boJournal.entries.find((e: { tag: string }) => e.tag === "0132_media_library");
    assert.equal(fe?.when, 1802100000000);
    assert.equal(bo?.when, 1802100000000);
    const othersMax = Math.max(
      ...feJournal.entries.filter((e: { tag: string }) => e !== fe).map((e: { when: number }) => e.when),
      ...boJournal.entries.filter((e: { tag: string }) => e !== bo).map((e: { when: number }) => e.when),
    );
    assert.ok(fe.when > othersMax);
  });

  it("o schema do app conhece as colunas novas", () => {
    assert.equal(blobUpload.sizeBytes.name, "size_bytes");
    assert.equal(blobUpload.uploadedByBackofficeEmail.name, "uploaded_by_backoffice_email");
    assert.equal(blobUpload.deletedReason.name, "deleted_reason");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd $FE && BACKOFFICE_ROOT=$BO bun test lib/media-library/migration.test.ts`
Expected: FAIL — ENOENT em `0141_media_library.sql`.

- [ ] **Step 3: Escrever o SQL** — crie `$FE/lib/db/migrations/0141_media_library.sql` com exatamente:

```sql
-- Biblioteca de mídias (spec 2026-10-13): quem subiu (admin do backoffice ou o
-- próprio cliente), tamanho lido do R2 e motivo da exclusão. Só colunas novas e
-- nulas — nenhuma linha existente é reescrita.
-- Shared FE 0141 / BO 0132, same `when` (1802100000000): first apply wins.

ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "uploaded_by_backoffice_email" varchar(255);--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "deleted_reason" varchar(20);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blob_uploads_media_library_idx" ON "blob_uploads" USING btree ("user_id","created_at" DESC,"id" DESC) WHERE "source" = 'campaign_media' AND "deleted_at" IS NULL;
```

Copie o arquivo para o BO (mesmos bytes) e confira:
```bash
cp $FE/lib/db/migrations/0141_media_library.sql $BO/lib/db/migrations/0132_media_library.sql
cmp $FE/lib/db/migrations/0141_media_library.sql $BO/lib/db/migrations/0132_media_library.sql && echo identicos
```

- [ ] **Step 4: Journals** — acrescente ao fim de `entries` em `$FE/lib/db/migrations/meta/_journal.json` (depois do objeto de `0140_company_module_entitlements`, mantendo a vírgula):

```json
    {
      "idx": 144,
      "version": "7",
      "when": 1802100000000,
      "tag": "0141_media_library",
      "breakpoints": true
    }
```
e em `$BO/lib/db/migrations/meta/_journal.json` (depois de `0131_company_module_entitlements`):
```json
    {
      "idx": 132,
      "version": "7",
      "when": 1802100000000,
      "tag": "0132_media_library",
      "breakpoints": true
    }
```
Mantenha a indentação e o formato existentes do arquivo (2 espaços).

- [ ] **Step 5: Schema FE** — em `$FE/lib/db/schema.ts`:
  1. No import de `drizzle-orm/pg-core` (linhas 2–20) acrescente `bigint,` (ordem alfabética, antes de `bigserial,`).
  2. Substitua a definição de `blobUpload` por:

```ts
export const blobUpload = pgTable(
  "blob_uploads",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    blobUrl: text("blob_url").notNull(),
    pathname: text("pathname"),
    filename: text("filename"),
    contentType: text("content_type"),
    source: varchar("source", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
    /** Biblioteca de mídias: tamanho lido do HEAD do R2 na confirmação. */
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Admin do backoffice que subiu a mídia; nulo = o próprio cliente. */
    uploadedByBackofficeEmail: varchar("uploaded_by_backoffice_email", { length: 255 }),
    /** `user` | `backoffice` | `retention` (ver lib/media-library/policy.ts). */
    deletedReason: varchar("deleted_reason", { length: 20 }),
  },
  (table) => ({
    blobUrlUnique: uniqueIndex("blob_uploads_blob_url_unique").on(
      table.blobUrl,
    ),
    mediaLibraryIdx: index("blob_uploads_media_library_idx")
      .on(table.userId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.source} = 'campaign_media' AND ${table.deletedAt} IS NULL`),
  }),
);
```

- [ ] **Step 6: Schema BO** — em `$BO/lib/db/schema.ts`: acrescente `bigint,` ao import de `drizzle-orm/pg-core` e substitua `blobUpload` pelo MESMO bloco do Step 5 (o BO não declarava o índice único que já existe no banco — passa a declarar, sem efeito em runtime).

- [ ] **Step 7: Rodar e ver passar**

Run: `cd $FE && BACKOFFICE_ROOT=$BO bun test lib/media-library/migration.test.ts`
Expected: PASS.
Run: `cd $BO && FRONTEND_ROOT=$FE bun test tests/migration-journal.test.ts`
Expected: as MESMAS 2 falhas da base (`0110`/`0116` e `0116`/`0121`) e nenhuma outra.

- [ ] **Step 8: tsc dos dois** — `cd $FE && bunx tsc --noEmit -p . > /tmp/fe-tsc.txt; python $PLAN/support/compare-tsc.py $PLAN/evidence/baseline/fe-tsc.txt /tmp/fe-tsc.txt` e o mesmo no BO com `$BO/docs/superpowers/plans/2026-10-13-media-library/evidence/baseline/bo-tsc.txt`. Expected: `novos: 0` nos dois. Depois `git checkout -- tsconfig.tsbuildinfo` nos dois.

- [ ] **Step 9: Commit (dois repos)**

```bash
cd $FE && git add lib/db/schema.ts lib/db/migrations/0141_media_library.sql lib/db/migrations/meta/_journal.json lib/media-library/migration.test.ts && git commit -m "feat(biblioteca): colunas de autoria, tamanho e motivo de exclusão em blob_uploads (0141)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add lib/db/schema.ts lib/db/migrations/0132_media_library.sql lib/db/migrations/meta/_journal.json && git commit -m "feat(biblioteca): espelho da migração 0132 e do schema de blob_uploads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Passo do orquestrador O1 (não é tarefa de implementer): aplicar a migração na staging

O orquestrador aplica **só** o SQL de `0141_media_library.sql` (idempotente) no banco de staging,
sem gravar em `drizzle.__drizzle_migrations` (não mexe na marca d'água; o `db:migrate` real do
deploy aplica/registra depois sem erro por causa do `IF NOT EXISTS`), e confere em
`information_schema.columns` as 3 colunas e em `pg_indexes` o índice. O script recusa qualquer
`POSTGRES_URL` que não contenha `wsbsnzgzqiehqnklzchm`.

---

### Task 3: Storage R2 — endpoint opcional, download assinado, exclusão com erro por chave, listagem

**Files:**
- Modify: `$FE/lib/storage/media-r2.ts`, `$BO/lib/storage/media-r2.ts`
- Create: `$FE/lib/storage/media-r2-library.test.ts`, `$FE/lib/storage/media-r2.localstack.test.ts`
- Create: `$BO/lib/storage/media-r2-library.test.ts`

**Interfaces:**
- Produces (nos DOIS `media-r2.ts`, mesmos nomes e assinaturas):
  - `resolveMediaR2ClientOptions(accountId: string, env?: NodeJS.ProcessEnv): { endpoint: string; forcePathStyle: boolean }`
  - `buildAttachmentContentDisposition(filename: string): string`
  - `createMediaDownloadUrl(input: { objectKey: string; filename: string; contentType: string | null; expiresInSeconds?: number }): Promise<string>`
  - `deleteMediaObjectKeysReportingErrors(objectKeys: string[]): Promise<{ deletedKeys: string[]; failed: { key: string; message: string }[] }>`
  - `listMediaObjectKeys(prefix: string): Promise<string[]>`
- Consumes: as funções já existentes `getConfig`, `getClient`, `isMediaR2Configured`, `isMediaDevLocalStorageEnabled`, `getDevLocalStorageRoots`, `getLocalMediaPath`, `getMediaPublicUrl`, `MEDIA_KEY_PREFIX`, `MEDIA_R2_NOT_CONFIGURED_MESSAGE` de cada arquivo. **No BO os nomes internos podem diferir um pouco** — leia o arquivo e use os equivalentes (ex.: se não houver `getDevLocalStorageRoots`, use o caminho de raiz local que o BO já usa em `putMediaObject`).

- [ ] **Step 1: Teste puro que falha** — crie `$FE/lib/storage/media-r2-library.test.ts` (e uma cópia idêntica em `$BO/lib/storage/media-r2-library.test.ts`):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttachmentContentDisposition,
  resolveMediaR2ClientOptions,
} from "./media-r2";

describe("resolveMediaR2ClientOptions", () => {
  it("usa o endpoint da conta R2 por padrão", () => {
    assert.deepEqual(resolveMediaR2ClientOptions("abc123", {}), {
      endpoint: "https://abc123.r2.cloudflarestorage.com",
      forcePathStyle: false,
    });
  });
  it("MEDIA_R2_ENDPOINT troca o endpoint e liga path-style (S3 local)", () => {
    assert.deepEqual(
      resolveMediaR2ClientOptions("abc123", { MEDIA_R2_ENDPOINT: " http://localhost:4566 " }),
      { endpoint: "http://localhost:4566", forcePathStyle: true },
    );
  });
});

describe("buildAttachmentContentDisposition", () => {
  it("mantém o nome original em UTF-8 e um fallback ASCII", () => {
    assert.equal(
      buildAttachmentContentDisposition("Pão de queijo (1).jpg"),
      `attachment; filename="Pao de queijo (1).jpg"; filename*=UTF-8''P%C3%A3o%20de%20queijo%20%281%29.jpg`,
    );
  });
  it("neutraliza aspas, barras e emoji no fallback", () => {
    assert.equal(
      buildAttachmentContentDisposition('a"b\\c🧀.png'),
      `attachment; filename="a_b_c__.png"; filename*=UTF-8''a%22b%5Cc%F0%9F%A7%80.png`,
    );
  });
  it("nome vazio vira midia", () => {
    assert.match(buildAttachmentContentDisposition("   "), /^attachment; filename="midia"/);
  });
});
```

Run: `cd $FE && bun test lib/storage/media-r2-library.test.ts` → Expected: FAIL (`resolveMediaR2ClientOptions` não exportado). Idem no BO.

- [ ] **Step 2: Implementar no FE** — em `$FE/lib/storage/media-r2.ts`:
  1. No import de `@aws-sdk/client-s3` acrescente `ListObjectsV2Command,` e no de `node:fs/promises` acrescente `readdir,`.
  2. Logo depois de `getConfig()`, adicione e use no `getClient`:

```ts
/**
 * Endpoint do S3 da Cloudflare. `MEDIA_R2_ENDPOINT` existe só para verificação
 * local (S3 compatível, ex. LocalStack) e liga path-style; ausente = R2 real.
 */
export function resolveMediaR2ClientOptions(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): { endpoint: string; forcePathStyle: boolean } {
  const override = env.MEDIA_R2_ENDPOINT?.trim();
  if (override) return { endpoint: override, forcePathStyle: true };
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: false,
  };
}

function getClient(config: MediaR2Config) {
  const { endpoint, forcePathStyle } = resolveMediaR2ClientOptions(config.accountId);
  client ??= new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}
```
(substitui o `getClient` antigo.)
  3. Ao fim do arquivo, acrescente:

```ts
function toMediaKey(objectKey: string): string {
  return objectKey.startsWith(MEDIA_KEY_PREFIX) ? objectKey : `${MEDIA_KEY_PREFIX}${objectKey}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition` de download com nome original (RFC 6266/5987). */
export function buildAttachmentContentDisposition(filename: string): string {
  const original = filename.trim() || "midia";
  const fallback =
    original
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "midia";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(original)}`;
}

/**
 * URL assinada (GET) que baixa o objeto com o nome original — o navegador não
 * navega, só baixa. Sem R2 no dev local, devolve a URL pública.
 */
export async function createMediaDownloadUrl(input: {
  objectKey: string;
  filename: string;
  contentType: string | null;
  expiresInSeconds?: number;
}): Promise<string> {
  const key = toMediaKey(input.objectKey);
  if (key.includes("..")) throw new Error(`invalid_media_key: ${input.objectKey}`);
  if (isMediaR2Configured()) {
    const config = getConfig();
    return getSignedUrl(
      getClient(config),
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: buildAttachmentContentDisposition(input.filename),
        ...(input.contentType ? { ResponseContentType: input.contentType } : {}),
      }),
      { expiresIn: input.expiresInSeconds ?? 300 },
    );
  }
  if (isMediaDevLocalStorageEnabled()) return getMediaPublicUrl(key);
  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/**
 * Como `delMediaObjectKeys`, mas devolve o que falhou chave a chave:
 * `DeleteObjects` reporta erros por chave em `Errors` SEM lançar — ignorar isso
 * marcava como apagado o que continuava no bucket. Chave ausente não é erro.
 */
export async function deleteMediaObjectKeysReportingErrors(
  objectKeys: string[],
): Promise<{ deletedKeys: string[]; failed: { key: string; message: string }[] }> {
  const keys = [
    ...new Set(
      objectKeys
        .map(toMediaKey)
        .filter((key) => key !== MEDIA_KEY_PREFIX && !key.includes("..")),
    ),
  ];
  if (keys.length === 0) return { deletedKeys: [], failed: [] };

  if (isMediaR2Configured()) {
    const config = getConfig();
    const failed: { key: string; message: string }[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      try {
        const result = await getClient(config).send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        for (const error of result.Errors ?? []) {
          if (error.Key) {
            failed.push({
              key: error.Key,
              message: error.Message ?? error.Code ?? "delete_failed",
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "delete_failed";
        for (const key of batch) failed.push({ key, message });
      }
    }
    const failedKeys = new Set(failed.map((entry) => entry.key));
    return { deletedKeys: keys.filter((key) => !failedKeys.has(key)), failed };
  }

  if (isMediaDevLocalStorageEnabled()) {
    for (const key of keys) {
      for (const root of getDevLocalStorageRoots()) {
        const filePath = getLocalMediaPath(root, key);
        await rm(filePath, { force: true });
        await rm(`${filePath}.meta.json`, { force: true });
      }
    }
    return { deletedKeys: keys, failed: [] };
  }

  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}

/** Todas as chaves sob um prefixo (`media/...`), paginando o ListObjectsV2. */
export async function listMediaObjectKeys(prefix: string): Promise<string[]> {
  const normalizedPrefix = toMediaKey(prefix);
  if (normalizedPrefix.includes("..") || normalizedPrefix === MEDIA_KEY_PREFIX) {
    throw new Error(`invalid_media_prefix: ${prefix}`);
  }
  if (isMediaR2Configured()) {
    const config = getConfig();
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await getClient(config).send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: normalizedPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }
  if (isMediaDevLocalStorageEnabled()) {
    const keys = new Set<string>();
    for (const root of getDevLocalStorageRoots()) {
      const directory = getLocalMediaPath(root, normalizedPrefix);
      const entries = await readdir(directory, { recursive: true }).catch(() => []);
      for (const entry of entries) {
        const relative = String(entry).replace(/\\/g, "/");
        if (!relative.endsWith(".meta.json")) keys.add(`${normalizedPrefix}${relative}`);
      }
    }
    return [...keys];
  }
  throw new Error(MEDIA_R2_NOT_CONFIGURED_MESSAGE);
}
```

- [ ] **Step 3: Implementar no BO** — aplique as MESMAS três mudanças em `$BO/lib/storage/media-r2.ts` (imports, `resolveMediaR2ClientOptions` + `getClient`, bloco final). Ajuste só os nomes internos que forem diferentes no BO (leia o arquivo antes). Não mude o comportamento das funções existentes.

- [ ] **Step 4: Rodar os testes puros**

Run: `cd $FE && bun test lib/storage/media-r2-library.test.ts lib/storage/media-r2.test.ts` → Expected: PASS.
Run: `cd $BO && bun test lib/storage/media-r2-library.test.ts lib/storage/media-r2.test.ts` → Expected: PASS.

- [ ] **Step 5: Teste de integração contra o S3 local (opt-in)** — crie `$FE/lib/storage/media-r2.localstack.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

/**
 * Só roda com MEDIA_LOCALSTACK_TEST=1 e o LocalStack de
 * docs/superpowers/plans/2026-10-13-media-library/verification.md no ar.
 */
const enabled = process.env.MEDIA_LOCALSTACK_TEST === "1";
const KEYS = [
  "CLOUDFLARE_R2_ACCOUNT_ID",
  "MEDIA_R2_ENDPOINT",
  "MEDIA_R2_BUCKET",
  "MEDIA_R2_ACCESS_KEY_ID",
  "MEDIA_R2_SECRET_ACCESS_KEY",
  "MEDIA_PUBLIC_BASE_URL",
] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

describe("media-r2 contra LocalStack", { skip: !enabled }, () => {
  before(() => {
    for (const key of KEYS) saved[key] = process.env[key];
    Object.assign(process.env, {
      CLOUDFLARE_R2_ACCOUNT_ID: "localstack",
      MEDIA_R2_ENDPOINT: "http://localhost:4566",
      MEDIA_R2_BUCKET: "automatize-media-local",
      MEDIA_R2_ACCESS_KEY_ID: "localstackmediakey",
      MEDIA_R2_SECRET_ACCESS_KEY: "localstackmediasecretlocalonly",
      MEDIA_PUBLIC_BASE_URL: "http://automatize-media-local.s3.localhost.localstack.cloud:4566",
    });
  });
  after(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("presign PUT → HEAD → download com nome → listagem → exclusão por chave", async () => {
    const r2 = await import("./media-r2");
    const owner = `test-${Date.now()}`;
    const presigned = await r2.createMediaUploadUrl({ pathname: `library/${owner}/foto.png`, contentType: "image/png" });
    const put = await fetch(presigned.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array([137, 80, 78, 71]) });
    assert.equal(put.status, 200);

    const head = await r2.headMediaObject(presigned.url);
    assert.equal(head.size, 4);
    assert.equal(head.contentType, "image/png");

    const key = `media/${presigned.pathname}`;
    const downloadUrl = await r2.createMediaDownloadUrl({ objectKey: key, filename: "Pão.png", contentType: "image/png" });
    const download = await fetch(downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /filename\*=UTF-8''P%C3%A3o\.png/);

    assert.deepEqual(await r2.listMediaObjectKeys(`media/library/${owner}/`), [key]);
    const deleted = await r2.deleteMediaObjectKeysReportingErrors([key, `media/library/${owner}/nao-existe.png`]);
    assert.equal(deleted.failed.length, 0);
    assert.deepEqual(await r2.listMediaObjectKeys(`media/library/${owner}/`), []);
  });
});
```

Run (LocalStack no ar, ver `verification.md` §1): `cd $FE && MEDIA_LOCALSTACK_TEST=1 bun test lib/storage/media-r2.localstack.test.ts`
Expected: PASS. Sem a variável: `bun test lib/storage/media-r2.localstack.test.ts` → 1 skip.
Guarde a saída em `$PLAN/evidence/task-03-localstack.txt`.

- [ ] **Step 6: tsc dos dois sem erro novo** (comando do Step 8 da Tarefa 2).

- [ ] **Step 7: Commit (dois repos)**

```bash
cd $FE && git add lib/storage/media-r2.ts lib/storage/media-r2-library.test.ts lib/storage/media-r2.localstack.test.ts && git add -f docs/superpowers/plans/2026-10-13-media-library/evidence/task-03-localstack.txt && git commit -m "feat(storage): download assinado, exclusão com erro por chave e listagem no R2 de mídia

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add lib/storage/media-r2.ts lib/storage/media-r2-library.test.ts && git commit -m "feat(storage): download assinado, exclusão com erro por chave e listagem no R2 de mídia

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Serviço, handlers, adaptador de storage, cliente e hooks (espelhados)

**Files:**
- Create: `$FE/lib/media-library/service.ts`, `handlers.ts`, `storage.ts`, `client.ts`, `hooks.ts`
- Create: `$FE/lib/media-library/service.test.ts`, `handlers.test.ts`, `hooks.test.ts`
- Modify: `$FE/tests/helpers/source-parity.ts` (acrescentar os 5 arquivos)
- Create (via sync): os mesmos 5 arquivos em `$BO/lib/media-library/`

**Interfaces:**
- Consumes: tudo de `@/lib/media-library/policy` (Tarefa 1); do `@/lib/storage/media-r2` (Tarefa 3): `createMediaUploadUrl`, `getMediaPublicUrl`, `headMediaObject`, `MediaObjectNotFoundError`, `mediaUrlToKey`, `delMediaObjects`, `deleteMediaObjectKeysReportingErrors`, `createMediaDownloadUrl`, `listMediaObjectKeys`. Os dois `media-r2.ts` precisam exportar TODOS esses nomes; se o do BO não exportar algum (ex.: `MediaObjectNotFoundError` ou `mediaUrlToKey`), exporte-o no `media-r2.ts` do BO — nunca edite o espelho só de um lado.
- Produces:
  - `service.ts`: tipos `MediaLibraryActor`, `MediaLibraryOwner`, `MediaLibraryRecord`, `NewMediaLibraryRecord`, `MediaLibraryItem`, `MediaLibrarySummary`, `MediaLibraryFailure`, `MediaLibraryResult<T>`, `MediaLibraryStorage`, `MediaLibraryDeps`, `MediaLibraryListValue`; funções `mediaLibraryDisplayFilename(record)`, `toMediaLibraryItem(record, { includeBackofficeEmail })`, `listMediaLibrary`, `createMediaLibraryUpload`, `confirmMediaLibraryUpload`, `deleteMediaLibraryItem`, `getMediaLibraryDownloadUrl`.
  - `handlers.ts`: tipo `MediaLibraryRequestContext = { userId: string; actor: MediaLibraryActor; viewer?: { canWrite: boolean } }`; `handleMediaLibraryList(request, ctx, deps)`, `handleMediaLibraryPresign(request, ctx, deps)`, `handleMediaLibraryConfirm(request, ctx, deps)`, `handleMediaLibraryDelete(id, ctx, deps)`, `handleMediaLibraryDownload(request, id, ctx, deps)` — todos `Promise<NextResponse>`; `mediaLibraryUnauthenticated(): NextResponse`.
  - `storage.ts`: `mediaLibraryStorage: MediaLibraryStorage`, `listMediaLibraryObjectKeys(prefix)`, `deleteMediaLibraryObjectKeys(keys)`.
  - `client.ts`: `MediaLibraryEndpoints`, `customerMediaLibraryEndpoints()`, `backofficeMediaLibraryEndpoints(userId)`, `MediaLibraryClientError` (campo `code: MediaLibraryClientErrorCode`), `toMediaLibraryClientError(error)`, `uploadMediaLibraryFile(endpoints, file, onProgress?)`, `requestMediaLibraryDownload(downloadEndpoint)`, `requestMediaLibraryDelete(itemEndpoint)`, tipo `MediaLibraryListResponse`.
  - `hooks.ts`: `mergeMediaLibraryPages(previous, next)`, `useMediaLibrary({ endpoint, type?, enabled? })`, `useMediaLibraryUpload({ endpoints, onUploaded })`, tipo `MediaLibraryUploadQueueItem`.

- [ ] **Step 1: Teste do serviço que falha** — crie `$FE/lib/media-library/service.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaLibraryDeps, MediaLibraryOwner, MediaLibraryRecord, NewMediaLibraryRecord } from "./service";
import {
  confirmMediaLibraryUpload,
  createMediaLibraryUpload,
  deleteMediaLibraryItem,
  getMediaLibraryDownloadUrl,
  listMediaLibrary,
} from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;
const CUSTOMER = { kind: "customer" } as const;
const ADMIN = { kind: "backoffice", email: "admin@automatize.com" } as const;

function rec(n: number, extra: Partial<MediaLibraryRecord> = {}): MediaLibraryRecord {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    userId: USER,
    blobUrl: `https://media.test/media/library/${USER}/m${n}.png`,
    pathname: `library/${USER}/m${n}.png`,
    filename: `m${n}.png`,
    contentType: "image/png",
    sizeBytes: 1000,
    uploadedByBackofficeEmail: null,
    createdAt: new Date(NOW.getTime() - n * 60_000),
    ...extra,
  };
}

function makeDeps(opts: {
  owner?: MediaLibraryOwner | null;
  expiresInDays?: number;
  records?: MediaLibraryRecord[];
  head?: { size: number; contentType: string } | null;
  failDelete?: boolean;
  failPresign?: boolean;
} = {}) {
  const records = [...(opts.records ?? [])];
  const calls = {
    deletedUrls: [] as string[],
    marked: [] as { id: string; reason: string }[],
    inserted: [] as NewMediaLibraryRecord[],
    presigned: [] as { pathname: string; contentType: string }[],
  };
  const owner: MediaLibraryOwner | null =
    opts.owner !== undefined
      ? opts.owner
      : {
          id: USER,
          email: "cliente@example.com",
          expirationDate: new Date(NOW.getTime() + (opts.expiresInDays ?? 10) * DAY),
        };
  const deps: MediaLibraryDeps = {
    now: () => NOW,
    hasBillingBypass: () => false,
    findOwner: async (id) => (owner && owner.id === id ? owner : null),
    listRecords: async ({ userId, cursor, limit }) =>
      records
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .filter((r) =>
          !cursor ||
          r.createdAt.getTime() < cursor.createdAt.getTime() ||
          (r.createdAt.getTime() === cursor.createdAt.getTime() && r.id < cursor.id),
        )
        .slice(0, limit),
    countRecords: async ({ userId }) => records.filter((r) => r.userId === userId).length,
    findRecord: async ({ userId, id }) => records.find((r) => r.userId === userId && r.id === id) ?? null,
    insertRecord: async (input) => {
      calls.inserted.push(input);
      const existing = records.find((r) => r.blobUrl === input.blobUrl);
      if (existing) return existing;
      const created: MediaLibraryRecord = { id: "33333333-3333-4333-8333-333333333333", createdAt: NOW, ...input };
      records.push(created);
      return created;
    },
    markDeleted: async ({ record, reason }) => {
      calls.marked.push({ id: record.id, reason });
    },
    storage: {
      createUploadUrl: async ({ pathname, contentType }) => {
        if (opts.failPresign) throw new Error("R2 down");
        calls.presigned.push({ pathname, contentType });
        const finalPathname = pathname.replace(/\.(\w+)$/, "-abc123.$1");
        return { uploadUrl: `https://upload.test/${finalPathname}`, pathname: finalPathname, url: `https://media.test/media/${finalPathname}` };
      },
      publicUrlForKey: (key) => `https://media.test/${key}`,
      head: async () => (opts.head === undefined ? { size: 1000, contentType: "image/png" } : opts.head),
      deleteUrls: async (urls) => {
        calls.deletedUrls.push(...urls);
        return opts.failDelete
          ? { deletedUrls: [], failed: urls.map((url) => ({ url, message: "boom" })) }
          : { deletedUrls: urls, failed: [] };
      },
      createDownloadUrl: async ({ url, filename }) => `${url}?download=${encodeURIComponent(filename)}`,
    },
  };
  return { deps, calls, records };
}

describe("listMediaLibrary", () => {
  it("lista a biblioteca ativa com total e estado", async () => {
    const { deps } = makeDeps({ records: [rec(1), rec(2)] });
    const result = await listMediaLibrary(deps, { userId: USER, actor: CUSTOMER, type: "all", cursor: null });
    assert.ok(result.ok);
    assert.equal(result.value.items.length, 2);
    assert.equal(result.value.total, 2);
    assert.equal(result.value.library.state, "active");
    assert.equal(result.value.nextCursor, null);
    assert.equal("uploadedByBackofficeEmail" in result.value.items[0]!, false);
  });
  it("encerrada devolve lista vazia mesmo com linhas no banco", async () => {
    const { deps } = makeDeps({ expiresInDays: -40, records: [rec(1)] });
    const result = await listMediaLibrary(deps, { userId: USER, actor: ADMIN, type: "all", cursor: null });
    assert.ok(result.ok);
    assert.deepEqual(result.value.items, []);
    assert.equal(result.value.library.state, "closed");
  });
  it("cliente em carência ainda lista", async () => {
    const { deps } = makeDeps({ expiresInDays: -5, records: [rec(1)] });
    const result = await listMediaLibrary(deps, { userId: USER, actor: CUSTOMER, type: "all", cursor: null });
    assert.ok(result.ok);
    assert.equal(result.value.library.state, "grace");
    assert.equal(result.value.items.length, 1);
  });
  it("pagina de 48 em 48 sem repetir", async () => {
    const { deps } = makeDeps({ records: Array.from({ length: 50 }, (_, i) => rec(i + 1)) });
    const first = await listMediaLibrary(deps, { userId: USER, actor: CUSTOMER, type: "all", cursor: null });
    assert.ok(first.ok);
    assert.equal(first.value.items.length, 48);
    assert.ok(first.value.nextCursor);
    const second = await listMediaLibrary(deps, { userId: USER, actor: CUSTOMER, type: "all", cursor: first.value.nextCursor });
    assert.ok(second.ok);
    assert.equal(second.value.items.length, 2);
    assert.equal(second.value.nextCursor, null);
    const ids = new Set([...first.value.items, ...second.value.items].map((i) => i.id));
    assert.equal(ids.size, 50);
  });
  it("backoffice vê o e-mail de quem subiu", async () => {
    const { deps } = makeDeps({ records: [rec(1, { uploadedByBackofficeEmail: "ana@automatize.com" })] });
    const result = await listMediaLibrary(deps, { userId: USER, actor: ADMIN, type: "all", cursor: null });
    assert.ok(result.ok);
    assert.equal(result.value.items[0]!.uploadedBy, "backoffice");
    assert.equal(result.value.items[0]!.uploadedByBackofficeEmail, "ana@automatize.com");
  });
  it("cursor inválido = 400; usuário inexistente = 404", async () => {
    const { deps } = makeDeps();
    const bad = await listMediaLibrary(deps, { userId: USER, actor: CUSTOMER, type: "all", cursor: "xx!" });
    assert.equal(bad.ok ? 0 : bad.status, 400);
    const missing = await listMediaLibrary(deps, { userId: "22222222-2222-4222-8222-222222222222", actor: CUSTOMER, type: "all", cursor: null });
    assert.equal(missing.ok ? 0 : missing.status, 404);
  });
});

describe("createMediaLibraryUpload", () => {
  it("pré-assina no prefixo do dono com o tipo normalizado", async () => {
    const { deps, calls } = makeDeps();
    const result = await createMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, filename: "Bolo.JPG", contentType: "image/jpg", size: 2000 });
    assert.ok(result.ok);
    assert.equal(result.value.contentType, "image/jpeg");
    assert.equal(result.value.key, `media/library/${USER}/bolo-abc123.jpg`);
    assert.deepEqual(calls.presigned, [{ pathname: `library/${USER}/bolo.jpg`, contentType: "image/jpeg" }]);
  });
  it("cliente em carência = 403 subscription_required; admin em carência pode", async () => {
    const { deps } = makeDeps({ expiresInDays: -5 });
    const customer = await createMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, filename: "a.png", contentType: "image/png", size: 1 });
    assert.equal(customer.ok ? "" : customer.code, "subscription_required");
    const admin = await createMediaLibraryUpload(deps, { userId: USER, actor: ADMIN, filename: "a.png", contentType: "image/png", size: 1 });
    assert.ok(admin.ok);
  });
  it("encerrada = 403 library_closed para todos", async () => {
    const { deps } = makeDeps({ expiresInDays: -40 });
    const admin = await createMediaLibraryUpload(deps, { userId: USER, actor: ADMIN, filename: "a.png", contentType: "image/png", size: 1 });
    assert.equal(admin.ok ? 0 : admin.status, 403);
    assert.equal(admin.ok ? "" : admin.code, "library_closed");
  });
  it("tipo e tamanho inválidos = 400; storage fora = 502", async () => {
    const { deps } = makeDeps();
    const type = await createMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, filename: "a.gif", contentType: "image/gif", size: 1 });
    assert.equal(type.ok ? "" : type.code, "unsupported_type");
    const big = await createMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, filename: "a.png", contentType: "image/png", size: 6 * 1024 * 1024 });
    assert.equal(big.ok ? "" : big.code, "file_too_large");
    const down = await createMediaLibraryUpload(makeDeps({ failPresign: true }).deps, { userId: USER, actor: CUSTOMER, filename: "a.png", contentType: "image/png", size: 1 });
    assert.equal(down.ok ? 0 : down.status, 502);
  });
});

describe("confirmMediaLibraryUpload", () => {
  const key = `media/library/${USER}/foto-abc123.png`;
  it("recusa chave de outro dono sem apagar nada", async () => {
    const { deps, calls } = makeDeps();
    const result = await confirmMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, key: "media/library/22222222-2222-4222-8222-222222222222/x.png", filename: "x.png" });
    assert.equal(result.ok ? "" : result.code, "invalid_upload");
    assert.deepEqual(calls.deletedUrls, []);
  });
  it("objeto ausente = 400 invalid_upload", async () => {
    const { deps } = makeDeps({ head: null });
    const result = await confirmMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, key, filename: "foto.png" });
    assert.equal(result.ok ? "" : result.code, "invalid_upload");
  });
  it("objeto maior que o limite é apagado e recusado", async () => {
    const { deps, calls } = makeDeps({ head: { size: 6 * 1024 * 1024, contentType: "image/png" } });
    const result = await confirmMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, key, filename: "foto.png" });
    assert.equal(result.ok ? "" : result.code, "file_too_large");
    assert.deepEqual(calls.deletedUrls, [`https://media.test/${key}`]);
  });
  it("biblioteca encerrada apaga o objeto e responde 403", async () => {
    const { deps, calls } = makeDeps({ expiresInDays: -40 });
    const result = await confirmMediaLibraryUpload(deps, { userId: USER, actor: ADMIN, key, filename: "foto.png" });
    assert.equal(result.ok ? 0 : result.status, 403);
    assert.deepEqual(calls.deletedUrls, [`https://media.test/${key}`]);
  });
  it("cliente: grava tamanho do HEAD, nome limpo e sem autor do backoffice", async () => {
    const { deps, calls } = makeDeps({ head: { size: 4321, contentType: "image/png" } });
    const result = await confirmMediaLibraryUpload(deps, { userId: USER, actor: CUSTOMER, key, filename: "C:\\fotos\\Foto Linda.png" });
    assert.ok(result.ok);
    assert.deepEqual(calls.inserted[0], {
      userId: USER,
      blobUrl: `https://media.test/${key}`,
      pathname: `library/${USER}/foto-abc123.png`,
      filename: "Foto Linda.png",
      contentType: "image/png",
      sizeBytes: 4321,
      uploadedByBackofficeEmail: null,
    });
    assert.equal(result.value.item.uploadedBy, "customer");
  });
  it("backoffice: grava o e-mail do admin; confirmação repetida devolve o mesmo item", async () => {
    const { deps, calls } = makeDeps();
    const first = await confirmMediaLibraryUpload(deps, { userId: USER, actor: ADMIN, key, filename: "foto.png" });
    const second = await confirmMediaLibraryUpload(deps, { userId: USER, actor: ADMIN, key, filename: "foto.png" });
    assert.ok(first.ok && second.ok);
    assert.equal(calls.inserted[0]!.uploadedByBackofficeEmail, "admin@automatize.com");
    assert.equal(first.value.item.id, second.value.item.id);
  });
});

describe("deleteMediaLibraryItem e download", () => {
  it("exclui no storage e marca com o motivo do ator", async () => {
    const one = makeDeps({ records: [rec(1)] });
    const byCustomer = await deleteMediaLibraryItem(one.deps, { userId: USER, actor: CUSTOMER, id: rec(1).id });
    assert.ok(byCustomer.ok);
    assert.deepEqual(one.calls.marked, [{ id: rec(1).id, reason: "user" }]);
    const two = makeDeps({ records: [rec(1)] });
    await deleteMediaLibraryItem(two.deps, { userId: USER, actor: ADMIN, id: rec(1).id });
    assert.deepEqual(two.calls.marked, [{ id: rec(1).id, reason: "backoffice" }]);
  });
  it("falha no storage = 502 e a linha não é marcada", async () => {
    const { deps, calls } = makeDeps({ records: [rec(1)], failDelete: true });
    const result = await deleteMediaLibraryItem(deps, { userId: USER, actor: CUSTOMER, id: rec(1).id });
    assert.equal(result.ok ? 0 : result.status, 502);
    assert.deepEqual(calls.marked, []);
  });
  it("id que não é uuid ou de outra mídia = 404", async () => {
    const { deps } = makeDeps({ records: [rec(1)] });
    const bad = await deleteMediaLibraryItem(deps, { userId: USER, actor: CUSTOMER, id: "../x" });
    assert.equal(bad.ok ? 0 : bad.status, 404);
  });
  it("download devolve URL com o nome; encerrada = 403", async () => {
    const active = makeDeps({ records: [rec(1)] });
    const ok = await getMediaLibraryDownloadUrl(active.deps, { userId: USER, actor: CUSTOMER, id: rec(1).id });
    assert.ok(ok.ok);
    assert.match(ok.value.url, /download=m1\.png$/);
    const closed = makeDeps({ expiresInDays: -40, records: [rec(1)] });
    const refused = await getMediaLibraryDownloadUrl(closed.deps, { userId: USER, actor: ADMIN, id: rec(1).id });
    assert.equal(refused.ok ? "" : refused.code, "library_closed");
  });
});
```

Run: `cd $FE && bun test lib/media-library/service.test.ts` → Expected: FAIL (`Cannot find module './service'`).

- [ ] **Step 2: Implementar `service.ts`** — crie `$FE/lib/media-library/service.ts`:

```ts
/**
 * Biblioteca de mídias — casos de uso com dependências injetadas.
 * Espelhado byte a byte no backoffice (sync:meta). Sem banco, sem R2 e sem
 * Next aqui: cada app injeta repositório, storage e relógio.
 */
import {
  MEDIA_LIBRARY_ERROR_MESSAGES,
  MEDIA_LIBRARY_PAGE_SIZE,
  buildMediaLibraryPathname,
  canBackofficeUpload,
  canCustomerUpload,
  canViewLibrary,
  encodeMediaLibraryCursor,
  getMediaLibraryStatus,
  isMediaLibraryKeyOwnedBy,
  isMediaLibraryVideo,
  isUuidLike,
  parseMediaLibraryCursor,
  sanitizeMediaLibraryFilename,
  validateMediaLibraryUpload,
  type MediaLibraryContentType,
  type MediaLibraryCursor,
  type MediaLibraryDeletedReason,
  type MediaLibraryErrorCode,
  type MediaLibraryState,
  type MediaLibraryStatus,
  type MediaLibraryTypeFilter,
} from "@/lib/media-library/policy";

export type MediaLibraryActor =
  | { kind: "customer" }
  | { kind: "backoffice"; email: string };

export type MediaLibraryOwner = {
  id: string;
  email: string | null;
  expirationDate: Date | null;
};

export type MediaLibraryRecord = {
  id: string;
  userId: string;
  blobUrl: string;
  pathname: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedByBackofficeEmail: string | null;
  createdAt: Date;
};

export type NewMediaLibraryRecord = Omit<MediaLibraryRecord, "id" | "createdAt">;

export type MediaLibraryItem = {
  id: string;
  url: string;
  filename: string;
  contentType: string | null;
  isVideo: boolean;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: "customer" | "backoffice";
  /** Só para o backoffice — o cliente vê apenas o selo "Equipe Automatize". */
  uploadedByBackofficeEmail?: string | null;
};

export type MediaLibrarySummary = {
  state: MediaLibraryState;
  purgeAt: string | null;
  expirationDate: string | null;
};

export type MediaLibraryListValue = {
  items: MediaLibraryItem[];
  nextCursor: string | null;
  total: number;
  library: MediaLibrarySummary;
};

export type MediaLibraryFailure = {
  ok: false;
  status: 400 | 403 | 404 | 502;
  code: MediaLibraryErrorCode;
  message: string;
};

export type MediaLibraryResult<T> = { ok: true; value: T } | MediaLibraryFailure;

export type MediaLibraryStorage = {
  createUploadUrl(input: {
    pathname: string;
    contentType: string;
  }): Promise<{ uploadUrl: string; pathname: string; url: string }>;
  publicUrlForKey(key: string): string;
  /** `null` = o objeto não existe. */
  head(url: string): Promise<{ size: number; contentType: string } | null>;
  deleteUrls(urls: string[]): Promise<{
    deletedUrls: string[];
    failed: { url: string; message: string }[];
  }>;
  createDownloadUrl(input: {
    url: string;
    filename: string;
    contentType: string | null;
  }): Promise<string>;
};

export type MediaLibraryDeps = {
  now(): Date;
  hasBillingBypass(owner: MediaLibraryOwner): boolean;
  findOwner(userId: string): Promise<MediaLibraryOwner | null>;
  listRecords(query: {
    userId: string;
    type: MediaLibraryTypeFilter;
    cursor: MediaLibraryCursor | null;
    limit: number;
  }): Promise<MediaLibraryRecord[]>;
  countRecords(query: { userId: string; type: MediaLibraryTypeFilter }): Promise<number>;
  findRecord(query: { userId: string; id: string }): Promise<MediaLibraryRecord | null>;
  /** Idempotente por `blobUrl`: confirmação repetida devolve o registro existente. */
  insertRecord(record: NewMediaLibraryRecord, actor: MediaLibraryActor): Promise<MediaLibraryRecord>;
  markDeleted(input: {
    record: MediaLibraryRecord;
    reason: MediaLibraryDeletedReason;
    at: Date;
    actor: MediaLibraryActor;
  }): Promise<void>;
  storage: MediaLibraryStorage;
};

function fail(status: MediaLibraryFailure["status"], code: MediaLibraryErrorCode): MediaLibraryFailure {
  return { ok: false, status, code, message: MEDIA_LIBRARY_ERROR_MESSAGES[code] };
}

function statusOf(deps: MediaLibraryDeps, owner: MediaLibraryOwner): MediaLibraryStatus {
  return getMediaLibraryStatus({
    expirationDate: owner.expirationDate,
    hasBillingBypass: deps.hasBillingBypass(owner),
    now: deps.now(),
  });
}

function uploadRefusal(state: MediaLibraryState, actor: MediaLibraryActor): MediaLibraryFailure | null {
  if (state === "closed") return fail(403, "library_closed");
  const allowed = actor.kind === "customer" ? canCustomerUpload(state) : canBackofficeUpload(state);
  return allowed ? null : fail(403, "subscription_required");
}

async function discardObject(deps: MediaLibraryDeps, url: string): Promise<void> {
  try {
    await deps.storage.deleteUrls([url]);
  } catch (error) {
    console.error("[media-library] falha ao descartar upload recusado", { url, error });
  }
}

export function mediaLibraryDisplayFilename(record: Pick<MediaLibraryRecord, "filename" | "pathname">): string {
  const filename = record.filename?.trim();
  if (filename) return filename;
  const base = record.pathname?.split("/").pop();
  return base || "mídia";
}

export function toMediaLibraryItem(
  record: MediaLibraryRecord,
  options: { includeBackofficeEmail: boolean },
): MediaLibraryItem {
  const item: MediaLibraryItem = {
    id: record.id,
    url: record.blobUrl,
    filename: mediaLibraryDisplayFilename(record),
    contentType: record.contentType,
    isVideo: isMediaLibraryVideo(record.contentType),
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt.toISOString(),
    uploadedBy: record.uploadedByBackofficeEmail ? "backoffice" : "customer",
  };
  if (options.includeBackofficeEmail) {
    item.uploadedByBackofficeEmail = record.uploadedByBackofficeEmail;
  }
  return item;
}

function summarize(owner: MediaLibraryOwner, status: MediaLibraryStatus): MediaLibrarySummary {
  return {
    state: status.state,
    purgeAt: status.purgeAt?.toISOString() ?? null,
    expirationDate: owner.expirationDate?.toISOString() ?? null,
  };
}

export async function listMediaLibrary(
  deps: MediaLibraryDeps,
  input: { userId: string; actor: MediaLibraryActor; type: MediaLibraryTypeFilter; cursor: string | null },
): Promise<MediaLibraryResult<MediaLibraryListValue>> {
  const parsed = parseMediaLibraryCursor(input.cursor);
  if (!parsed.ok) return fail(400, "invalid_cursor");
  const owner = await deps.findOwner(input.userId);
  if (!owner) return fail(404, "not_found");
  const status = statusOf(deps, owner);
  const library = summarize(owner, status);
  if (!canViewLibrary(status.state)) {
    return { ok: true, value: { items: [], nextCursor: null, total: 0, library } };
  }
  const [rows, total] = await Promise.all([
    deps.listRecords({ userId: input.userId, type: input.type, cursor: parsed.cursor, limit: MEDIA_LIBRARY_PAGE_SIZE + 1 }),
    deps.countRecords({ userId: input.userId, type: input.type }),
  ]);
  const page = rows.slice(0, MEDIA_LIBRARY_PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > MEDIA_LIBRARY_PAGE_SIZE && last
      ? encodeMediaLibraryCursor({ createdAt: last.createdAt, id: last.id })
      : null;
  const includeBackofficeEmail = input.actor.kind === "backoffice";
  return {
    ok: true,
    value: {
      items: page.map((row) => toMediaLibraryItem(row, { includeBackofficeEmail })),
      nextCursor,
      total,
      library,
    },
  };
}

export async function createMediaLibraryUpload(
  deps: MediaLibraryDeps,
  input: { userId: string; actor: MediaLibraryActor; filename: string; contentType: string; size: number },
): Promise<MediaLibraryResult<{ uploadUrl: string; key: string; url: string; contentType: MediaLibraryContentType }>> {
  const owner = await deps.findOwner(input.userId);
  if (!owner) return fail(404, "not_found");
  const refusal = uploadRefusal(statusOf(deps, owner).state, input.actor);
  if (refusal) return refusal;
  const validation = validateMediaLibraryUpload({ contentType: input.contentType, size: input.size });
  if (!validation.ok) return fail(400, validation.code);
  try {
    const presigned = await deps.storage.createUploadUrl({
      pathname: buildMediaLibraryPathname(input.userId, input.filename, validation.contentType),
      contentType: validation.contentType,
    });
    return {
      ok: true,
      value: {
        uploadUrl: presigned.uploadUrl,
        key: `media/${presigned.pathname}`,
        url: presigned.url,
        contentType: validation.contentType,
      },
    };
  } catch (error) {
    console.error("[media-library] presign falhou", { userId: input.userId, error });
    return fail(502, "storage_unavailable");
  }
}

export async function confirmMediaLibraryUpload(
  deps: MediaLibraryDeps,
  input: { userId: string; actor: MediaLibraryActor; key: string; filename: string },
): Promise<MediaLibraryResult<{ item: MediaLibraryItem }>> {
  const owner = await deps.findOwner(input.userId);
  if (!owner) return fail(404, "not_found");
  // Nunca toque num objeto fora do prefixo do dono: ele pode ser de outro usuário.
  if (!isMediaLibraryKeyOwnedBy(input.key, input.userId)) return fail(400, "invalid_upload");
  const url = deps.storage.publicUrlForKey(input.key);

  const refusal = uploadRefusal(statusOf(deps, owner).state, input.actor);
  if (refusal) {
    await discardObject(deps, url);
    return refusal;
  }

  let head: { size: number; contentType: string } | null;
  try {
    head = await deps.storage.head(url);
  } catch (error) {
    console.error("[media-library] HEAD falhou", { key: input.key, error });
    return fail(502, "storage_unavailable");
  }
  if (!head) return fail(400, "invalid_upload");

  const validation = validateMediaLibraryUpload({ contentType: head.contentType, size: head.size });
  if (!validation.ok) {
    await discardObject(deps, url);
    return fail(400, validation.code);
  }

  const record = await deps.insertRecord(
    {
      userId: input.userId,
      blobUrl: url,
      pathname: input.key.replace(/^media\//, ""),
      filename: sanitizeMediaLibraryFilename(input.filename, validation.contentType),
      contentType: validation.contentType,
      sizeBytes: head.size,
      uploadedByBackofficeEmail: input.actor.kind === "backoffice" ? input.actor.email : null,
    },
    input.actor,
  );
  return {
    ok: true,
    value: { item: toMediaLibraryItem(record, { includeBackofficeEmail: input.actor.kind === "backoffice" }) },
  };
}

export async function deleteMediaLibraryItem(
  deps: MediaLibraryDeps,
  input: { userId: string; actor: MediaLibraryActor; id: string },
): Promise<MediaLibraryResult<{ id: string; filename: string }>> {
  if (!isUuidLike(input.id)) return fail(404, "not_found");
  const owner = await deps.findOwner(input.userId);
  if (!owner) return fail(404, "not_found");
  const record = await deps.findRecord({ userId: input.userId, id: input.id });
  if (!record) return fail(404, "not_found");
  try {
    const result = await deps.storage.deleteUrls([record.blobUrl]);
    if (result.failed.length > 0) {
      console.error("[media-library] exclusão no storage falhou", { id: record.id, failed: result.failed });
      return fail(502, "storage_unavailable");
    }
  } catch (error) {
    console.error("[media-library] exclusão no storage falhou", { id: record.id, error });
    return fail(502, "storage_unavailable");
  }
  await deps.markDeleted({
    record,
    reason: input.actor.kind === "customer" ? "user" : "backoffice",
    at: deps.now(),
    actor: input.actor,
  });
  return { ok: true, value: { id: record.id, filename: mediaLibraryDisplayFilename(record) } };
}

export async function getMediaLibraryDownloadUrl(
  deps: MediaLibraryDeps,
  input: { userId: string; actor: MediaLibraryActor; id: string },
): Promise<MediaLibraryResult<{ url: string }>> {
  if (!isUuidLike(input.id)) return fail(404, "not_found");
  const owner = await deps.findOwner(input.userId);
  if (!owner) return fail(404, "not_found");
  if (!canViewLibrary(statusOf(deps, owner).state)) return fail(403, "library_closed");
  const record = await deps.findRecord({ userId: input.userId, id: input.id });
  if (!record) return fail(404, "not_found");
  try {
    const url = await deps.storage.createDownloadUrl({
      url: record.blobUrl,
      filename: mediaLibraryDisplayFilename(record),
      contentType: record.contentType,
    });
    return { ok: true, value: { url } };
  } catch (error) {
    console.error("[media-library] URL de download falhou", { id: record.id, error });
    return fail(502, "storage_unavailable");
  }
}
```

Run: `cd $FE && bun test lib/media-library/service.test.ts` → Expected: PASS.

- [ ] **Step 3: Teste dos handlers que falha** — crie `$FE/lib/media-library/handlers.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleMediaLibraryConfirm,
  handleMediaLibraryDelete,
  handleMediaLibraryDownload,
  handleMediaLibraryList,
  handleMediaLibraryPresign,
  mediaLibraryUnauthenticated,
} from "./handlers";
import type { MediaLibraryDeps, MediaLibraryRecord } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const record: MediaLibraryRecord = {
  id: ID, userId: USER, blobUrl: `https://media.test/media/library/${USER}/a.png`, pathname: null,
  filename: "a.png", contentType: "image/png", sizeBytes: 10, uploadedByBackofficeEmail: null, createdAt: NOW,
};
const deps: MediaLibraryDeps = {
  now: () => NOW,
  hasBillingBypass: () => false,
  findOwner: async () => ({ id: USER, email: "c@x.com", expirationDate: new Date(NOW.getTime() + 86_400_000) }),
  listRecords: async () => [record],
  countRecords: async () => 1,
  findRecord: async ({ id }) => (id === ID ? record : null),
  insertRecord: async (input) => ({ ...record, ...input }),
  markDeleted: async () => {},
  storage: {
    createUploadUrl: async ({ pathname }) => ({ uploadUrl: "https://up.test", pathname, url: `https://media.test/media/${pathname}` }),
    publicUrlForKey: (key) => `https://media.test/${key}`,
    head: async () => ({ size: 10, contentType: "image/png" }),
    deleteUrls: async (urls) => ({ deletedUrls: urls, failed: [] }),
    createDownloadUrl: async () => "https://signed.test/a.png",
  },
};
const ctx = { userId: USER, actor: { kind: "customer" } as const };
const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("handlers da biblioteca", () => {
  it("lista e inclui viewer quando informado", async () => {
    const response = await handleMediaLibraryList(new Request("http://x/api?type=image"), { ...ctx, viewer: { canWrite: false } }, deps);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.items.length, 1);
    assert.deepEqual(body.viewer, { canWrite: false });
  });
  it("presign com corpo inválido = 400", async () => {
    const response = await handleMediaLibraryPresign(json({ filename: 1 }), ctx, deps);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_upload");
  });
  it("presign válido devolve uploadUrl, key e contentType", async () => {
    const response = await handleMediaLibraryPresign(json({ filename: "a.png", contentType: "image/png", size: 10 }), ctx, deps);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.contentType, "image/png");
    assert.ok(body.key.startsWith(`media/library/${USER}/`));
  });
  it("confirmação = 201 com o item", async () => {
    const response = await handleMediaLibraryConfirm(json({ key: `media/library/${USER}/a-1.png`, filename: "a.png" }), ctx, deps);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).item.filename, "a.png");
  });
  it("download: JSON quando pede JSON, 302 caso contrário", async () => {
    const asJson = await handleMediaLibraryDownload(new Request("http://x", { headers: { Accept: "application/json" } }), ID, ctx, deps);
    assert.deepEqual(await asJson.json(), { url: "https://signed.test/a.png" });
    const redirect = await handleMediaLibraryDownload(new Request("http://x"), ID, ctx, deps);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), "https://signed.test/a.png");
  });
  it("delete devolve ok; inexistente = 404", async () => {
    assert.equal((await handleMediaLibraryDelete(ID, ctx, deps)).status, 200);
    assert.equal((await handleMediaLibraryDelete("00000000-0000-4000-8000-000000000999", ctx, deps)).status, 404);
  });
  it("sem sessão = 401", () => {
    assert.equal(mediaLibraryUnauthenticated().status, 401);
  });
});
```

Run: `cd $FE && bun test lib/media-library/handlers.test.ts` → Expected: FAIL (`Cannot find module './handlers'`).

- [ ] **Step 4: Implementar `handlers.ts`** — crie `$FE/lib/media-library/handlers.ts`:

```ts
/**
 * Biblioteca de mídias — Request → serviço → NextResponse. Espelhado no
 * backoffice: quem chama só resolve QUEM é o dono e o ator (sessão do cliente
 * no app, RBAC do admin no backoffice).
 */
import { NextResponse } from "next/server";
import { MEDIA_LIBRARY_ERROR_MESSAGES, parseMediaLibraryTypeFilter } from "@/lib/media-library/policy";
import {
  confirmMediaLibraryUpload,
  createMediaLibraryUpload,
  deleteMediaLibraryItem,
  getMediaLibraryDownloadUrl,
  listMediaLibrary,
  type MediaLibraryActor,
  type MediaLibraryDeps,
  type MediaLibraryResult,
} from "@/lib/media-library/service";

export type MediaLibraryRequestContext = {
  userId: string;
  actor: MediaLibraryActor;
  viewer?: { canWrite: boolean };
};

function respond<T>(result: MediaLibraryResult<T>, successStatus = 200): NextResponse {
  if (result.ok) return NextResponse.json(result.value, { status: successStatus });
  return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
}

function invalidPayload(): NextResponse {
  return NextResponse.json(
    { error: MEDIA_LIBRARY_ERROR_MESSAGES.invalid_upload, code: "invalid_upload" },
    { status: 400 },
  );
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function mediaLibraryUnauthenticated(): NextResponse {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function handleMediaLibraryList(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const result = await listMediaLibrary(deps, {
    userId: ctx.userId,
    actor: ctx.actor,
    type: parseMediaLibraryTypeFilter(params.get("type")),
    cursor: params.get("cursor"),
  });
  if (!result.ok || !ctx.viewer) return respond(result);
  return NextResponse.json({ ...result.value, viewer: ctx.viewer });
}

export async function handleMediaLibraryPresign(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const body = await readJsonObject(request);
  if (
    !body ||
    typeof body.filename !== "string" ||
    typeof body.contentType !== "string" ||
    typeof body.size !== "number"
  ) {
    return invalidPayload();
  }
  return respond(
    await createMediaLibraryUpload(deps, {
      userId: ctx.userId,
      actor: ctx.actor,
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
    }),
  );
}

export async function handleMediaLibraryConfirm(
  request: Request,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const body = await readJsonObject(request);
  if (!body || typeof body.key !== "string" || typeof body.filename !== "string") {
    return invalidPayload();
  }
  return respond(
    await confirmMediaLibraryUpload(deps, {
      userId: ctx.userId,
      actor: ctx.actor,
      key: body.key,
      filename: body.filename,
    }),
    201,
  );
}

export async function handleMediaLibraryDelete(
  id: string,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const result = await deleteMediaLibraryItem(deps, { userId: ctx.userId, actor: ctx.actor, id });
  if (!result.ok) return respond(result);
  return NextResponse.json({ ok: true, ...result.value });
}

export async function handleMediaLibraryDownload(
  request: Request,
  id: string,
  ctx: MediaLibraryRequestContext,
  deps: MediaLibraryDeps,
): Promise<NextResponse> {
  const result = await getMediaLibraryDownloadUrl(deps, { userId: ctx.userId, actor: ctx.actor, id });
  if (!result.ok) return respond(result);
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return NextResponse.json({ url: result.value.url });
  return NextResponse.redirect(result.value.url, 302);
}
```

Run: `cd $FE && bun test lib/media-library/handlers.test.ts` → Expected: PASS.

- [ ] **Step 5: Implementar `storage.ts`** — crie `$FE/lib/media-library/storage.ts`:

```ts
/**
 * Adaptador do serviço da Biblioteca de mídias para o R2 de mídia.
 * Espelhado no backoffice — os dois `lib/storage/media-r2.ts` exportam estes
 * mesmos nomes (Tarefa 3 do plano 2026-10-13).
 */
import type { MediaLibraryStorage } from "@/lib/media-library/service";
import {
  MediaObjectNotFoundError,
  createMediaDownloadUrl,
  createMediaUploadUrl,
  delMediaObjects,
  deleteMediaObjectKeysReportingErrors,
  getMediaPublicUrl,
  headMediaObject,
  listMediaObjectKeys,
  mediaUrlToKey,
} from "@/lib/storage/media-r2";

export const mediaLibraryStorage: MediaLibraryStorage = {
  createUploadUrl: (input) => createMediaUploadUrl(input),
  publicUrlForKey: (key) => getMediaPublicUrl(key),
  async head(url) {
    try {
      const head = await headMediaObject(url);
      return { size: head.size, contentType: head.contentType };
    } catch (error) {
      if (error instanceof MediaObjectNotFoundError) return null;
      throw error;
    }
  },
  async deleteUrls(urls) {
    const keyed = urls.map((url) => ({ url, key: mediaUrlToKey(url) }));
    // URL sem chave R2 = legado do Vercel Blob (apagado em best-effort) ou host estranho.
    const legacy = keyed.filter((entry) => !entry.key).map((entry) => entry.url);
    if (legacy.length > 0) await delMediaObjects(legacy);
    const withKey = keyed.filter((entry): entry is { url: string; key: string } => Boolean(entry.key));
    const result = await deleteMediaObjectKeysReportingErrors(withKey.map((entry) => entry.key));
    const failedByKey = new Map(result.failed.map((entry) => [entry.key, entry.message]));
    return {
      deletedUrls: [
        ...legacy,
        ...withKey.filter((entry) => !failedByKey.has(entry.key)).map((entry) => entry.url),
      ],
      failed: withKey
        .filter((entry) => failedByKey.has(entry.key))
        .map((entry) => ({ url: entry.url, message: failedByKey.get(entry.key) ?? "delete_failed" })),
    };
  },
  async createDownloadUrl({ url, filename, contentType }) {
    const key = mediaUrlToKey(url);
    if (!key) return url;
    return createMediaDownloadUrl({ objectKey: key, filename, contentType });
  },
};

export function listMediaLibraryObjectKeys(prefix: string): Promise<string[]> {
  return listMediaObjectKeys(prefix);
}

export function deleteMediaLibraryObjectKeys(keys: string[]) {
  return deleteMediaObjectKeysReportingErrors(keys);
}
```

- [ ] **Step 6: Teste dos hooks que falha** — crie `$FE/lib/media-library/hooks.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMediaLibraryPages } from "./hooks";
import type { MediaLibraryItem } from "./service";

const item = (id: string): MediaLibraryItem => ({
  id, url: `https://m.test/${id}.png`, filename: `${id}.png`, contentType: "image/png",
  isVideo: false, sizeBytes: 1, createdAt: "2026-10-13T12:00:00.000Z", uploadedBy: "customer",
});

describe("mergeMediaLibraryPages", () => {
  it("acrescenta a próxima página sem repetir itens já mostrados (ex.: recém-enviados)", () => {
    const merged = mergeMediaLibraryPages([item("novo"), item("a"), item("b")], [item("b"), item("c"), item("novo")]);
    assert.deepEqual(merged.map((i) => i.id), ["novo", "a", "b", "c"]);
  });
});
```

Run: `cd $FE && bun test lib/media-library/hooks.test.ts` → Expected: FAIL.

- [ ] **Step 7: Implementar `client.ts`** — crie `$FE/lib/media-library/client.ts`:

```ts
/**
 * Biblioteca de mídias — chamadas do navegador (espelhado no backoffice).
 * Upload: presign → PUT direto no R2 com progresso → confirmação no servidor.
 */
import {
  MEDIA_LIBRARY_ERROR_MESSAGES,
  isMediaLibraryClientErrorCode,
  type MediaLibraryClientErrorCode,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem, MediaLibraryListValue } from "@/lib/media-library/service";

export type MediaLibraryListResponse = MediaLibraryListValue & { viewer?: { canWrite: boolean } };

export type MediaLibraryEndpoints = {
  list: string;
  presign: string;
  confirm: string;
  item: (id: string) => string;
  download: (id: string) => string;
};

function endpointsFrom(base: string): MediaLibraryEndpoints {
  return {
    list: base,
    presign: `${base}/uploads`,
    confirm: base,
    item: (id) => `${base}/${encodeURIComponent(id)}`,
    download: (id) => `${base}/${encodeURIComponent(id)}/download`,
  };
}

export function customerMediaLibraryEndpoints(): MediaLibraryEndpoints {
  return endpointsFrom("/api/files/media-library");
}

export function backofficeMediaLibraryEndpoints(userId: string): MediaLibraryEndpoints {
  return endpointsFrom(`/api/users/${encodeURIComponent(userId)}/media-library`);
}

export class MediaLibraryClientError extends Error {
  code: MediaLibraryClientErrorCode;
  constructor(code: MediaLibraryClientErrorCode, message?: string) {
    super(message ?? MEDIA_LIBRARY_ERROR_MESSAGES[code]);
    this.name = "MediaLibraryClientError";
    this.code = code;
  }
}

export function toMediaLibraryClientError(error: unknown): MediaLibraryClientError {
  return error instanceof MediaLibraryClientError ? error : new MediaLibraryClientError("upload_failed");
}

async function errorFromResponse(response: Response): Promise<MediaLibraryClientError> {
  const data = (await response.json().catch(() => null)) as { code?: unknown; error?: unknown } | null;
  const code = isMediaLibraryClientErrorCode(data?.code)
    ? data.code
    : response.status >= 500
      ? "storage_unavailable"
      : "upload_failed";
  return new MediaLibraryClientError(code, typeof data?.error === "string" ? data.error : undefined);
}

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
}

function putWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new MediaLibraryClientError("upload_failed"));
    };
    xhr.onerror = () => reject(new MediaLibraryClientError("network_error"));
    xhr.send(file);
  });
}

export async function uploadMediaLibraryFile(
  endpoints: MediaLibraryEndpoints,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<MediaLibraryItem> {
  const presignResponse = await postJson(endpoints.presign, {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });
  if (!presignResponse.ok) throw await errorFromResponse(presignResponse);
  const presign = (await presignResponse.json()) as { uploadUrl: string; key: string; contentType: string };

  // O PUT precisa do MESMO Content-Type assinado (o servidor normaliza image/jpg → image/jpeg).
  await putWithProgress(presign.uploadUrl, file, presign.contentType, onProgress);

  const confirmResponse = await postJson(endpoints.confirm, { key: presign.key, filename: file.name });
  if (!confirmResponse.ok) throw await errorFromResponse(confirmResponse);
  const data = (await confirmResponse.json()) as { item: MediaLibraryItem };
  onProgress?.(100);
  return data.item;
}

export async function requestMediaLibraryDownload(downloadEndpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(downloadEndpoint, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
  if (!response.ok) throw await errorFromResponse(response);
  const data = (await response.json()) as { url?: string };
  if (!data.url) throw new MediaLibraryClientError("storage_unavailable");
  const anchor = document.createElement("a");
  anchor.href = data.url;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function requestMediaLibraryDelete(itemEndpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(itemEndpoint, { method: "DELETE" });
  } catch {
    throw new MediaLibraryClientError("network_error");
  }
  if (!response.ok) throw await errorFromResponse(response);
}
```

- [ ] **Step 8: Implementar `hooks.ts`** — crie `$FE/lib/media-library/hooks.ts`:

```ts
/**
 * Biblioteca de mídias — hooks React (espelhado no backoffice).
 * `endpoints` deve ser estável (useMemo) para não refazer a busca a cada render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MEDIA_LIBRARY_ERROR_MESSAGES,
  validateMediaLibraryUpload,
  type MediaLibraryClientErrorCode,
  type MediaLibraryTypeFilter,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem, MediaLibrarySummary } from "@/lib/media-library/service";
import {
  toMediaLibraryClientError,
  uploadMediaLibraryFile,
  type MediaLibraryEndpoints,
  type MediaLibraryListResponse,
} from "@/lib/media-library/client";

/** Junta a próxima página sem repetir o que já está na tela (uploads recentes no topo). */
export function mergeMediaLibraryPages(
  previous: MediaLibraryItem[],
  next: MediaLibraryItem[],
): MediaLibraryItem[] {
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...next.filter((item) => !seen.has(item.id))];
}

function matchesFilter(item: MediaLibraryItem, type: MediaLibraryTypeFilter): boolean {
  if (type === "image") return !item.isVideo;
  if (type === "video") return item.isVideo;
  return true;
}

export function useMediaLibrary({
  endpoint,
  type = "all",
  enabled = true,
}: {
  endpoint: string;
  type?: MediaLibraryTypeFilter;
  enabled?: boolean;
}) {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [library, setLibrary] = useState<MediaLibrarySummary | null>(null);
  const [viewer, setViewer] = useState<{ canWrite: boolean } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<MediaLibraryListResponse> => {
      const params = new URLSearchParams();
      if (type !== "all") params.set("type", type);
      if (cursor) params.set("cursor", cursor);
      const query = params.toString();
      const response = await fetch(query ? `${endpoint}?${query}` : endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(`media_library_${response.status}`);
      return (await response.json()) as MediaLibraryListResponse;
    },
    [endpoint, type],
  );

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setStatus("loading");
    try {
      const data = await fetchPage(null);
      if (id !== requestId.current) return;
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setTotal(data.total);
      setLibrary(data.library);
      setViewer(data.viewer ?? null);
      setStatus("ready");
    } catch {
      if (id === requestId.current) setStatus("error");
    }
  }, [fetchPage]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const data = await fetchPage(nextCursor);
      if (id !== requestId.current) return;
      setItems((previous) => mergeMediaLibraryPages(previous, data.items));
      setNextCursor(data.nextCursor);
      setTotal(data.total);
    } catch (error) {
      console.error("[media-library] carregar mais falhou", error);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, nextCursor]);

  const prepend = useCallback(
    (item: MediaLibraryItem) => {
      if (!matchesFilter(item, type)) return;
      setItems((previous) => (previous.some((entry) => entry.id === item.id) ? previous : [item, ...previous]));
      setTotal((value) => value + 1);
    },
    [type],
  );

  const removeLocal = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  return {
    items,
    total,
    library,
    viewer,
    status,
    hasMore: nextCursor !== null,
    loadingMore,
    refresh,
    loadMore,
    prepend,
    removeLocal,
  };
}

export type MediaLibraryUploadQueueItem = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "done" | "error";
  errorCode?: MediaLibraryClientErrorCode;
  errorMessage?: string;
};

let queueSequence = 0;

export function useMediaLibraryUpload({
  endpoints,
  onUploaded,
}: {
  endpoints: MediaLibraryEndpoints;
  onUploaded: (item: MediaLibraryItem) => void;
}) {
  const [queue, setQueue] = useState<MediaLibraryUploadQueueItem[]>([]);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const update = useCallback((id: string, patch: Partial<MediaLibraryUploadQueueItem>) => {
    setQueue((previous) => previous.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const enqueue = useCallback(
    (files: File[]) => {
      for (const file of files) {
        queueSequence += 1;
        const id = `upload-${queueSequence}`;
        const validation = validateMediaLibraryUpload({ contentType: file.type, size: file.size });
        if (!validation.ok) {
          setQueue((previous) => [
            ...previous,
            {
              id,
              name: file.name,
              size: file.size,
              progress: 0,
              status: "error",
              errorCode: validation.code,
              errorMessage: MEDIA_LIBRARY_ERROR_MESSAGES[validation.code],
            },
          ]);
          continue;
        }
        setQueue((previous) => [...previous, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);
        uploadMediaLibraryFile(endpoints, file, (progress) => update(id, { progress }))
          .then((item) => {
            update(id, { status: "done", progress: 100 });
            onUploadedRef.current(item);
            setTimeout(() => setQueue((previous) => previous.filter((entry) => entry.id !== id)), 1500);
          })
          .catch((error: unknown) => {
            const clientError = toMediaLibraryClientError(error);
            update(id, { status: "error", errorCode: clientError.code, errorMessage: clientError.message });
          });
      }
    },
    [endpoints, update],
  );

  const dismiss = useCallback((id: string) => {
    setQueue((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  return { queue, enqueue, dismiss, isUploading: queue.some((entry) => entry.status === "uploading") };
}
```

Run: `cd $FE && bun test lib/media-library/hooks.test.ts lib/media-library/service.test.ts lib/media-library/handlers.test.ts` → Expected: PASS.

- [ ] **Step 9: Registrar e espelhar** — em `$FE/tests/helpers/source-parity.ts`, logo abaixo de `"lib/media-library/policy.ts",` acrescente:

```ts
  "lib/media-library/service.ts",
  "lib/media-library/handlers.ts",
  "lib/media-library/storage.ts",
  "lib/media-library/client.ts",
  "lib/media-library/hooks.ts",
```
Run: `cd $FE && bun run sync:meta && bun test tests/meta-duplicate-parity.test.ts` → Expected: os 5 arquivos `synced` para o BO; paridade PASS.

- [ ] **Step 10: tsc dos dois sem erro novo** (como na Tarefa 2, Step 8). O BO precisa compilar os 5 arquivos espelhados (eles importam `@/lib/storage/media-r2` da Tarefa 3 e `next/server`).

- [ ] **Step 11: Commit (dois repos)**

```bash
cd $FE && git add lib/media-library/service.ts lib/media-library/handlers.ts lib/media-library/storage.ts lib/media-library/client.ts lib/media-library/hooks.ts lib/media-library/service.test.ts lib/media-library/handlers.test.ts lib/media-library/hooks.test.ts && git add -u tests/helpers/source-parity.ts && git commit -m "feat(biblioteca): serviço, handlers, cliente e hooks da Biblioteca de mídias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add lib/media-library && git commit -m "feat(biblioteca): espelho do serviço, handlers, cliente e hooks da Biblioteca de mídias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rotas do cliente no app (lista, presign, confirmação, exclusão, download)

**Files:**
- Create: `$FE/lib/media-library/repository.ts`, `$FE/lib/media-library/server.ts`, `$FE/lib/media-library/server.test.ts`
- Rewrite: `$FE/app/api/files/media-library/route.ts` (GET + POST)
- Rewrite: `$FE/app/api/files/media-library/[id]/route.ts` (DELETE)
- Create: `$FE/app/api/files/media-library/uploads/route.ts` (POST), `$FE/app/api/files/media-library/[id]/download/route.ts` (GET)

**Interfaces:**
- Consumes: `MediaLibraryDeps` e tipos (`service.ts`), handlers (`handlers.ts`), `mediaLibraryStorage` (`storage.ts`), `isBypassStripeEmail` (`@/lib/access/billing-bypass`), `db` (`@/lib/db/queries`), `blobUpload`, `user` (`@/lib/db/schema`).
- Produces: `hasMediaLibraryBillingBypass(email: string | null, env?: NodeJS.ProcessEnv): boolean`, `createMediaLibraryDeps(): MediaLibraryDeps` (em `server.ts`); funções do repositório `findMediaLibraryOwner`, `listMediaLibraryRecords`, `countMediaLibraryRecords`, `findMediaLibraryRecord`, `insertMediaLibraryRecord`, `markMediaLibraryRecordDeleted`, `findMediaLibraryRetentionCandidates(cutoff: Date)`, `listLiveMediaLibraryRecords(userId)`, `markMediaLibraryRecordsDeletedByRetention(ids: string[], at: Date)`.

- [ ] **Step 1: Teste que falha** — crie `$FE/lib/media-library/server.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasMediaLibraryBillingBypass } from "./server";

describe("hasMediaLibraryBillingBypass", () => {
  it("BYPASS_STRIPE=true libera todo mundo", () => {
    assert.equal(hasMediaLibraryBillingBypass("x@y.com", { BYPASS_STRIPE: "true" }), true);
  });
  it("e-mail da lista de bypass libera; outros não", () => {
    assert.equal(hasMediaLibraryBillingBypass("christian.gomesss09@gmail.com", {}), true);
    assert.equal(hasMediaLibraryBillingBypass("x@y.com", {}), false);
    assert.equal(hasMediaLibraryBillingBypass(null, {}), false);
  });
});
```
Run: `cd $FE && bun test lib/media-library/server.test.ts` → Expected: FAIL.

- [ ] **Step 2: Repositório** — crie `$FE/lib/media-library/repository.ts`:

```ts
import { and, count, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/queries";
import { blobUpload, user } from "@/lib/db/schema";
import {
  MEDIA_LIBRARY_SOURCE,
  MEDIA_LIBRARY_VIDEO_TYPES,
  isUuidLike,
  type MediaLibraryCursor,
  type MediaLibraryDeletedReason,
  type MediaLibraryTypeFilter,
} from "@/lib/media-library/policy";
import type {
  MediaLibraryActor,
  MediaLibraryOwner,
  MediaLibraryRecord,
  NewMediaLibraryRecord,
} from "@/lib/media-library/service";

const RECORD_COLUMNS = {
  id: blobUpload.id,
  userId: blobUpload.userId,
  blobUrl: blobUpload.blobUrl,
  pathname: blobUpload.pathname,
  filename: blobUpload.filename,
  contentType: blobUpload.contentType,
  sizeBytes: blobUpload.sizeBytes,
  uploadedByBackofficeEmail: blobUpload.uploadedByBackofficeEmail,
  createdAt: blobUpload.createdAt,
};

const VIDEO_TYPES: string[] = [...MEDIA_LIBRARY_VIDEO_TYPES];
/**
 * Ordenar e comparar no MESMO valor em milissegundos: `created_at` tem
 * microssegundos e o cursor (Date do JS) só milissegundos — comparar a coluna
 * crua pularia mídias criadas no mesmo milissegundo.
 */
const createdAtMs = sql`date_trunc('milliseconds', ${blobUpload.createdAt})`;

function liveLibraryRows(userId: string): SQL {
  return and(
    eq(blobUpload.userId, userId),
    eq(blobUpload.source, MEDIA_LIBRARY_SOURCE),
    isNull(blobUpload.deletedAt),
  ) as SQL;
}

function typeCondition(type: MediaLibraryTypeFilter): SQL | undefined {
  if (type === "video") return inArray(blobUpload.contentType, VIDEO_TYPES);
  if (type === "image") {
    return or(isNull(blobUpload.contentType), notInArray(blobUpload.contentType, VIDEO_TYPES));
  }
  return undefined;
}

function cursorCondition(cursor: MediaLibraryCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${createdAtMs}, ${blobUpload.id}) < (${cursor.createdAt.toISOString()}::timestamp, ${cursor.id}::uuid)`;
}

export async function findMediaLibraryOwner(userId: string): Promise<MediaLibraryOwner | null> {
  if (!isUuidLike(userId)) return null;
  const [row] = await db
    .select({ id: user.id, email: user.email, expirationDate: user.expirationDate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

export async function listMediaLibraryRecords(query: {
  userId: string;
  type: MediaLibraryTypeFilter;
  cursor: MediaLibraryCursor | null;
  limit: number;
}): Promise<MediaLibraryRecord[]> {
  return db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(and(liveLibraryRows(query.userId), typeCondition(query.type), cursorCondition(query.cursor)))
    .orderBy(sql`${createdAtMs} desc`, sql`${blobUpload.id} desc`)
    .limit(query.limit);
}

export async function countMediaLibraryRecords(query: {
  userId: string;
  type: MediaLibraryTypeFilter;
}): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(blobUpload)
    .where(and(liveLibraryRows(query.userId), typeCondition(query.type)));
  return Number(row?.value ?? 0);
}

export async function findMediaLibraryRecord(query: {
  userId: string;
  id: string;
}): Promise<MediaLibraryRecord | null> {
  if (!isUuidLike(query.id)) return null;
  const [row] = await db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(and(eq(blobUpload.id, query.id), liveLibraryRows(query.userId)))
    .limit(1);
  return row ?? null;
}

export async function insertMediaLibraryRecord(
  input: NewMediaLibraryRecord,
  _actor: MediaLibraryActor,
): Promise<MediaLibraryRecord> {
  const now = new Date();
  const [inserted] = await db
    .insert(blobUpload)
    .values({ ...input, source: MEDIA_LIBRARY_SOURCE, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: blobUpload.blobUrl })
    .returning(RECORD_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(eq(blobUpload.blobUrl, input.blobUrl))
    .limit(1);
  if (!existing) throw new Error("media_library_insert_conflict");
  return existing;
}

export async function markMediaLibraryRecordDeleted(input: {
  record: MediaLibraryRecord;
  reason: MediaLibraryDeletedReason;
  at: Date;
  actor: MediaLibraryActor;
}): Promise<void> {
  await db
    .update(blobUpload)
    .set({ deletedAt: input.at, updatedAt: input.at, deletedReason: input.reason })
    .where(and(eq(blobUpload.id, input.record.id), isNull(blobUpload.deletedAt)));
}

/** Clientes com mídia viva e acesso nulo ou vencido antes de `cutoff` (pré-filtro do cron). */
export async function findMediaLibraryRetentionCandidates(cutoff: Date) {
  return db
    .selectDistinct({ userId: user.id, email: user.email, expirationDate: user.expirationDate })
    .from(user)
    .innerJoin(blobUpload, eq(blobUpload.userId, user.id))
    .where(
      and(
        eq(blobUpload.source, MEDIA_LIBRARY_SOURCE),
        isNull(blobUpload.deletedAt),
        or(isNull(user.expirationDate), lt(user.expirationDate, cutoff)),
      ),
    );
}

export async function listLiveMediaLibraryRecords(userId: string): Promise<{ id: string; blobUrl: string }[]> {
  return db
    .select({ id: blobUpload.id, blobUrl: blobUpload.blobUrl })
    .from(blobUpload)
    .where(liveLibraryRows(userId));
}

export async function markMediaLibraryRecordsDeletedByRetention(ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(blobUpload)
    .set({ deletedAt: at, updatedAt: at, deletedReason: "retention" })
    .where(and(inArray(blobUpload.id, ids), isNull(blobUpload.deletedAt)));
}
```

- [ ] **Step 3: Fábrica de dependências** — crie `$FE/lib/media-library/server.ts`:

```ts
import { isBypassStripeEmail } from "@/lib/access/billing-bypass";
import {
  countMediaLibraryRecords,
  findMediaLibraryOwner,
  findMediaLibraryRecord,
  insertMediaLibraryRecord,
  listMediaLibraryRecords,
  markMediaLibraryRecordDeleted,
} from "@/lib/media-library/repository";
import type { MediaLibraryDeps } from "@/lib/media-library/service";
import { mediaLibraryStorage } from "@/lib/media-library/storage";

/** Mesma regra do gate do app (proxy.ts): BYPASS_STRIPE global ou e-mail na lista. */
export function hasMediaLibraryBillingBypass(
  email: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BYPASS_STRIPE === "true" || isBypassStripeEmail(email);
}

export function createMediaLibraryDeps(): MediaLibraryDeps {
  return {
    now: () => new Date(),
    hasBillingBypass: (owner) => hasMediaLibraryBillingBypass(owner.email),
    findOwner: findMediaLibraryOwner,
    listRecords: listMediaLibraryRecords,
    countRecords: countMediaLibraryRecords,
    findRecord: findMediaLibraryRecord,
    insertRecord: insertMediaLibraryRecord,
    markDeleted: markMediaLibraryRecordDeleted,
    storage: mediaLibraryStorage,
  };
}
```
**Atenção:** `isBypassStripeEmail` lê `process.env.BYPASS_STRIPE_EMAILS` direto; o teste com `{}` funciona porque o e-mail fixo está no código e `x@y.com` não está em nenhuma lista. Se `.env` local tiver `BYPASS_STRIPE_EMAILS` com `x@y.com`, troque o e-mail do teste por um aleatório.

Run: `cd $FE && bun test lib/media-library/server.test.ts` → Expected: PASS.

- [ ] **Step 4: Rotas** — substitua o conteúdo inteiro de `$FE/app/api/files/media-library/route.ts`:

```ts
import { auth } from "@/app/(auth)/auth";
import {
  handleMediaLibraryConfirm,
  handleMediaLibraryList,
  mediaLibraryUnauthenticated,
} from "@/lib/media-library/handlers";
import { createMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

/** Biblioteca de mídias do usuário da sessão (spec 2026-10-13). */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return mediaLibraryUnauthenticated();
  return handleMediaLibraryList(request, { userId: session.user.id, actor: { kind: "customer" } }, createMediaLibraryDeps());
}

/** Confirma um upload já enviado ao R2 pela URL pré-assinada. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return mediaLibraryUnauthenticated();
  return handleMediaLibraryConfirm(request, { userId: session.user.id, actor: { kind: "customer" } }, createMediaLibraryDeps());
}
```

Crie `$FE/app/api/files/media-library/uploads/route.ts`:
```ts
import { auth } from "@/app/(auth)/auth";
import { handleMediaLibraryPresign, mediaLibraryUnauthenticated } from "@/lib/media-library/handlers";
import { createMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

/** URL pré-assinada de upload (só com a biblioteca Ativa). */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return mediaLibraryUnauthenticated();
  return handleMediaLibraryPresign(request, { userId: session.user.id, actor: { kind: "customer" } }, createMediaLibraryDeps());
}
```

Substitua `$FE/app/api/files/media-library/[id]/route.ts`:
```ts
import { auth } from "@/app/(auth)/auth";
import { handleMediaLibraryDelete, mediaLibraryUnauthenticated } from "@/lib/media-library/handlers";
import { createMediaLibraryDeps } from "@/lib/media-library/server";

/** Exclui uma mídia da biblioteca: R2 primeiro, depois `deleted_at` (motivo `user`). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return mediaLibraryUnauthenticated();
  const { id } = await params;
  return handleMediaLibraryDelete(id, { userId: session.user.id, actor: { kind: "customer" } }, createMediaLibraryDeps());
}
```

Crie `$FE/app/api/files/media-library/[id]/download/route.ts`:
```ts
import { auth } from "@/app/(auth)/auth";
import { handleMediaLibraryDownload, mediaLibraryUnauthenticated } from "@/lib/media-library/handlers";
import { createMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

/** 302 para a URL assinada com o nome original; `Accept: application/json` devolve `{ url }`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return mediaLibraryUnauthenticated();
  const { id } = await params;
  return handleMediaLibraryDownload(request, id, { userId: session.user.id, actor: { kind: "customer" } }, createMediaLibraryDeps());
}
```

O `DeviceMediaLibrary` atual (removido na Tarefa 10) lê `{ media }` desta rota; até lá ele mostra lista vazia — aceitável dentro da branch. **Não** apague `lib/blob/device-media.ts` nem o `register` agora.

- [ ] **Step 5: Verificação rápida contra a staging + S3 local** — suba o dev server do FE (`verification.md` §2; LocalStack §1) e rode:

```bash
curl -s http://localhost:3000/api/files/media-library | head -c 400; echo
```
Expected: JSON com `items`, `total`, `library.state = "active"` (conta de teste). Se vier 307/401, a impersonação não está ativa — refaça `verification.md` §2. Guarde a saída em `$PLAN/evidence/task-05-list.json`.

- [ ] **Step 6: tsc sem erro novo** e testes `bun test lib/media-library` PASS.

- [ ] **Step 7: Commit**

```bash
cd $FE && git add lib/media-library/repository.ts lib/media-library/server.ts lib/media-library/server.test.ts app/api/files/media-library && git add -f docs/superpowers/plans/2026-10-13-media-library/evidence/task-05-list.json && git commit -m "feat(biblioteca): rotas do cliente — lista paginada, upload pré-assinado, confirmação, exclusão e download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cron de retenção e fim dos 7 dias no app

**Files:**
- Create: `$FE/lib/media-library/retention.ts`, `$FE/lib/media-library/retention.test.ts`
- Create: `$FE/app/api/cron-job/media-library/retention/route.ts`
- Modify: `$FE/lib/media-library/server.ts` (+ `createMediaLibraryRetentionDeps`)
- Modify: `$FE/app/api/cron-job/cleanup-blob-storage/route.ts` (sai o branch `campaign_media`)
- Modify: `$FE/vercel.json`
- Create: `$FE/tests/media-library-retention-contract.test.ts`

**Interfaces:**
- Consumes: `getMediaLibraryStatus`, `mediaLibraryUserPrefix` (policy); repositório da Tarefa 5 (`findMediaLibraryRetentionCandidates`, `listLiveMediaLibraryRecords`, `markMediaLibraryRecordsDeletedByRetention`); `mediaLibraryStorage.deleteUrls`, `listMediaLibraryObjectKeys`, `deleteMediaLibraryObjectKeys` (storage); `mediaUrlToKey` (`@/lib/storage/media-r2`); `isBypassStripeEmail`; `checkCronAuth` (`@/lib/cron/auth`).
- Produces: `MEDIA_LIBRARY_RETENTION_PREFILTER_DAYS = 28`, tipos `MediaLibraryRetentionDeps`, `MediaLibraryRetentionReport` (inclui `dryRun: boolean`), função `runMediaLibraryRetention(deps, { shouldStop, dryRun? })`; `createMediaLibraryRetentionDeps(): MediaLibraryRetentionDeps`. A rota aceita `?dryRun=1`: lista o que seria apagado sem apagar nada (seguro na staging e para conferir antes da primeira execução em produção).

- [ ] **Step 1: Teste que falha** — crie `$FE/lib/media-library/retention.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMediaLibraryRetention, type MediaLibraryRetentionDeps } from "./retention";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeDeps(over: Partial<MediaLibraryRetentionDeps> = {}) {
  const log = { deletedUrls: [] as string[], deletedKeys: [] as string[], marked: [] as string[], cutoff: null as Date | null };
  const deps: MediaLibraryRetentionDeps = {
    now: () => NOW,
    globalBypass: false,
    isBypassEmail: () => false,
    findCandidates: async (cutoff) => {
      log.cutoff = cutoff;
      return [
        { userId: A, email: "a@x.com", expirationDate: new Date(NOW.getTime() - 40 * DAY) },
        { userId: B, email: "b@x.com", expirationDate: new Date(NOW.getTime() - 29 * DAY) },
      ];
    },
    listLiveRecords: async (userId) =>
      userId === A
        ? [
            { id: "r1", blobUrl: `https://m.test/media/library/${A}/1.png` },
            { id: "r2", blobUrl: `https://m.test/media/campaign-media/${A}/wa-2.jpg` },
          ]
        : [{ id: "r3", blobUrl: `https://m.test/media/library/${B}/3.png` }],
    listPrefixKeys: async (prefix) => [`${prefix}1.png`, `${prefix}orfao.png`],
    deleteUrls: async (urls) => {
      log.deletedUrls.push(...urls);
      return { deletedUrls: urls, failed: [] };
    },
    deleteKeys: async (keys) => {
      log.deletedKeys.push(...keys);
      return { deletedKeys: keys, failed: [] };
    },
    markDeleted: async (ids) => {
      log.marked.push(...ids);
    },
    keyFromUrl: (url) => new URL(url).pathname.slice(1),
    ...over,
  };
  return { deps, log };
}

describe("runMediaLibraryRetention", () => {
  it("apaga só clientes encerrados: linhas e órfãos do prefixo", async () => {
    const { deps, log } = makeDeps();
    const report = await runMediaLibraryRetention(deps, { shouldStop: () => false });
    assert.equal(log.cutoff?.toISOString(), new Date(NOW.getTime() - 28 * DAY).toISOString());
    // B expirou há 29 dias: ainda está na carência (purgeAt = exp + 1 mês) → intocado.
    assert.deepEqual(log.marked, ["r1", "r2"]);
    assert.deepEqual(log.deletedKeys, [`media/library/${A}/orfao.png`]);
    assert.equal(report.purgedUsers, 1);
    assert.equal(report.deletedRows, 2);
    assert.equal(report.deletedOrphanObjects, 1);
    assert.equal(report.skipped, false);
  });
  it("e-mail de bypass nunca é apagado", async () => {
    const { deps, log } = makeDeps({ isBypassEmail: (email) => email === "a@x.com" });
    await runMediaLibraryRetention(deps, { shouldStop: () => false });
    assert.deepEqual(log.marked, []);
  });
  it("BYPASS_STRIPE global não faz nada", async () => {
    const { deps, log } = makeDeps({ globalBypass: true });
    const report = await runMediaLibraryRetention(deps, { shouldStop: () => false });
    assert.equal(report.skipped, true);
    assert.equal(log.cutoff, null);
  });
  it("chave que falhou no storage não marca a linha", async () => {
    const { deps, log } = makeDeps({
      deleteUrls: async (urls) => ({ deletedUrls: urls.slice(1), failed: [{ url: urls[0]!, message: "denied" }] }),
    });
    const report = await runMediaLibraryRetention(deps, { shouldStop: () => false });
    assert.deepEqual(log.marked, ["r2"]);
    assert.equal(report.failedObjects, 1);
  });
  it("erro num cliente não derruba os outros; orçamento esgotado trunca", async () => {
    const failing = makeDeps({
      listLiveRecords: async () => {
        throw new Error("db");
      },
    });
    const report = await runMediaLibraryRetention(failing.deps, { shouldStop: () => false });
    assert.equal(report.erroredUsers, 1);
    const stopped = makeDeps();
    const truncated = await runMediaLibraryRetention(stopped.deps, { shouldStop: () => true });
    assert.equal(truncated.truncated, true);
    assert.deepEqual(stopped.log.marked, []);
  });
  it("dryRun conta o que seria apagado sem apagar nem marcar", async () => {
    const { deps, log } = makeDeps();
    const report = await runMediaLibraryRetention(deps, { shouldStop: () => false, dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.purgedUsers, 1);
    assert.equal(report.deletedRows, 2);
    assert.equal(report.deletedOrphanObjects, 1);
    assert.deepEqual(log.deletedUrls, []);
    assert.deepEqual(log.deletedKeys, []);
    assert.deepEqual(log.marked, []);
  });
  it("expiração nula é apagada", async () => {
    const { deps, log } = makeDeps({
      findCandidates: async () => [{ userId: A, email: "a@x.com", expirationDate: null }],
    });
    await runMediaLibraryRetention(deps, { shouldStop: () => false });
    assert.deepEqual(log.marked, ["r1", "r2"]);
  });
});
```
Run: `cd $FE && bun test lib/media-library/retention.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar** — crie `$FE/lib/media-library/retention.ts`:

```ts
/**
 * Retenção da Biblioteca de mídias (spec 2026-10-13, R14): apaga do R2 e marca
 * (`deleted_reason = 'retention'`) TODAS as mídias de clientes cuja biblioteca
 * está Encerrada (acesso nulo ou vencido há 1 mês ou mais). Único apagador
 * automático da biblioteca — substitui os 7 dias do ADR 0021.
 */
import { getMediaLibraryStatus, mediaLibraryUserPrefix } from "@/lib/media-library/policy";

/** Pré-filtro largo no SQL; a decisão final é `getMediaLibraryStatus(...) === "closed"`. */
export const MEDIA_LIBRARY_RETENTION_PREFILTER_DAYS = 28;

export type MediaLibraryRetentionCandidate = {
  userId: string;
  email: string | null;
  expirationDate: Date | null;
};

export type MediaLibraryRetentionDeps = {
  now(): Date;
  globalBypass: boolean;
  isBypassEmail(email: string | null): boolean;
  findCandidates(cutoff: Date): Promise<MediaLibraryRetentionCandidate[]>;
  listLiveRecords(userId: string): Promise<{ id: string; blobUrl: string }[]>;
  listPrefixKeys(prefix: string): Promise<string[]>;
  deleteUrls(urls: string[]): Promise<{ deletedUrls: string[]; failed: { url: string; message: string }[] }>;
  deleteKeys(keys: string[]): Promise<{ deletedKeys: string[]; failed: { key: string; message: string }[] }>;
  markDeleted(ids: string[], at: Date): Promise<void>;
  keyFromUrl(url: string): string | null;
};

export type MediaLibraryRetentionReport = {
  /** true = só contou; nada foi apagado nem marcado. */
  dryRun: boolean;
  skipped: boolean;
  candidates: number;
  purgedUsers: number;
  deletedRows: number;
  deletedOrphanObjects: number;
  failedObjects: number;
  erroredUsers: number;
  truncated: boolean;
};

export async function runMediaLibraryRetention(
  deps: MediaLibraryRetentionDeps,
  options: { shouldStop: () => boolean; dryRun?: boolean },
): Promise<MediaLibraryRetentionReport> {
  const dryRun = options.dryRun === true;
  const report: MediaLibraryRetentionReport = {
    dryRun,
    skipped: false,
    candidates: 0,
    purgedUsers: 0,
    deletedRows: 0,
    deletedOrphanObjects: 0,
    failedObjects: 0,
    erroredUsers: 0,
    truncated: false,
  };
  if (deps.globalBypass) return { ...report, skipped: true };

  const now = deps.now();
  const cutoff = new Date(now.getTime() - MEDIA_LIBRARY_RETENTION_PREFILTER_DAYS * 86_400_000);
  const candidates = await deps.findCandidates(cutoff);
  report.candidates = candidates.length;

  for (const candidate of candidates) {
    if (options.shouldStop()) {
      report.truncated = true;
      break;
    }
    const status = getMediaLibraryStatus({
      expirationDate: candidate.expirationDate,
      hasBillingBypass: deps.isBypassEmail(candidate.email),
      now,
    });
    if (status.state !== "closed") continue;

    try {
      const records = await deps.listLiveRecords(candidate.userId);
      if (dryRun) {
        const handled = new Set(
          records.map((record) => deps.keyFromUrl(record.blobUrl)).filter((key): key is string => Boolean(key)),
        );
        const orphans = (await deps.listPrefixKeys(mediaLibraryUserPrefix(candidate.userId))).filter(
          (key) => !handled.has(key),
        );
        report.purgedUsers += 1;
        report.deletedRows += records.length;
        report.deletedOrphanObjects += orphans.length;
        continue;
      }
      const urlResult = await deps.deleteUrls(records.map((record) => record.blobUrl));
      const deletedUrls = new Set(urlResult.deletedUrls);
      const deletedIds = records.filter((record) => deletedUrls.has(record.blobUrl)).map((record) => record.id);
      if (deletedIds.length > 0) await deps.markDeleted(deletedIds, now);

      const handledKeys = new Set(
        records.map((record) => deps.keyFromUrl(record.blobUrl)).filter((key): key is string => Boolean(key)),
      );
      const orphanKeys = (await deps.listPrefixKeys(mediaLibraryUserPrefix(candidate.userId))).filter(
        (key) => !handledKeys.has(key),
      );
      const keyResult = orphanKeys.length > 0 ? await deps.deleteKeys(orphanKeys) : { deletedKeys: [], failed: [] };

      report.purgedUsers += 1;
      report.deletedRows += deletedIds.length;
      report.deletedOrphanObjects += keyResult.deletedKeys.length;
      report.failedObjects += urlResult.failed.length + keyResult.failed.length;
    } catch (error) {
      report.erroredUsers += 1;
      console.error("[media-library/retention] cliente falhou", { userId: candidate.userId, error });
    }
  }
  return report;
}
```

Acrescente a `$FE/lib/media-library/server.ts`:
```ts
import {
  findMediaLibraryRetentionCandidates,
  listLiveMediaLibraryRecords,
  markMediaLibraryRecordsDeletedByRetention,
} from "@/lib/media-library/repository";
import type { MediaLibraryRetentionDeps } from "@/lib/media-library/retention";
import { deleteMediaLibraryObjectKeys, listMediaLibraryObjectKeys } from "@/lib/media-library/storage";
import { mediaUrlToKey } from "@/lib/storage/media-r2";

export function createMediaLibraryRetentionDeps(): MediaLibraryRetentionDeps {
  return {
    now: () => new Date(),
    globalBypass: process.env.BYPASS_STRIPE === "true",
    isBypassEmail: (email) => isBypassStripeEmail(email),
    findCandidates: findMediaLibraryRetentionCandidates,
    listLiveRecords: listLiveMediaLibraryRecords,
    listPrefixKeys: listMediaLibraryObjectKeys,
    deleteUrls: (urls) => mediaLibraryStorage.deleteUrls(urls),
    deleteKeys: deleteMediaLibraryObjectKeys,
    markDeleted: markMediaLibraryRecordsDeletedByRetention,
    keyFromUrl: mediaUrlToKey,
  };
}
```
(Junte os imports aos que já existem no topo do arquivo; não duplique `import`.)

Run: `cd $FE && bun test lib/media-library/retention.test.ts` → Expected: PASS.

- [ ] **Step 3: Rota do cron** — crie `$FE/app/api/cron-job/media-library/retention/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron/auth";
import { runMediaLibraryRetention } from "@/lib/media-library/retention";
import { createMediaLibraryRetentionDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** Para antes do teto da função; o que sobrar fica para o dia seguinte (idempotente). */
const TIME_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const startedAt = Date.now();
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const report = await runMediaLibraryRetention(createMediaLibraryRetentionDeps(), {
    shouldStop: () => Date.now() - startedAt > TIME_BUDGET_MS,
    dryRun,
  });
  console.info("[media-library/retention]", report);
  return NextResponse.json({ executed_at: new Date(startedAt).toISOString(), ...report });
}
```

- [ ] **Step 4: Contrato que falha** — crie `$FE/tests/media-library-retention-contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("retenção da Biblioteca de mídias", () => {
  it("vercel.json agenda o cron diário de retenção às 06:00 UTC", () => {
    const crons = JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[];
    assert.deepEqual(crons.find((c) => c.path === "/api/cron-job/media-library/retention"), {
      path: "/api/cron-job/media-library/retention",
      schedule: "0 6 * * *",
    });
  });
  it("cleanup-blob-storage não apaga mais a biblioteca por idade", () => {
    const source = read("app/api/cron-job/cleanup-blob-storage/route.ts");
    assert.doesNotMatch(source, /campaign_media/);
    assert.doesNotMatch(source, /7 \* 24/);
    assert.match(source, /claimAbandonedPostDoPratoUploads/);
  });
  it("a listagem não filtra mais por 7 dias", () => {
    assert.doesNotMatch(read("app/api/files/media-library/route.ts"), /RETENTION_MS|7 \* 24/);
  });
});
```
Run: `cd $FE && bun test tests/media-library-retention-contract.test.ts` → Expected: FAIL nos dois primeiros.

- [ ] **Step 5: `vercel.json`** — no array `crons` de `$FE/vercel.json`, logo depois da entrada de `/api/cron-job/cleanup-blob-storage`, acrescente:
```json
    {
      "path": "/api/cron-job/media-library/retention",
      "schedule": "0 6 * * *"
    },
```
(mantenha JSON válido e a indentação do arquivo.)

- [ ] **Step 6: Tirar os 7 dias do `cleanup-blob-storage`** — em `$FE/app/api/cron-job/cleanup-blob-storage/route.ts`:
  1. Apague as constantes `STALE_UPLOAD_AGE_MS` e `CAMPAIGN_MEDIA_SOURCE` e troque o comentário do topo por:
     ```ts
     // Só limpa uploads abandonados do Post do Prato (24 h). A Biblioteca de mídias
     // (blob_uploads da biblioteca) saiu daqui: o único apagador automático dela é o cron
     // /api/cron-job/media-library/retention (ADR 0042, substitui o 0021).
     ```
  2. Apague a consulta `staleCampaignUploads` inteira e troque `const staleUploads = [...staleCampaignUploads, ...abandonedPostDoPratoUploads];` por `const staleUploads = abandonedPostDoPratoUploads;`.
  3. Troque `const staleBefore = new Date(now.getTime() - STALE_UPLOAD_AGE_MS);` por `const staleBefore = new Date(now.getTime() - POST_DO_PRATO_UPLOAD_TTL_MS);` e use `staleBefore` no `claimAbandonedPostDoPratoUploads({ staleBefore, ... })`.
  4. Remova do import do `drizzle-orm` o que ficar sem uso (`and`, `eq`, `isNull`, `lt` — confira; `inArray` continua).
  O formato da resposta JSON não muda.

Run: `cd $FE && bun test tests/media-library-retention-contract.test.ts lib/media-library` → Expected: PASS.

- [ ] **Step 7: Verificação do cron (SÓ dryRun na staging)** — a staging tem `BYPASS_STRIPE=false`: uma chamada real marcaria como excluídas linhas de OUTROS usuários de staging (o S3 local aceita apagar chave inexistente). Por isso, aqui só `dryRun=1`. Com o dev server do FE no ar:
```bash
cd $FE && CRON=$(grep -E '^CRON_SECRET=' .env.staging | cut -d= -f2- | tr -d '"')
curl -s -H "Authorization: Bearer $CRON" "http://localhost:3000/api/cron-job/media-library/retention?dryRun=1" > $PLAN/evidence/task-06-retention-dryrun.json
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/cron-job/media-library/retention?dryRun=1"
```
Expected: o JSON tem `dryRun: true` e os contadores (`candidates`, `purgedUsers`, `deletedRows`); sem o header, `401`. **Nunca** chame a rota sem `dryRun=1` contra a staging.

- [ ] **Step 8: tsc sem erro novo; commit**

```bash
cd $FE && git add lib/media-library/retention.ts lib/media-library/retention.test.ts lib/media-library/server.ts app/api/cron-job/media-library app/api/cron-job/cleanup-blob-storage/route.ts vercel.json && git add -f tests/media-library-retention-contract.test.ts docs/superpowers/plans/2026-10-13-media-library/evidence/task-06-retention-dryrun.json && git commit -m "feat(biblioteca): cron de retenção por acesso e fim da exclusão de 7 dias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Rotas do backoffice com autoria e auditoria; fim do apagador pós-Meta

**Files:**
- Create: `$BO/lib/media-library/repository.ts`, `$BO/lib/media-library/server.ts`, `$BO/lib/media-library/audit.ts`, `$BO/lib/media-library/audit.test.ts`, `$BO/lib/media-library/backoffice-context.ts`, `$BO/lib/media-library/backoffice-context.test.ts`
- Create: `$BO/app/api/users/[id]/media-library/route.ts`, `.../uploads/route.ts`, `.../[mediaId]/route.ts`, `.../[mediaId]/download/route.ts`
- Modify: `$BO/app/(admin)/users/[id]/user-hub-page.tsx` (`FIELD_LABELS`)
- Delete: `$BO/lib/meta-business/marketing/cleanup-blob-after-meta.ts` (e teste, se existir)
- Modify: `$BO/app/api/meta-marketing/[accountId]/ads/[adId]/creative/route.ts`, `$BO/app/api/meta-marketing/[accountId]/adsets/[adsetId]/ads/route.ts`
- Create: `$BO/tests/media-library-no-post-meta-cleanup.test.ts`

**Interfaces:**
- Consumes: espelhos `@/lib/media-library/{policy,service,handlers,storage}`; `requireMarketingUserAccessResponse` (`@/lib/auth/rbac`); `hasBackofficePermission`, `canAccessMarketingUser`, `BackofficeActor` (`@/lib/auth/rbac-core`); `db` (`@/lib/db`); `blobUpload`, `user`, `backofficeAuditLog` (`@/lib/db/schema`); `isBypassStripeEmail` (`@/lib/access/billing-bypass`).
- Produces: `buildMediaLibraryAuditEntry({ action, adminEmail, targetUserId, filename })`, `MEDIA_LIBRARY_AUDIT_FIELD = "media_library"`; `buildBackofficeMediaLibraryContext(actor: BackofficeActor, userId: string): MediaLibraryRequestContext`; `resolveBackofficeMediaLibraryContext(userId, permission)`; `createBackofficeMediaLibraryDeps(): MediaLibraryDeps`.

- [ ] **Step 1: Testes que falham** — crie `$BO/lib/media-library/audit.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMediaLibraryAuditEntry } from "./audit";

describe("buildMediaLibraryAuditEntry", () => {
  it("adição: novo valor = nome do arquivo", () => {
    assert.deepEqual(
      buildMediaLibraryAuditEntry({ action: "media_library_add", adminEmail: "ana@x.com", targetUserId: "u1", filename: "bolo.png" }),
      { adminEmail: "ana@x.com", targetUserId: "u1", action: "media_library_add", fieldName: "media_library", oldValue: null, newValue: "bolo.png", note: null },
    );
  });
  it("exclusão: valor antigo = nome, novo = excluída; e-mail cortado em 100", () => {
    const entry = buildMediaLibraryAuditEntry({ action: "media_library_delete", adminEmail: `${"a".repeat(120)}@x.com`, targetUserId: "u1", filename: "  " });
    assert.equal(entry.oldValue, "mídia");
    assert.equal(entry.newValue, "excluída");
    assert.equal(entry.adminEmail.length, 100);
  });
});
```

Crie `$BO/lib/media-library/backoffice-context.test.ts`:
```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBackofficeMediaLibraryContext } from "./backoffice-context";

const base = { id: "a1", source: "database" as const };

describe("buildBackofficeMediaLibraryContext", () => {
  it("admin escreve em qualquer cliente", () => {
    const ctx = buildBackofficeMediaLibraryContext({ ...base, email: "adm@x.com", role: "admin" }, "u1");
    assert.deepEqual(ctx, { userId: "u1", actor: { kind: "backoffice", email: "adm@x.com" }, viewer: { canWrite: true } });
  });
  it("consultor só escreve no cliente atribuído", () => {
    const consultant = { ...base, email: "c@x.com", role: "marketing_consultant" as const, assignedUserIds: ["u1"] };
    assert.equal(buildBackofficeMediaLibraryContext(consultant, "u1").viewer?.canWrite, true);
    assert.equal(buildBackofficeMediaLibraryContext(consultant, "u2").viewer?.canWrite, false);
  });
});
```
Run: `cd $BO && bun test lib/media-library/audit.test.ts lib/media-library/backoffice-context.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar `audit.ts`**:

```ts
/** Linha de `backoffice_audit_logs` para adição/exclusão na Biblioteca de mídias. */
export const MEDIA_LIBRARY_AUDIT_FIELD = "media_library";
export type MediaLibraryAuditAction = "media_library_add" | "media_library_delete";

export function buildMediaLibraryAuditEntry(input: {
  action: MediaLibraryAuditAction;
  adminEmail: string;
  targetUserId: string;
  filename: string;
}) {
  const name = input.filename.trim() || "mídia";
  return {
    adminEmail: input.adminEmail.slice(0, 100),
    targetUserId: input.targetUserId,
    action: input.action,
    fieldName: MEDIA_LIBRARY_AUDIT_FIELD,
    oldValue: input.action === "media_library_delete" ? name : null,
    newValue: input.action === "media_library_add" ? name : "excluída",
    note: null,
  };
}
```

- [ ] **Step 3: Implementar `backoffice-context.ts`**:

```ts
import type { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  canAccessMarketingUser,
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
import type { MediaLibraryRequestContext } from "@/lib/media-library/handlers";

/** Ator do backoffice como autor; `canWrite` decide os botões de adicionar/excluir na tela. */
export function buildBackofficeMediaLibraryContext(
  actor: BackofficeActor,
  userId: string,
): MediaLibraryRequestContext {
  return {
    userId,
    actor: { kind: "backoffice", email: actor.email },
    viewer: {
      canWrite: hasBackofficePermission(actor, "marketing:write") && canAccessMarketingUser(actor, userId),
    },
  };
}

export async function resolveBackofficeMediaLibraryContext(
  userId: string,
  permission: "marketing:read" | "marketing:write",
): Promise<{ ok: true; context: MediaLibraryRequestContext } | { ok: false; response: NextResponse }> {
  const authz = await requireMarketingUserAccessResponse(userId, permission);
  if (!authz.ok) return { ok: false, response: authz.response };
  return { ok: true, context: buildBackofficeMediaLibraryContext(authz.actor, userId) };
}
```
**Se** importar `@/lib/auth/rbac` no teste quebrar (ele puxa `next-auth`/`next/headers`), mova `buildBackofficeMediaLibraryContext` para `lib/media-library/backoffice-context-core.ts` (só com `rbac-core`), importe-o daqui e aponte o teste para o `-core`.

Run: `cd $BO && bun test lib/media-library/audit.test.ts lib/media-library/backoffice-context.test.ts` → Expected: PASS.

- [ ] **Step 4: Repositório do BO** — crie `$BO/lib/media-library/repository.ts` (mesma lógica de consulta do app; inserção e exclusão gravam a auditoria na mesma transação quando o ator é do backoffice):

```ts
import { and, count, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { backofficeAuditLog, blobUpload, user } from "@/lib/db/schema";
import { buildMediaLibraryAuditEntry } from "@/lib/media-library/audit";
import {
  MEDIA_LIBRARY_SOURCE,
  MEDIA_LIBRARY_VIDEO_TYPES,
  isUuidLike,
  type MediaLibraryCursor,
  type MediaLibraryDeletedReason,
  type MediaLibraryTypeFilter,
} from "@/lib/media-library/policy";
import {
  mediaLibraryDisplayFilename,
  type MediaLibraryActor,
  type MediaLibraryOwner,
  type MediaLibraryRecord,
  type NewMediaLibraryRecord,
} from "@/lib/media-library/service";

const RECORD_COLUMNS = {
  id: blobUpload.id,
  userId: blobUpload.userId,
  blobUrl: blobUpload.blobUrl,
  pathname: blobUpload.pathname,
  filename: blobUpload.filename,
  contentType: blobUpload.contentType,
  sizeBytes: blobUpload.sizeBytes,
  uploadedByBackofficeEmail: blobUpload.uploadedByBackofficeEmail,
  createdAt: blobUpload.createdAt,
};

const VIDEO_TYPES: string[] = [...MEDIA_LIBRARY_VIDEO_TYPES];
/** Ordenar e comparar no MESMO valor em milissegundos (ver o repositório do app). */
const createdAtMs = sql`date_trunc('milliseconds', ${blobUpload.createdAt})`;

function liveLibraryRows(userId: string): SQL {
  return and(
    eq(blobUpload.userId, userId),
    eq(blobUpload.source, MEDIA_LIBRARY_SOURCE),
    isNull(blobUpload.deletedAt),
  ) as SQL;
}

function typeCondition(type: MediaLibraryTypeFilter): SQL | undefined {
  if (type === "video") return inArray(blobUpload.contentType, VIDEO_TYPES);
  if (type === "image") {
    return or(isNull(blobUpload.contentType), notInArray(blobUpload.contentType, VIDEO_TYPES));
  }
  return undefined;
}

function cursorCondition(cursor: MediaLibraryCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${createdAtMs}, ${blobUpload.id}) < (${cursor.createdAt.toISOString()}::timestamp, ${cursor.id}::uuid)`;
}

export async function findMediaLibraryOwner(userId: string): Promise<MediaLibraryOwner | null> {
  if (!isUuidLike(userId)) return null;
  const [row] = await db
    .select({ id: user.id, email: user.email, expirationDate: user.expirationDate })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}

export async function listMediaLibraryRecords(query: {
  userId: string;
  type: MediaLibraryTypeFilter;
  cursor: MediaLibraryCursor | null;
  limit: number;
}): Promise<MediaLibraryRecord[]> {
  return db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(and(liveLibraryRows(query.userId), typeCondition(query.type), cursorCondition(query.cursor)))
    .orderBy(sql`${createdAtMs} desc`, sql`${blobUpload.id} desc`)
    .limit(query.limit);
}

export async function countMediaLibraryRecords(query: {
  userId: string;
  type: MediaLibraryTypeFilter;
}): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(blobUpload)
    .where(and(liveLibraryRows(query.userId), typeCondition(query.type)));
  return Number(row?.value ?? 0);
}

export async function findMediaLibraryRecord(query: {
  userId: string;
  id: string;
}): Promise<MediaLibraryRecord | null> {
  if (!isUuidLike(query.id)) return null;
  const [row] = await db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(and(eq(blobUpload.id, query.id), liveLibraryRows(query.userId)))
    .limit(1);
  return row ?? null;
}

export async function insertMediaLibraryRecord(
  input: NewMediaLibraryRecord,
  actor: MediaLibraryActor,
): Promise<MediaLibraryRecord> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [inserted] = await tx
      .insert(blobUpload)
      .values({ ...input, source: MEDIA_LIBRARY_SOURCE, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: blobUpload.blobUrl })
      .returning(RECORD_COLUMNS);
    if (inserted) {
      if (actor.kind === "backoffice") {
        await tx.insert(backofficeAuditLog).values(
          buildMediaLibraryAuditEntry({
            action: "media_library_add",
            adminEmail: actor.email,
            targetUserId: input.userId,
            filename: input.filename ?? "",
          }),
        );
      }
      return inserted;
    }
    const [existing] = await tx
      .select(RECORD_COLUMNS)
      .from(blobUpload)
      .where(eq(blobUpload.blobUrl, input.blobUrl))
      .limit(1);
    if (!existing) throw new Error("media_library_insert_conflict");
    return existing;
  });
}

export async function markMediaLibraryRecordDeleted(input: {
  record: MediaLibraryRecord;
  reason: MediaLibraryDeletedReason;
  at: Date;
  actor: MediaLibraryActor;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(blobUpload)
      .set({ deletedAt: input.at, updatedAt: input.at, deletedReason: input.reason })
      .where(and(eq(blobUpload.id, input.record.id), isNull(blobUpload.deletedAt)))
      .returning({ id: blobUpload.id });
    if (updated.length > 0 && input.actor.kind === "backoffice") {
      await tx.insert(backofficeAuditLog).values(
        buildMediaLibraryAuditEntry({
          action: "media_library_delete",
          adminEmail: input.actor.email,
          targetUserId: input.record.userId,
          filename: mediaLibraryDisplayFilename(input.record),
        }),
      );
    }
  });
}
```
Se `@/lib/db` não exportar `db`, use o caminho que as outras rotas do BO usam (`grep -rn "import { db }" app/api | head -3`).

- [ ] **Step 5: Fábrica do BO** — crie `$BO/lib/media-library/server.ts`:

```ts
import { isBypassStripeEmail } from "@/lib/access/billing-bypass";
import {
  countMediaLibraryRecords,
  findMediaLibraryOwner,
  findMediaLibraryRecord,
  insertMediaLibraryRecord,
  listMediaLibraryRecords,
  markMediaLibraryRecordDeleted,
} from "@/lib/media-library/repository";
import type { MediaLibraryDeps } from "@/lib/media-library/service";
import { mediaLibraryStorage } from "@/lib/media-library/storage";

/** Mesma regra do app: o cliente com bypass de cobrança tem a biblioteca sempre Ativa. */
export function createBackofficeMediaLibraryDeps(): MediaLibraryDeps {
  return {
    now: () => new Date(),
    hasBillingBypass: (owner) => process.env.BYPASS_STRIPE === "true" || isBypassStripeEmail(owner.email),
    findOwner: findMediaLibraryOwner,
    listRecords: listMediaLibraryRecords,
    countRecords: countMediaLibraryRecords,
    findRecord: findMediaLibraryRecord,
    insertRecord: insertMediaLibraryRecord,
    markDeleted: markMediaLibraryRecordDeleted,
    storage: mediaLibraryStorage,
  };
}
```

- [ ] **Step 6: Rotas do BO** — crie `$BO/app/api/users/[id]/media-library/route.ts`:

```ts
import { handleMediaLibraryConfirm, handleMediaLibraryList } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Biblioteca de mídias de um cliente (leitura: marketing:read). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:read");
  if (!access.ok) return access.response;
  return handleMediaLibraryList(request, access.context, createBackofficeMediaLibraryDeps());
}

/** Confirma upload feito pelo admin; o admin fica registrado como autor (marketing:write). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryConfirm(request, access.context, createBackofficeMediaLibraryDeps());
}
```
Crie `.../media-library/uploads/route.ts`:
```ts
import { handleMediaLibraryPresign } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryPresign(request, access.context, createBackofficeMediaLibraryDeps());
}
```
Crie `.../media-library/[mediaId]/route.ts`:
```ts
import { handleMediaLibraryDelete } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryDelete(mediaId, access.context, createBackofficeMediaLibraryDeps());
}
```
Crie `.../media-library/[mediaId]/download/route.ts`:
```ts
import { handleMediaLibraryDownload } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:read");
  if (!access.ok) return access.response;
  return handleMediaLibraryDownload(request, mediaId, access.context, createBackofficeMediaLibraryDeps());
}
```

- [ ] **Step 7: Rótulo na Auditoria** — em `$BO/app/(admin)/users/[id]/user-hub-page.tsx`, acrescente ao objeto `FIELD_LABELS`: `media_library: "Biblioteca de mídias",`.

- [ ] **Step 8: Contrato do apagador pós-Meta (falha primeiro)** — crie `$BO/tests/media-library-no-post-meta-cleanup.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Biblioteca de mídias: só exclusão explícita e retenção apagam mídia", () => {
  it("o apagador pós-ingestão da Meta não existe mais", () => {
    assert.equal(existsSync(join(root, "lib/meta-business/marketing/cleanup-blob-after-meta.ts")), false);
  });
  it("as rotas de anúncio não chamam mais o apagador", () => {
    for (const path of [
      "app/api/meta-marketing/[accountId]/ads/[adId]/creative/route.ts",
      "app/api/meta-marketing/[accountId]/adsets/[adsetId]/ads/route.ts",
    ]) {
      assert.doesNotMatch(readFileSync(join(root, path), "utf8"), /cleanupBlobAfterMetaIngestion/);
    }
  });
});
```
Run: `cd $BO && bun test tests/media-library-no-post-meta-cleanup.test.ts` → Expected: FAIL.

- [ ] **Step 9: Remover o apagador** — nos dois arquivos de rota, apague o `import { cleanupBlobAfterMetaIngestion } ...` e o bloco:
```ts
    if (blobUrlForCleanup) {
      void cleanupBlobAfterMetaIngestion({
        ...
      }).catch(() => {});
    }
```
Mantenha a variável `blobUrlForCleanup` (ela ainda alimenta `thumbnailUrl`); se quiser, renomeie para `deviceBlobUrl` nas duas ocorrências restantes do arquivo. Apague `lib/meta-business/marketing/cleanup-blob-after-meta.ts` e, se existir, `cleanup-blob-after-meta.test.ts`. Rode `grep -rn "cleanup-blob-after-meta\|cleanupBlobAfterMetaIngestion" app lib tests` → nenhum resultado além do teste novo.

Run: `cd $BO && bun test tests/media-library-no-post-meta-cleanup.test.ts lib/media-library` → Expected: PASS.

- [ ] **Step 10: Verificação de API** — suba o BO (`verification.md` §3), gere o cookie e rode:
```bash
TOKEN="$(cat "$SCRATCH/verification/bo-session.token")"
curl -s -b "backoffice_magic_session=$TOKEN" "http://localhost:3006/api/users/384f3178-3946-4fe5-b686-7f30adf16999/media-library" | head -c 400 > $BO/docs/superpowers/plans/2026-10-13-media-library/evidence/task-07-list.json
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3006/api/users/384f3178-3946-4fe5-b686-7f30adf16999/media-library"
```
Expected: JSON com `library.state`, `items` e `viewer.canWrite = true`; sem cookie → `307` (proxy manda para o login).

- [ ] **Step 11: lint por arquivo, tsc sem erro novo, commit**

```bash
cd $BO && bunx eslint lib/media-library app/api/users/\[id\]/media-library tests/media-library-no-post-meta-cleanup.test.ts
cd $BO && git add -A lib/media-library app/api/users/\[id\]/media-library app/\(admin\)/users/\[id\]/user-hub-page.tsx app/api/meta-marketing tests/media-library-no-post-meta-cleanup.test.ts lib/meta-business/marketing docs/superpowers/plans/2026-10-13-media-library/evidence/task-07-list.json && git commit -m "feat(biblioteca): rotas do backoffice com autoria e auditoria; fim da exclusão pós-Meta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Componentes de UI compartilhados (espelhados) e rótulos do app

**Files:**
- Create: `$FE/components/media-library/labels.ts`, `media-library-grid.tsx`, `media-preview-dialog.tsx`, `media-library-delete-dialog.tsx`, `media-library-upload-queue.tsx`, `media-library-panel.tsx`
- Create: `$FE/components/media-library/use-media-library-labels.ts` (só FE)
- Create: `$FE/components/media-library/media-library-panel.interaction.test.tsx`
- Modify: `$FE/messages/pt-BR.json`, `$FE/messages/en.json` (bloco `pages.mediaLibrary`)
- Modify: `$FE/tests/helpers/source-parity.ts` (6 componentes)
- Create (via sync): os 6 componentes em `$BO/components/media-library/`

**Interfaces:**
- Consumes: `hooks.ts`, `client.ts`, `policy.ts`, tipos do `service.ts`; `@/components/ui/{button,dialog,alert-dialog,progress}`; `lucide-react`; `sonner`; `@/lib/utils` (`cn`).
- Produces:
  - `labels.ts`: `type MediaLibraryLabels`, `PT_BR_MEDIA_LIBRARY_LABELS`.
  - `MediaLibraryGrid(props: MediaLibraryGridProps)` com `items`, `labels`, `mode: "manage" | "select"`, `uploaderDisplay: "badge" | "details"`, `selectedUrls?`, `multiple?`, `disableNewSelection?`, `busyIds?`, `canDelete?`, `onToggle?`, `onPreview?`, `onDownload?`, `onDelete?`, `className?`.
  - `MediaPreviewDialog({ item, labels, uploaderDisplay, onClose, onDownload })`.
  - `MediaLibraryDeleteDialog({ item, labels, onCancel, onConfirm })`.
  - `MediaLibraryUploadQueue({ queue, labels, onDismiss })`.
  - `MediaLibraryPanel(props: MediaLibraryPanelProps)` com `endpoints`, `labels`, `actor: "customer" | "backoffice"`, `uploaderDisplay`, `multiple`, `selectedUrls: ReadonlySet<string>`, `disableNewSelection`, `onToggle(item)`, `onUploaded(item)`, `onDeleted(item)`, `className?`.
  - `useMediaLibraryLabels(): MediaLibraryLabels` (FE, next-intl).

- [ ] **Step 1: `labels.ts`**:

```ts
import { MEDIA_LIBRARY_ERROR_MESSAGES, type MediaLibraryClientErrorCode } from "@/lib/media-library/policy";

/** Textos dos componentes da biblioteca. O app traduz (next-intl); o backoffice usa o pt-BR. */
export type MediaLibraryLabels = {
  teamBadge: string;
  uploadedByCustomer: string;
  uploadedByPrefix: string;
  videoBadge: string;
  preview: string;
  download: string;
  delete: string;
  previewAria: (name: string) => string;
  downloadAria: (name: string) => string;
  deleteAria: (name: string) => string;
  selectAria: (name: string) => string;
  deleteTitle: string;
  deleteDescription: (name: string) => string;
  deleteCancel: string;
  deleteConfirm: string;
  upload: string;
  uploadHint: string;
  uploadDisabledClosed: string;
  uploadDisabledSubscription: string;
  uploading: string;
  uploaded: string;
  dismiss: string;
  empty: string;
  emptyHint: string;
  loadError: string;
  retry: string;
  loadMore: string;
  deleteSuccess: string;
  deleteError: string;
  downloadError: string;
  errorMessage: (code: MediaLibraryClientErrorCode) => string;
  formatDate: (iso: string) => string;
};

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const PT_BR_MEDIA_LIBRARY_LABELS: MediaLibraryLabels = {
  teamBadge: "Equipe Automatize",
  uploadedByCustomer: "Cliente",
  uploadedByPrefix: "Enviada por",
  videoBadge: "Vídeo",
  preview: "Ver",
  download: "Baixar",
  delete: "Excluir",
  previewAria: (name) => `Ver ${name}`,
  downloadAria: (name) => `Baixar ${name}`,
  deleteAria: (name) => `Excluir ${name}`,
  selectAria: (name) => `Selecionar ${name}`,
  deleteTitle: "Excluir mídia?",
  deleteDescription: (name) =>
    `"${name}" será removida da biblioteca. Anúncios já publicados com essa mídia não são afetados.`,
  deleteCancel: "Cancelar",
  deleteConfirm: "Excluir",
  upload: "Enviar mídias",
  uploadHint: "JPG ou PNG até 5 MB · MP4, MOV ou WEBM até 300 MB",
  uploadDisabledClosed: "Biblioteca encerrada: o acesso expirou há mais de 1 mês.",
  uploadDisabledSubscription: "Renove a assinatura para enviar novas mídias.",
  uploading: "Enviando…",
  uploaded: "Enviada",
  dismiss: "Dispensar",
  empty: "A biblioteca está vazia",
  emptyHint: "Envie fotos e vídeos do produto para usar nas campanhas.",
  loadError: "Não foi possível carregar as mídias.",
  retry: "Tentar de novo",
  loadMore: "Carregar mais",
  deleteSuccess: "Mídia excluída",
  deleteError: "Não foi possível excluir a mídia.",
  downloadError: "Não foi possível baixar a mídia.",
  errorMessage: (code) => MEDIA_LIBRARY_ERROR_MESSAGES[code],
  formatDate: (iso) => DATE_FORMAT.format(new Date(iso)),
};
```

- [ ] **Step 2: `media-library-grid.tsx`**:

```tsx
"use client";

import type { ReactNode } from "react";
import { Check, Download, Eye, Loader2, Play, Trash2 } from "lucide-react";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { formatMediaLibraryBytes } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { cn } from "@/lib/utils";

export type MediaLibraryGridProps = {
  items: MediaLibraryItem[];
  labels: MediaLibraryLabels;
  mode: "manage" | "select";
  uploaderDisplay: "badge" | "details";
  selectedUrls?: ReadonlySet<string>;
  multiple?: boolean;
  disableNewSelection?: boolean;
  busyIds?: ReadonlySet<string>;
  canDelete?: boolean;
  onToggle?: (item: MediaLibraryItem) => void;
  onPreview?: (item: MediaLibraryItem) => void;
  onDownload?: (item: MediaLibraryItem) => void;
  onDelete?: (item: MediaLibraryItem) => void;
  className?: string;
};

function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function uploaderText(item: MediaLibraryItem, labels: MediaLibraryLabels): string {
  return item.uploadedBy === "backoffice"
    ? (item.uploadedByBackofficeEmail ?? labels.teamBadge)
    : labels.uploadedByCustomer;
}

export function MediaLibraryGrid({
  items,
  labels,
  mode,
  uploaderDisplay,
  selectedUrls,
  multiple = true,
  disableNewSelection = false,
  busyIds,
  canDelete = true,
  onToggle,
  onPreview,
  onDownload,
  onDelete,
  className,
}: MediaLibraryGridProps) {
  return (
    <ul
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6", className)}
      data-testid="media-library-grid"
    >
      {items.map((item) => {
        const selected = selectedUrls?.has(item.url) ?? false;
        const busy = busyIds?.has(item.id) ?? false;
        const dimmed = mode === "select" && disableNewSelection && !selected;
        const handleMain = () => {
          if (mode === "select") {
            if (!dimmed) onToggle?.(item);
          } else {
            onPreview?.(item);
          }
        };
        return (
          <li key={item.id} className="flex min-w-0 flex-col gap-1.5" data-testid="media-library-item" data-media-id={item.id}>
            <div
              className={cn(
                "group relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition-colors",
                selected ? "border-primary" : "border-transparent hover:border-primary/30",
                dimmed && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={handleMain}
                disabled={dimmed}
                aria-pressed={mode === "select" ? selected : undefined}
                aria-label={mode === "select" ? labels.selectAria(item.filename) : labels.previewAria(item.filename)}
                className={cn("block size-full", dimmed ? "cursor-not-allowed" : "cursor-pointer")}
              >
                {item.isVideo ? (
                  <video src={`${item.url}#t=0.1`} className="size-full object-cover" muted playsInline preload="metadata" />
                ) : (
                  <img src={item.url} alt={item.filename} loading="lazy" className="size-full object-cover" />
                )}
              </button>
              {item.isVideo ? (
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  <Play className="size-3" />
                  {labels.videoBadge}
                </span>
              ) : null}
              {mode === "select" && selected ? (
                <span
                  className={cn(
                    "pointer-events-none absolute right-1.5 top-1.5 flex size-5 items-center justify-center bg-primary text-primary-foreground shadow-sm",
                    multiple ? "rounded-full" : "rounded-md",
                  )}
                >
                  <Check className="size-3" />
                </span>
              ) : null}
              {busy ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </span>
              ) : null}
              {mode === "select" && canDelete && onDelete ? (
                <button
                  type="button"
                  aria-label={labels.deleteAria(item.filename)}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item);
                  }}
                  className="absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" title={item.filename}>
                {item.filename}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {labels.formatDate(item.createdAt)} · {formatMediaLibraryBytes(item.sizeBytes)}
              </p>
              {uploaderDisplay === "details" ? (
                <p className="truncate text-[11px] text-muted-foreground" title={uploaderText(item, labels)}>
                  {labels.uploadedByPrefix}: {uploaderText(item, labels)}
                </p>
              ) : item.uploadedBy === "backoffice" ? (
                <span className="mt-0.5 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {labels.teamBadge}
                </span>
              ) : null}
            </div>
            {mode === "manage" ? (
              <div className="flex items-center gap-1">
                <IconAction label={labels.previewAria(item.filename)} onClick={() => onPreview?.(item)} disabled={busy}>
                  <Eye className="size-3.5" />
                </IconAction>
                <IconAction label={labels.downloadAria(item.filename)} onClick={() => onDownload?.(item)} disabled={busy}>
                  <Download className="size-3.5" />
                </IconAction>
                {canDelete ? (
                  <IconAction label={labels.deleteAria(item.filename)} onClick={() => onDelete?.(item)} disabled={busy} destructive>
                    <Trash2 className="size-3.5" />
                  </IconAction>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: `media-preview-dialog.tsx`**:

```tsx
"use client";

import { Download } from "lucide-react";
import { uploaderText } from "@/components/media-library/media-library-grid";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMediaLibraryBytes } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";

export function MediaPreviewDialog({
  item,
  labels,
  uploaderDisplay,
  onClose,
  onDownload,
}: {
  item: MediaLibraryItem | null;
  labels: MediaLibraryLabels;
  uploaderDisplay: "badge" | "details";
  onClose: () => void;
  onDownload: (item: MediaLibraryItem) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate pr-6">{item.filename}</DialogTitle>
              <DialogDescription>
                {labels.formatDate(item.createdAt)} · {formatMediaLibraryBytes(item.sizeBytes)}
                {uploaderDisplay === "details" ? ` · ${labels.uploadedByPrefix}: ${uploaderText(item, labels)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-lg bg-muted">
              {item.isVideo ? (
                <video src={item.url} controls playsInline className="max-h-[70vh] w-full" />
              ) : (
                <img src={item.url} alt={item.filename} className="max-h-[70vh] w-auto object-contain" />
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onDownload(item)}>
                <Download className="size-4" />
                {labels.download}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: `media-library-delete-dialog.tsx`**:

```tsx
"use client";

import type { MediaLibraryLabels } from "@/components/media-library/labels";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { MediaLibraryItem } from "@/lib/media-library/service";

export function MediaLibraryDeleteDialog({
  item,
  labels,
  onCancel,
  onConfirm,
}: {
  item: MediaLibraryItem | null;
  labels: MediaLibraryLabels;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={item !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{item ? labels.deleteDescription(item.filename) : ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.deleteCancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {labels.deleteConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: `media-library-upload-queue.tsx`**:

```tsx
"use client";

import { X } from "lucide-react";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Progress } from "@/components/ui/progress";
import type { MediaLibraryUploadQueueItem } from "@/lib/media-library/hooks";
import { cn } from "@/lib/utils";

export function MediaLibraryUploadQueue({
  queue,
  labels,
  onDismiss,
}: {
  queue: MediaLibraryUploadQueueItem[];
  labels: MediaLibraryLabels;
  onDismiss: (id: string) => void;
}) {
  if (queue.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="media-library-upload-queue">
      {queue.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
          data-status={entry.status}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium">{entry.name}</p>
              <span className={cn("shrink-0 text-[11px]", entry.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                {entry.status === "uploading"
                  ? `${labels.uploading} ${entry.progress}%`
                  : entry.status === "done"
                    ? labels.uploaded
                    : labels.errorMessage(entry.errorCode ?? "upload_failed")}
              </span>
            </div>
            {entry.status !== "error" ? <Progress value={entry.progress} className="mt-1.5 h-1.5" /> : null}
          </div>
          {entry.status === "error" ? (
            <button
              type="button"
              aria-label={labels.dismiss}
              onClick={() => onDismiss(entry.id)}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: `media-library-panel.tsx`** (usado pelos seletores dos dois apps):

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { MediaLibraryDeleteDialog } from "@/components/media-library/media-library-delete-dialog";
import { MediaLibraryGrid } from "@/components/media-library/media-library-grid";
import { MediaLibraryUploadQueue } from "@/components/media-library/media-library-upload-queue";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import { Button } from "@/components/ui/button";
import { requestMediaLibraryDelete, type MediaLibraryEndpoints } from "@/lib/media-library/client";
import { useMediaLibrary, useMediaLibraryUpload } from "@/lib/media-library/hooks";
import {
  MEDIA_LIBRARY_ACCEPT_ATTRIBUTE,
  canBackofficeUpload,
  canCustomerUpload,
} from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { cn } from "@/lib/utils";

export type MediaLibraryPanelProps = {
  endpoints: MediaLibraryEndpoints;
  labels: MediaLibraryLabels;
  actor: "customer" | "backoffice";
  uploaderDisplay: "badge" | "details";
  multiple: boolean;
  selectedUrls: ReadonlySet<string>;
  disableNewSelection: boolean;
  onToggle: (item: MediaLibraryItem) => void;
  onUploaded: (item: MediaLibraryItem) => void;
  onDeleted: (item: MediaLibraryItem) => void;
  className?: string;
};

/** Aba "Biblioteca" dos seletores: enviar no topo + grade da biblioteca em modo seleção. */
export function MediaLibraryPanel({
  endpoints,
  labels,
  actor,
  uploaderDisplay,
  multiple,
  selectedUrls,
  disableNewSelection,
  onToggle,
  onUploaded,
  onDeleted,
  className,
}: MediaLibraryPanelProps) {
  const library = useMediaLibrary({ endpoint: endpoints.list });
  const { prepend, removeLocal } = library;
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const handleUploaded = useCallback(
    (item: MediaLibraryItem) => {
      prepend(item);
      onUploadedRef.current(item);
    },
    [prepend],
  );
  const upload = useMediaLibraryUpload({ endpoints, onUploaded: handleUploaded });
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const state = library.library?.state;
  const canUpload =
    state !== undefined && (actor === "customer" ? canCustomerUpload(state) : canBackofficeUpload(state));
  const canDelete = library.viewer ? library.viewer.canWrite : true;
  const hint =
    canUpload || state === undefined
      ? labels.uploadHint
      : state === "closed"
        ? labels.uploadDisabledClosed
        : labels.uploadDisabledSubscription;

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !canUpload) return;
    upload.enqueue(Array.from(files));
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(target.id, true);
    try {
      await requestMediaLibraryDelete(endpoints.item(target.id));
      removeLocal(target.id);
      onDeleted(target);
      toast.success(labels.deleteSuccess);
    } catch {
      toast.error(labels.deleteError);
    } finally {
      setBusy(target.id, false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)} data-testid="media-library-panel">
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-3"
        onDragOver={(event) => {
          if (canUpload) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleFiles(event.dataTransfer.files);
        }}
      >
        <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={!canUpload}>
          <UploadCloud className="size-4" />
          {labels.upload}
        </Button>
        <span className="text-[11px] text-muted-foreground" data-testid="media-library-upload-hint">
          {hint}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={MEDIA_LIBRARY_ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="media-library-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <MediaLibraryUploadQueue queue={upload.queue} labels={labels} onDismiss={upload.dismiss} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {library.status === "loading" ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {library.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">{labels.loadError}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void library.refresh()}>
              <RotateCcw className="size-3.5" />
              {labels.retry}
            </Button>
          </div>
        ) : null}
        {library.status === "ready" && library.items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <p className="text-sm font-medium">{labels.empty}</p>
            <p className="text-xs text-muted-foreground">{labels.emptyHint}</p>
          </div>
        ) : null}
        {library.status === "ready" && library.items.length > 0 ? (
          <div className="flex flex-col gap-3">
            <MediaLibraryGrid
              items={library.items}
              labels={labels}
              mode="select"
              uploaderDisplay={uploaderDisplay}
              selectedUrls={selectedUrls}
              multiple={multiple}
              disableNewSelection={disableNewSelection}
              busyIds={busyIds}
              canDelete={canDelete}
              onToggle={onToggle}
              onDelete={setPendingDelete}
            />
            {library.hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-center"
                onClick={() => void library.loadMore()}
                disabled={library.loadingMore}
              >
                {library.loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {labels.loadMore}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <MediaLibraryDeleteDialog
        item={pendingDelete}
        labels={labels}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
```

- [ ] **Step 7: i18n do app** — em `$FE/messages/pt-BR.json`, dentro de `"pages"`, acrescente o bloco (e o equivalente em inglês em `messages/en.json`):

```json
"mediaLibrary": {
  "eyebrow": "Seus arquivos",
  "titleStart": "Biblioteca de",
  "titleAccent": "mídias",
  "subtitle": "Guarde as fotos e vídeos do seu produto e use nas campanhas com IA.",
  "retentionNotice": "Suas mídias ficam salvas enquanto sua assinatura estiver ativa.",
  "retentionTooltip": "Se a assinatura ficar expirada por mais de 1 mês, todas as mídias da biblioteca são apagadas.",
  "upload": "Enviar mídias",
  "uploadHint": "JPG ou PNG até 5 MB · MP4, MOV ou WEBM até 300 MB",
  "uploadDisabledClosed": "Biblioteca encerrada: o acesso expirou há mais de 1 mês.",
  "uploadDisabledSubscription": "Renove sua assinatura para enviar novas mídias.",
  "dropHere": "Solte os arquivos para enviar",
  "filterAll": "Todas",
  "filterImages": "Imagens",
  "filterVideos": "Vídeos",
  "count": "{count, plural, =0 {Nenhuma mídia} one {# mídia} other {# mídias}}",
  "empty": "Sua biblioteca está vazia",
  "emptyHint": "Envie fotos e vídeos do seu produto para usar nas campanhas.",
  "loadError": "Não foi possível carregar suas mídias.",
  "retry": "Tentar de novo",
  "loadMore": "Carregar mais",
  "teamBadge": "Equipe Automatize",
  "uploadedByCustomer": "Você",
  "uploadedByPrefix": "Enviada por",
  "videoBadge": "Vídeo",
  "preview": "Ver",
  "download": "Baixar",
  "delete": "Excluir",
  "previewAria": "Ver {name}",
  "downloadAria": "Baixar {name}",
  "deleteAria": "Excluir {name}",
  "selectAria": "Selecionar {name}",
  "deleteTitle": "Excluir mídia?",
  "deleteDescription": "\"{name}\" será removida da sua biblioteca. Anúncios já publicados com essa mídia não são afetados.",
  "deleteCancel": "Cancelar",
  "deleteConfirm": "Excluir",
  "deleteSuccess": "Mídia excluída",
  "deleteError": "Não foi possível excluir a mídia.",
  "downloadError": "Não foi possível baixar a mídia.",
  "uploading": "Enviando…",
  "uploaded": "Enviada",
  "dismiss": "Dispensar",
  "errors": {
    "not_found": "Mídia não encontrada.",
    "library_closed": "Biblioteca encerrada: o acesso expirou há mais de 1 mês.",
    "subscription_required": "Sua assinatura expirou. Renove para enviar novas mídias.",
    "unsupported_type": "Formato não suportado. Use JPG, PNG, MP4, MOV ou WEBM.",
    "file_too_large": "Arquivo acima do limite (imagens até 5 MB, vídeos até 300 MB).",
    "empty_file": "O arquivo está vazio.",
    "invalid_upload": "Upload inválido. Envie a mídia novamente.",
    "invalid_cursor": "Página inválida.",
    "storage_unavailable": "Armazenamento indisponível. Tente novamente em instantes.",
    "network_error": "Falha de conexão. Verifique a internet e tente de novo.",
    "upload_failed": "Não foi possível enviar o arquivo. Tente de novo."
  }
}
```
Em `en.json` use: eyebrow "Your files", titleStart "Media", titleAccent "library" (a palavra em itálico vem por último), subtitle "Keep your product photos and videos and use them in AI campaigns.", e traduza as demais chaves no mesmo sentido (mesmas chaves, mesmo formato ICU).

- [ ] **Step 8: Hook de rótulos do app** — crie `$FE/components/media-library/use-media-library-labels.ts`:

```ts
"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { MediaLibraryLabels } from "@/components/media-library/labels";
import type { MediaLibraryClientErrorCode } from "@/lib/media-library/policy";

/** Rótulos dos componentes compartilhados da biblioteca, traduzidos pelo next-intl. */
export function useMediaLibraryLabels(): MediaLibraryLabels {
  const t = useTranslations("pages.mediaLibrary");
  const locale = useLocale();
  return useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(locale, {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return {
      teamBadge: t("teamBadge"),
      uploadedByCustomer: t("uploadedByCustomer"),
      uploadedByPrefix: t("uploadedByPrefix"),
      videoBadge: t("videoBadge"),
      preview: t("preview"),
      download: t("download"),
      delete: t("delete"),
      previewAria: (name: string) => t("previewAria", { name }),
      downloadAria: (name: string) => t("downloadAria", { name }),
      deleteAria: (name: string) => t("deleteAria", { name }),
      selectAria: (name: string) => t("selectAria", { name }),
      deleteTitle: t("deleteTitle"),
      deleteDescription: (name: string) => t("deleteDescription", { name }),
      deleteCancel: t("deleteCancel"),
      deleteConfirm: t("deleteConfirm"),
      upload: t("upload"),
      uploadHint: t("uploadHint"),
      uploadDisabledClosed: t("uploadDisabledClosed"),
      uploadDisabledSubscription: t("uploadDisabledSubscription"),
      uploading: t("uploading"),
      uploaded: t("uploaded"),
      dismiss: t("dismiss"),
      empty: t("empty"),
      emptyHint: t("emptyHint"),
      loadError: t("loadError"),
      retry: t("retry"),
      loadMore: t("loadMore"),
      deleteSuccess: t("deleteSuccess"),
      deleteError: t("deleteError"),
      downloadError: t("downloadError"),
      // Se o next-intl tipar as chaves e recusar a chave dinâmica, use um mapa explícito
      // code → t("errors.<code>") com as 11 chaves em vez do template.
      errorMessage: (code: MediaLibraryClientErrorCode) => t(`errors.${code}`),
      formatDate: (iso: string) => dateFormat.format(new Date(iso)),
    };
  }, [locale, t]);
}
```

- [ ] **Step 9: Teste de interação que falha primeiro** — crie `$FE/components/media-library/media-library-panel.interaction.test.tsx` seguindo o padrão de `components/onboarding-dashboard/business-locations-manager.interaction.test.tsx` (happy-dom via `../stock/test-dom`):

```tsx
import { act, createElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { installHappyDom } from "../stock/test-dom";

const testDom = installHappyDom("http://localhost/app/biblioteca-de-midias");
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { MediaLibraryPanel } = await import("./media-library-panel");
const { MediaLibraryGrid } = await import("./media-library-grid");
const { PT_BR_MEDIA_LIBRARY_LABELS } = await import("./labels");
const { customerMediaLibraryEndpoints } = await import("@/lib/media-library/client");

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, url: `https://m.test/${id}.png`, filename: `${id}.png`, contentType: "image/png", isVideo: false,
  sizeBytes: 2048, createdAt: "2026-10-13T12:00:00.000Z", uploadedBy: "customer" as const, ...extra,
});

let originalFetch: typeof fetch;
function stubList(state: "active" | "grace" | "closed", items = [item("a")]) {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (url.startsWith("/api/files/media-library")) {
      return new Response(JSON.stringify({ items: state === "closed" ? [] : items, nextCursor: null, total: items.length, library: { state, purgeAt: null, expirationDate: null } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  testDom.activate();
  originalFetch = globalThis.fetch;
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  testDom.activate();
  await act(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
afterAll(() => testDom.release());

function renderPanel(overrides: Record<string, unknown> = {}) {
  const props = {
    endpoints: customerMediaLibraryEndpoints(),
    labels: PT_BR_MEDIA_LIBRARY_LABELS,
    actor: "customer" as const,
    uploaderDisplay: "badge" as const,
    multiple: true,
    selectedUrls: new Set<string>(),
    disableNewSelection: false,
    onToggle: mock(() => {}),
    onUploaded: mock(() => {}),
    onDeleted: mock(() => {}),
    ...overrides,
  };
  return { props, view: render(createElement(MediaLibraryPanel, props)) };
}

describe("MediaLibraryPanel", () => {
  test("biblioteca ativa: lista e deixa enviar; clicar seleciona", async () => {
    stubList("active");
    const { props, view } = renderPanel();
    await waitFor(() => expect(view.getAllByTestId("media-library-item").length).toBe(1));
    expect((view.getByRole("button", { name: "Enviar mídias" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Selecionar a.png" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  test("cliente em carência e biblioteca encerrada não enviam e explicam o motivo", async () => {
    stubList("grace");
    const grace = renderPanel();
    await waitFor(() => expect(grace.view.getByTestId("media-library-upload-hint").textContent).toBe(PT_BR_MEDIA_LIBRARY_LABELS.uploadDisabledSubscription));
    expect((grace.view.getByRole("button", { name: "Enviar mídias" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => cleanup());
    stubList("closed");
    const closed = renderPanel({ actor: "backoffice" });
    await waitFor(() => expect(closed.view.getByTestId("media-library-upload-hint").textContent).toBe(PT_BR_MEDIA_LIBRARY_LABELS.uploadDisabledClosed));
  });

  test("arquivo com tipo vazio vira linha de erro sem chamar o servidor", async () => {
    stubList("active");
    const { view } = renderPanel();
    await waitFor(() => expect(view.getAllByTestId("media-library-item").length).toBe(1));
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const file = new File([new Uint8Array([1, 2, 3])], "clipe.mov", { type: "" });
    fireEvent.change(view.getByTestId("media-library-input"), { target: { files: [file] } });
    await waitFor(() => expect(view.getByTestId("media-library-upload-queue").textContent).toContain("Formato não suportado"));
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
  });

  test("excluir chama onDeleted para o seletor tirar da seleção", async () => {
    stubList("active");
    const { props, view } = renderPanel({ selectedUrls: new Set(["https://m.test/a.png"]) });
    await waitFor(() => expect(view.getAllByTestId("media-library-item").length).toBe(1));
    fireEvent.click(view.getByRole("button", { name: "Excluir a.png" }));
    fireEvent.click(await view.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledTimes(1));
  });
});

describe("MediaLibraryGrid", () => {
  test("modo gestão mostra ações e selo da equipe; detalhes mostram o e-mail do admin", () => {
    const view = render(createElement(MediaLibraryGrid, {
      items: [item("b", { uploadedBy: "backoffice", uploadedByBackofficeEmail: "ana@automatize.com" })],
      labels: PT_BR_MEDIA_LIBRARY_LABELS, mode: "manage", uploaderDisplay: "badge",
    }));
    expect(view.getByText("Equipe Automatize")).toBeTruthy();
    expect(view.getByRole("button", { name: "Baixar b.png" })).toBeTruthy();
    view.rerender(createElement(MediaLibraryGrid, {
      items: [item("b", { uploadedBy: "backoffice", uploadedByBackofficeEmail: "ana@automatize.com" })],
      labels: PT_BR_MEDIA_LIBRARY_LABELS, mode: "manage", uploaderDisplay: "details",
    }));
    expect(view.getByText("Enviada por: ana@automatize.com")).toBeTruthy();
  });
  test("modo seleção respeita o limite", () => {
    const onToggle = mock(() => {});
    const view = render(createElement(MediaLibraryGrid, {
      items: [item("c")], labels: PT_BR_MEDIA_LIBRARY_LABELS, mode: "select", uploaderDisplay: "badge",
      disableNewSelection: true, onToggle,
    }));
    fireEvent.click(view.getByRole("button", { name: "Selecionar c.png" }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
```
Rode ANTES de criar os componentes (Steps 1–6 vêm antes no texto só por legibilidade: crie o teste primeiro, rode, veja falhar por import ausente, depois crie os arquivos dos Steps 1–6 e 8).
Run: `cd $FE && bun test components/media-library` → Expected: PASS ao final. Se o `AlertDialog` renderizar em portal fora do container, use `view.baseElement`/`screen` do Testing Library para achar o botão "Excluir" do diálogo.

- [ ] **Step 10: Espelhar** — em `$FE/tests/helpers/source-parity.ts`, depois de `"lib/media-library/hooks.ts",` acrescente:
```ts
  "components/media-library/labels.ts",
  "components/media-library/media-library-grid.tsx",
  "components/media-library/media-preview-dialog.tsx",
  "components/media-library/media-library-delete-dialog.tsx",
  "components/media-library/media-library-upload-queue.tsx",
  "components/media-library/media-library-panel.tsx",
```
Run: `cd $FE && bun run sync:meta && bun test tests/meta-duplicate-parity.test.ts` → PASS.

- [ ] **Step 11: tsc dos dois sem erro novo** — o BO precisa compilar os componentes com os `components/ui/*` dele. Se algum componente shadcn do BO não aceitar uma prop usada (ex.: `size="sm"` em `Button`), ajuste o componente compartilhado no FE para algo que os dois aceitem, rode `sync:meta` de novo e repita o tsc nos dois.

- [ ] **Step 12: Commit (dois repos)**

```bash
cd $FE && git add components/media-library messages/pt-BR.json messages/en.json && git add -u tests/helpers/source-parity.ts && git commit -m "feat(biblioteca): componentes compartilhados da Biblioteca de mídias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add components/media-library && git commit -m "feat(biblioteca): espelho dos componentes da Biblioteca de mídias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Página "Biblioteca de mídias" no app, sidebar, header e Mat

**Files:**
- Create: `$FE/app/app/(main)/biblioteca-de-midias/page.tsx`, `$FE/app/app/(main)/biblioteca-de-midias/media-library-page-client.tsx`
- Modify: `$FE/components/app-sidebar.tsx` (import `Images`; item novo em `navItems` logo depois do objeto de `/app/marketing`)
- Modify: `$FE/components/app-header-provider.tsx` (`fallbackHeader`)
- Modify: `$FE/agent/lib/app-routes.ts` (`APP_ROUTE_TARGETS`)
- Modify: `$FE/messages/pt-BR.json` (`navigation.mediaLibrary: "Biblioteca de mídias"`), `$FE/messages/en.json` (`navigation.mediaLibrary: "Media library"`)
- Create: `$FE/components/media-library/media-library-nav.test.ts`

**Interfaces:**
- Consumes: componentes da Tarefa 8, `useMediaLibraryLabels`, `useMediaLibrary`, `useMediaLibraryUpload`, `customerMediaLibraryEndpoints`, `requestMediaLibraryDownload`, `requestMediaLibraryDelete`, `PageTitleBlock` e `Accent` (`components/brand`), `Tooltip*` (`components/ui/tooltip`).
- Produces: rota `/app/biblioteca-de-midias`; `MediaLibraryPageClient`.

- [ ] **Step 1: Teste que falha** — crie `$FE/components/media-library/media-library-nav.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import messagesPt from "../../messages/pt-BR.json";
import messagesEn from "../../messages/en.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("navegação da Biblioteca de mídias", () => {
  it("a sidebar tem o item logo depois de Marketing", () => {
    const sidebar = read("components/app-sidebar.tsx");
    const marketing = sidebar.indexOf('href: "/app/marketing"');
    const library = sidebar.indexOf('href: "/app/biblioteca-de-midias"');
    const winning = sidebar.indexOf('href: "/app/modelos-de-criativos"');
    assert.ok(marketing > 0 && library > marketing && library < winning);
    assert.match(sidebar, /labelKey: "mediaLibrary"/);
  });
  it("tem rótulos nos dois idiomas", () => {
    assert.equal(messagesPt.navigation.mediaLibrary, "Biblioteca de mídias");
    assert.equal(messagesEn.navigation.mediaLibrary, "Media library");
  });
  it("o Mat conhece a rota", () => {
    assert.match(read("agent/lib/app-routes.ts"), /\/app\/biblioteca-de-midias/);
  });
});
```
Run: `cd $FE && bun test components/media-library/media-library-nav.test.ts` → Expected: FAIL.

- [ ] **Step 2: Sidebar, header, Mat, i18n**
  - `components/app-sidebar.tsx`: acrescente `Images,` ao import do `lucide-react` e, em `navItems`, imediatamente depois do objeto que tem `href: "/app/marketing"`, acrescente:
    ```ts
    {
      href: "/app/biblioteca-de-midias",
      icon: Images,
      labelKey: "mediaLibrary",
      isActive: pathname?.startsWith("/app/biblioteca-de-midias") ?? false,
    },
    ```
    Se `labelKey` for tipado como união de chaves, acrescente `"mediaLibrary"` ao tipo.
  - `components/app-header-provider.tsx`: importe `Images` do `lucide-react` e, em `fallbackHeader`, antes do `if (pathname.startsWith("/app/marketing/new"))`, acrescente:
    ```ts
    if (pathname.startsWith("/app/biblioteca-de-midias")) {
      return { title: "Biblioteca de mídias", icon: Images };
    }
    ```
  - `agent/lib/app-routes.ts`: em `APP_ROUTE_TARGETS`, depois da entrada `/app/marketing/new/ai`:
    ```ts
    {
      path: "/app/biblioteca-de-midias",
      sidebarLabel: "Biblioteca de mídias",
      description: "Fotos e vídeos do produto para usar nas campanhas",
    },
    ```
  - `messages/pt-BR.json` e `messages/en.json`: chave `navigation.mediaLibrary` como no teste.

- [ ] **Step 3: Página** — crie `$FE/app/app/(main)/biblioteca-de-midias/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/app/(auth)/auth";
import { MediaLibraryPageClient } from "./media-library-page-client";

export default function Page() {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <MediaLibraryPage />
    </Suspense>
  );
}

async function MediaLibraryPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return <MediaLibraryPageClient />;
}
```

Crie `$FE/app/app/(main)/biblioteca-de-midias/media-library-page-client.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Accent } from "@/components/brand/accent-heading";
import { PageTitleBlock } from "@/components/brand/page-title-block";
import { MediaLibraryDeleteDialog } from "@/components/media-library/media-library-delete-dialog";
import { MediaLibraryGrid } from "@/components/media-library/media-library-grid";
import { MediaLibraryUploadQueue } from "@/components/media-library/media-library-upload-queue";
import { MediaPreviewDialog } from "@/components/media-library/media-preview-dialog";
import { useMediaLibraryLabels } from "@/components/media-library/use-media-library-labels";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  customerMediaLibraryEndpoints,
  requestMediaLibraryDelete,
  requestMediaLibraryDownload,
} from "@/lib/media-library/client";
import { useMediaLibrary, useMediaLibraryUpload } from "@/lib/media-library/hooks";
import { MEDIA_LIBRARY_ACCEPT_ATTRIBUTE, type MediaLibraryTypeFilter } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { cn } from "@/lib/utils";

const FILTERS: { value: MediaLibraryTypeFilter; key: "filterAll" | "filterImages" | "filterVideos" }[] = [
  { value: "all", key: "filterAll" },
  { value: "image", key: "filterImages" },
  { value: "video", key: "filterVideos" },
];

export function MediaLibraryPageClient() {
  const t = useTranslations("pages.mediaLibrary");
  const labels = useMediaLibraryLabels();
  const endpoints = useMemo(() => customerMediaLibraryEndpoints(), []);
  const [filter, setFilter] = useState<MediaLibraryTypeFilter>("all");
  const library = useMediaLibrary({ endpoint: endpoints.list, type: filter });
  const upload = useMediaLibraryUpload({ endpoints, onUploaded: library.prepend });
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<MediaLibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const state = library.library?.state;
  const canUpload = state === "active";

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !canUpload) return;
    upload.enqueue(Array.from(files));
  };

  const handleDownload = useCallback(
    async (item: MediaLibraryItem) => {
      setBusy(item.id, true);
      try {
        await requestMediaLibraryDownload(endpoints.download(item.id));
      } catch {
        toast.error(t("downloadError"));
      } finally {
        setBusy(item.id, false);
      }
    },
    [endpoints, t],
  );

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(target.id, true);
    try {
      await requestMediaLibraryDelete(endpoints.item(target.id));
      library.removeLocal(target.id);
      if (preview?.id === target.id) setPreview(null);
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteError"));
    } finally {
      setBusy(target.id, false);
    }
  };

  return (
    <div
      className="relative mx-auto w-full max-w-6xl px-4 py-6 md:px-8"
      data-testid="media-library-page"
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <PageTitleBlock
        eyebrow={t("eyebrow")}
        title={
          <>
            {t("titleStart")} <Accent>{t("titleAccent")}</Accent>
          </>
        }
        subtitle={t("subtitle")}
      >
        <TooltipProvider>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("retentionNotice")}
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={t("retentionTooltip")} className="text-muted-foreground hover:text-foreground">
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{t("retentionTooltip")}</TooltipContent>
            </Tooltip>
          </p>
        </TooltipProvider>
      </PageTitleBlock>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label={t("filterAll")} className="flex gap-1 rounded-full border border-border bg-background p-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-full px-3 py-1 text-sm transition-colors",
                filter === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(option.key)}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground" data-testid="media-library-count">
          {t("count", { count: library.total })}
        </span>
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={!canUpload}>
            <UploadCloud className="size-4" />
            {t("upload")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {canUpload || state === undefined
              ? t("uploadHint")
              : state === "closed"
                ? t("uploadDisabledClosed")
                : t("uploadDisabledSubscription")}
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={MEDIA_LIBRARY_ACCEPT_ATTRIBUTE}
          className="hidden"
          data-testid="media-library-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <MediaLibraryUploadQueue queue={upload.queue} labels={labels} onDismiss={upload.dismiss} />

      <div className="mt-4">
        {library.status === "loading" ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {library.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-muted-foreground">{t("loadError")}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void library.refresh()}>
              <RotateCcw className="size-3.5" />
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {library.status === "ready" && library.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
            <UploadCloud className="size-8 text-muted-foreground/60" />
            <p className="text-base font-medium">{t("empty")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyHint")}</p>
            {canUpload ? (
              <Button type="button" variant="outline" className="mt-2" onClick={() => inputRef.current?.click()}>
                {t("upload")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {library.status === "ready" && library.items.length > 0 ? (
          <div className="flex flex-col gap-4">
            <MediaLibraryGrid
              items={library.items}
              labels={labels}
              mode="manage"
              uploaderDisplay="badge"
              busyIds={busyIds}
              onPreview={setPreview}
              onDownload={(item) => void handleDownload(item)}
              onDelete={setPendingDelete}
            />
            {library.hasMore ? (
              <Button
                type="button"
                variant="outline"
                className="self-center"
                onClick={() => void library.loadMore()}
                disabled={library.loadingMore}
              >
                {library.loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("loadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
          <p className="rounded-full bg-background px-5 py-2 text-sm font-medium shadow-md">{t("dropHere")}</p>
        </div>
      ) : null}

      <MediaPreviewDialog
        item={preview}
        labels={labels}
        uploaderDisplay="badge"
        onClose={() => setPreview(null)}
        onDownload={(item) => void handleDownload(item)}
      />
      <MediaLibraryDeleteDialog
        item={pendingDelete}
        labels={labels}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
```

Run: `cd $FE && bun test components/media-library` → Expected: PASS.

- [ ] **Step 4: Verificação com agent-browser (obrigatória)** — com LocalStack, bucket e dev server do FE no ar (`verification.md` §1–§2):
  1. `agent-browser set viewport 1440 900` → `open http://localhost:3000/app/biblioteca-de-midias` → `wait 6000` → `screenshot $PLAN/evidence/task-09-empty-or-initial.png`. Confirme no `snapshot` o item "Biblioteca de mídias" na sidebar logo abaixo de "Tráfego Pago com IA".
  2. `upload 'input[data-testid=media-library-input]' "$FIX/produto-roxo.png" "$FIX/produto-teste.jpg" "$FIX/video-curto.mp4" "$FIX/imagem-grande.png"` → `wait 6000` → `screenshot $PLAN/evidence/task-09-uploaded.png`. Esperado: 3 mídias novas na grade (vídeo com selo), e uma linha de erro "Arquivo acima do limite" para `imagem-grande.png`.
  3. Filtro "Vídeos" → só o vídeo → `screenshot $PLAN/evidence/task-09-filter-videos.png`; volte para "Todas".
  4. Clique em "Ver" de uma imagem → prévia aberta → `screenshot $PLAN/evidence/task-09-preview.png` → feche.
  5. Download: `agent-browser eval` com `fetch(<endpoint de download do 1º item>, { headers: { Accept: "application/json" } }).then(r => r.json())` → URL assinada; `curl -sI "<url>" | grep -i content-disposition` deve mostrar `attachment` e o nome original. Salve em `$PLAN/evidence/task-09-download-headers.txt`.
  6. Excluir uma imagem → diálogo → `screenshot $PLAN/evidence/task-09-delete-dialog.png` → confirmar → some da grade.
  7. Paginação: rode o semeador abaixo para 50 itens e depois clique "Carregar mais" até acabar; `eval` que conta `[data-testid=media-library-item]` e confere ids únicos (`new Set([...document.querySelectorAll('[data-media-id]')].map(e=>e.dataset.mediaId)).size === document.querySelectorAll('[data-media-id]').length`). `screenshot $PLAN/evidence/task-09-load-more.png`.
     Semeador: rode este `eval` no agent-browser com a página aberta (herda a sessão impersonada; gera um PNG 1x1 no navegador e passa pelos endpoints reais):
     ```js
     (async () => {
       const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
       const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
       for (let i = 1; i <= 50; i++) {
         const name = `seed-${String(i).padStart(3, "0")}.png`;
         const p = await (await fetch("/api/files/media-library/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: name, contentType: "image/png", size: bytes.length }) })).json();
         await fetch(p.uploadUrl, { method: "PUT", headers: { "Content-Type": p.contentType }, body: bytes });
         const c = await fetch("/api/files/media-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: p.key, filename: name }) });
         if (!c.ok) return `falhou em ${i}: ${c.status}`;
       }
       return "50 ok";
     })()
     ```
     Recarregue a página antes de contar.
  8. Celular: `set viewport 375 812` → `open` de novo → `wait 5000` → `eval "document.documentElement.scrollWidth <= window.innerWidth"` = `true` → `screenshot $PLAN/evidence/task-09-mobile.png`.
  9. `git checkout -- next-env.d.ts` se o dev server o alterou.

- [ ] **Step 5: tsc sem erro novo; commit**

```bash
cd $FE && git add "app/app/(main)/biblioteca-de-midias" components/app-sidebar.tsx components/app-header-provider.tsx agent/lib/app-routes.ts messages/pt-BR.json messages/en.json components/media-library/media-library-nav.test.ts && git add -f docs/superpowers/plans/2026-10-13-media-library/evidence/task-09-* && git commit -m "feat(biblioteca): página Biblioteca de mídias no app com item na sidebar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Seletores do app usam a biblioteca; remover o fluxo antigo

**Files:**
- Modify: `$FE/components/media-selector/multi-media-selector.tsx`
- Rewrite: `$FE/app/app/(main)/marketing/components/ad-creative/device-upload-tab.tsx`
- Modify: `$FE/components/media-selector/index.ts` (tirar `DeviceMediaLibrary`/`DeviceUploadGrid` dos exports)
- Delete: `$FE/components/media-selector/device-upload-grid.tsx`, `$FE/components/media-selector/device-media-library.tsx`, `$FE/lib/blob/device-media.ts`, `$FE/lib/blob/register-campaign-blob-upload.ts`
- Modify: `$FE/app/api/files/upload/route.ts` (remover ação `register`)
- Modify: `$FE/messages/pt-BR.json`, `$FE/messages/en.json` (`pages.mediaSelector.fromLibrary`; `marketing.adCreative.mediaTabs.upload` = "Biblioteca"/"Library"; apagar `pages.deviceMediaLibrary` e chaves órfãs)
- Create: `$FE/tests/media-library-legacy-removed.test.ts`

**Interfaces:**
- Consumes: `MediaLibraryPanel`, `useMediaLibraryLabels`, `customerMediaLibraryEndpoints`, `MediaLibraryItem`, `UploadedDeviceImage` (`app/app/(main)/marketing/new/hooks/use-media-selection.ts`, inalterado), `DeviceUploadSelection` (continua exportado de `device-upload-tab.tsx`).
- Produces: `MultiMediaSelector` com a mesma API pública; `DeviceUploadTab({ selected, onSelect })` com a mesma API pública.

- [ ] **Step 1: Contrato que falha** — crie `$FE/tests/media-library-legacy-removed.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import messages from "../messages/pt-BR.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("o fluxo antigo de mídia do dispositivo saiu", () => {
  it("arquivos removidos", () => {
    for (const p of [
      "components/media-selector/device-upload-grid.tsx",
      "components/media-selector/device-media-library.tsx",
      "lib/blob/device-media.ts",
      "lib/blob/register-campaign-blob-upload.ts",
    ]) assert.equal(existsSync(join(root, p)), false, p);
  });
  it("/api/files/upload não registra mais URL arbitrária", () => {
    const source = read("app/api/files/upload/route.ts");
    assert.doesNotMatch(source, /isRegisterBody|recordBlobUploadOnce|"register"/);
  });
  it("os seletores usam o painel da biblioteca", () => {
    assert.match(read("components/media-selector/multi-media-selector.tsx"), /MediaLibraryPanel/);
    assert.match(read("app/app/(main)/marketing/components/ad-creative/device-upload-tab.tsx"), /MediaLibraryPanel/);
  });
  it("textos: aba Biblioteca de mídias e o aviso de 7 dias da biblioteca saiu", () => {
    assert.equal(messages.pages.mediaSelector.fromLibrary, "Biblioteca de mídias");
    assert.equal(messages.marketing.adCreative.mediaTabs.upload, "Biblioteca");
    assert.equal((messages.pages as Record<string, unknown>).deviceMediaLibrary, undefined);
    assert.equal(JSON.stringify(messages).includes("por até 7 dias"), false);
  });
});
```
Run: `cd $FE && bun test tests/media-library-legacy-removed.test.ts` → Expected: FAIL.

- [ ] **Step 2: `MultiMediaSelector`** — em `$FE/components/media-selector/multi-media-selector.tsx`:
  1. Troque `import { DeviceUploadGrid } from "./device-upload-grid";` por:
     ```ts
     import { useMemo, useRef } from "react";
     import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
     import { useMediaLibraryLabels } from "@/components/media-library/use-media-library-labels";
     import { customerMediaLibraryEndpoints } from "@/lib/media-library/client";
     import type { MediaLibraryItem } from "@/lib/media-library/service";
     ```
     (junte `useMemo, useRef` ao import de `react` existente, que já traz `useState`.)
  2. No `AnimatedTabs`, troque `t("fromDevice")` por `t("fromLibrary")`.
  3. No componente, apague o estado `allUploadedImages`/`setAllUploadedImages` e o `handleUploadedImageSelectionChange`, e acrescente depois de `hasReachedMax`:
     ```ts
     const libraryLabels = useMediaLibraryLabels();
     const libraryEndpoints = useMemo(() => customerMediaLibraryEndpoints(), []);
     const selectedUploadUrls = useMemo(
       () => new Set(selectedUploadedImages.map((image) => image.url)),
       [selectedUploadedImages],
     );
     // Uploads terminam fora de ordem: a vaga é contada com o estado mais novo.
     const otherCountRef = useRef(0);
     otherCountRef.current = instagramCount + generatedCount;

     const toUploadedImage = (item: MediaLibraryItem): UploadedDeviceImage => ({
       id: item.id,
       url: item.url,
       filename: item.filename,
       previewUrl: item.url,
       isVideo: item.isVideo,
       mimeType: item.contentType ?? undefined,
     });

     const handleLibraryToggle = (item: MediaLibraryItem) => {
       setSelectedUploadedImages((previous) => {
         if (previous.some((image) => image.url === item.url)) {
           return previous.filter((image) => image.url !== item.url);
         }
         if (otherCountRef.current + previous.length >= maxSelection) return previous;
         return [...previous, toUploadedImage(item)];
       });
     };

     const handleLibraryUploaded = (item: MediaLibraryItem) => {
       setSelectedUploadedImages((previous) => {
         if (previous.some((image) => image.url === item.url)) return previous;
         // Sem vaga: a mídia fica salva na biblioteca, só não entra na seleção.
         if (otherCountRef.current + previous.length >= maxSelection) return previous;
         return [...previous, toUploadedImage(item)];
       });
     };

     const handleLibraryDeleted = (item: MediaLibraryItem) => {
       setSelectedUploadedImages((previous) => previous.filter((image) => image.url !== item.url));
     };
     ```
  4. Troque o bloco `<DeviceUploadGrid ... />` da aba `upload` por:
     ```tsx
     <MediaLibraryPanel
       endpoints={libraryEndpoints}
       labels={libraryLabels}
       actor="customer"
       uploaderDisplay="badge"
       multiple
       selectedUrls={selectedUploadUrls}
       disableNewSelection={hasReachedMax}
       onToggle={handleLibraryToggle}
       onUploaded={handleLibraryUploaded}
       onDeleted={handleLibraryDeleted}
       className="h-full"
     />
     ```
  O resto (bandeja, contador, confirmação) fica igual.

- [ ] **Step 3: `DeviceUploadTab` do criativo/Mat** — substitua todo o conteúdo de `$FE/app/app/(main)/marketing/components/ad-creative/device-upload-tab.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
import { useMediaLibraryLabels } from "@/components/media-library/use-media-library-labels";
import { customerMediaLibraryEndpoints } from "@/lib/media-library/client";
import type { MediaLibraryItem } from "@/lib/media-library/service";

export type DeviceUploadSelection = {
  blobUrl: string;
  mediaType: "image" | "video";
  previewUrl: string;
};

type DeviceUploadTabProps = {
  selected: DeviceUploadSelection | null;
  onSelect: (selection: DeviceUploadSelection | null) => void;
};

function toSelection(item: MediaLibraryItem): DeviceUploadSelection {
  return { blobUrl: item.url, mediaType: item.isVideo ? "video" : "image", previewUrl: item.url };
}

/** Aba "Biblioteca" do criativo e do chat do Mat: a mesma Biblioteca de mídias, seleção única. */
export function DeviceUploadTab({ selected, onSelect }: DeviceUploadTabProps) {
  const labels = useMediaLibraryLabels();
  const endpoints = useMemo(() => customerMediaLibraryEndpoints(), []);
  const selectedUrls = useMemo(() => new Set(selected ? [selected.blobUrl] : []), [selected]);
  return (
    <div className="py-2">
      <MediaLibraryPanel
        endpoints={endpoints}
        labels={labels}
        actor="customer"
        uploaderDisplay="badge"
        multiple={false}
        selectedUrls={selectedUrls}
        disableNewSelection={false}
        onToggle={(item) => onSelect(selected?.blobUrl === item.url ? null : toSelection(item))}
        onUploaded={(item) => onSelect(toSelection(item))}
        onDeleted={(item) => {
          if (selected?.blobUrl === item.url) onSelect(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Remover o legado**
  1. `grep -rn "device-upload-grid\|DeviceUploadGrid\|device-media-library\|DeviceMediaLibrary\|lib/blob/device-media\|register-campaign-blob-upload\|registerCampaignBlobUpload" app components lib agent hooks` — corrija cada consumidor restante (esperado: só `components/media-selector/index.ts`). Apague os 4 arquivos.
  2. Em `$FE/app/api/files/upload/route.ts`: apague `CAMPAIGN_MEDIA_SOURCE`, `recordBlobUploadOnce`, o tipo/guard do corpo `register` e o bloco `if (isRegisterBody(rawBody)) { ... }`; remova `"Invalid register payload"` de `safeClientError`, a fase `"register"` de `UploadLogContext` e os imports que ficarem sem uso (`db`, `blobUpload`, `and`, `eq`, `isNull`…). O presign genérico (identidade visual, posts agendados, onboarding, criador de vídeo) continua idêntico.
  3. i18n (pt-BR e en): em `pages.mediaSelector` acrescente `"fromLibrary": "Biblioteca de mídias"` (en: `"Media library"`) e apague `fromDevice` se não tiver mais uso (`grep -rn "fromDevice"`); em `marketing.adCreative.mediaTabs.upload` troque o valor para `"Biblioteca"` (en: `"Library"`); apague o bloco `pages.deviceMediaLibrary` e, depois de `grep`, as chaves de `marketing.adCreative.deviceUpload` e de `pages.deviceUpload*` que ficaram sem uso. O aviso "por até 7 dias" da biblioteca não pode sobrar (outros "7 dias", como "Últimos 7 dias", ficam).

Run: `cd $FE && bun test tests/media-library-legacy-removed.test.ts components/media-library lib/media-library` → Expected: PASS.

- [ ] **Step 5: Verificação com agent-browser (obrigatória)**
  1. Fluxo de IA: `open http://localhost:3000/app/marketing/new/ai` → `wait 8000` → avance só o necessário (objetivo e conta) até a seção de criativo; clique em "Escolher mídia". **Nunca** publique. Se o auto mode recusar avançar, use o diálogo de criativo de um anúncio existente em `/app/marketing` (abrir "Editar criativo" → aba "Biblioteca") e registre o motivo no relatório.
  2. Aba "Biblioteca de mídias" → `screenshot $PLAN/evidence/task-10-ai-picker-library.png`. Selecione 2 mídias; envie `produto-teste.jpg` pela aba (deve entrar já selecionado) → `screenshot $PLAN/evidence/task-10-ai-picker-selected.png`. Confirme a seleção e veja as miniaturas no passo de criativo → `screenshot $PLAN/evidence/task-10-ai-picker-confirmed.png`.
  3. Excluir uma mídia selecionada dentro do seletor: some da bandeja.
  4. `git checkout -- next-env.d.ts` se alterado.

- [ ] **Step 6: tsc sem erro novo; commit**

```bash
cd $FE && git add -A components/media-selector "app/app/(main)/marketing/components/ad-creative/device-upload-tab.tsx" lib/blob app/api/files/upload/route.ts messages/pt-BR.json messages/en.json && git add -f tests/media-library-legacy-removed.test.ts docs/superpowers/plans/2026-10-13-media-library/evidence/task-10-* && git commit -m "feat(biblioteca): seletores do app usam a Biblioteca de mídias; sai o registro de URL arbitrária

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Card "Biblioteca de mídias" no Marketing do cliente (backoffice)

**Files:**
- Create: `$BO/app/(admin)/marketing/components/media-library-state.ts` (puro: rótulos do BO + texto do estado)
- Create: `$BO/app/(admin)/marketing/components/media-library-card.tsx`
- Modify: `$BO/app/(admin)/marketing/components/marketing-workspace.tsx` (import + render)
- Create: `$BO/app/(admin)/marketing/components/media-library-state.test.ts`

**Interfaces:**
- Consumes: componentes espelhados (Tarefa 8), `useMediaLibrary`, `useMediaLibraryUpload`, `backofficeMediaLibraryEndpoints`, `requestMediaLibraryDownload`, `requestMediaLibraryDelete`, `canBackofficeUpload`, `PT_BR_MEDIA_LIBRARY_LABELS`; `formatDateInSaoPaulo`, `formatDateTimeInSaoPaulo` (`@/lib/backoffice/datetime-format`); `Card*`, `Button`, `Badge` (`@/components/ui/*`).
- Produces: `BACKOFFICE_MEDIA_LIBRARY_LABELS` e `describeMediaLibraryState(library: MediaLibrarySummary): string` em `media-library-state.ts`; `MediaLibraryCard({ userId }: { userId: string })` em `media-library-card.tsx`.

- [ ] **Step 1: Teste que falha** — crie `$BO/app/(admin)/marketing/components/media-library-state.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeMediaLibraryState } from "./media-library-state";

describe("describeMediaLibraryState", () => {
  it("ativa mostra até quando", () => {
    assert.match(describeMediaLibraryState({ state: "active", expirationDate: "2026-10-24T19:57:52.463Z", purgeAt: "2026-11-24T19:57:52.463Z" }), /^Ativa até /);
  });
  it("ativa sem data = acesso liberado sem cobrança", () => {
    assert.equal(describeMediaLibraryState({ state: "active", expirationDate: null, purgeAt: null }), "Ativa (acesso liberado sem cobrança)");
  });
  it("carência mostra a data da exclusão", () => {
    assert.match(describeMediaLibraryState({ state: "grace", expirationDate: "2026-10-03T12:00:00.000Z", purgeAt: "2026-11-03T12:00:00.000Z" }), /^Carência — exclusão em /);
  });
  it("encerrada explica", () => {
    assert.equal(describeMediaLibraryState({ state: "closed", expirationDate: null, purgeAt: null }), "Encerrada — o cliente precisa renovar o acesso");
  });
});
```
Run: `cd $BO && bun test "app/(admin)/marketing/components/media-library-state.test.ts"` → Expected: FAIL.

- [ ] **Step 2: Estado (puro)** — crie `$BO/app/(admin)/marketing/components/media-library-state.ts`:

```ts
import { PT_BR_MEDIA_LIBRARY_LABELS, type MediaLibraryLabels } from "@/components/media-library/labels";
import { formatDateInSaoPaulo, formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { MediaLibrarySummary } from "@/lib/media-library/service";

/** Rótulos do backoffice: data e hora em São Paulo e verbo "Adicionar". */
export const BACKOFFICE_MEDIA_LIBRARY_LABELS: MediaLibraryLabels = {
  ...PT_BR_MEDIA_LIBRARY_LABELS,
  upload: "Adicionar mídias",
  uploadDisabledSubscription: "O cliente está sem acesso ativo.",
  formatDate: (iso) => formatDateTimeInSaoPaulo(iso),
};

export function describeMediaLibraryState(library: MediaLibrarySummary): string {
  if (library.state === "active") {
    return library.expirationDate
      ? `Ativa até ${formatDateInSaoPaulo(library.expirationDate)}`
      : "Ativa (acesso liberado sem cobrança)";
  }
  if (library.state === "grace") {
    return `Carência — exclusão em ${formatDateInSaoPaulo(library.purgeAt)}`;
  }
  return "Encerrada — o cliente precisa renovar o acesso";
}
```

Run: `cd $BO && bun test "app/(admin)/marketing/components/media-library-state.test.ts"` → PASS.

- [ ] **Step 3: Card** — crie `$BO/app/(admin)/marketing/components/media-library-card.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { MediaLibraryDeleteDialog } from "@/components/media-library/media-library-delete-dialog";
import { MediaLibraryGrid } from "@/components/media-library/media-library-grid";
import { MediaLibraryUploadQueue } from "@/components/media-library/media-library-upload-queue";
import { MediaPreviewDialog } from "@/components/media-library/media-preview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  backofficeMediaLibraryEndpoints,
  requestMediaLibraryDelete,
  requestMediaLibraryDownload,
} from "@/lib/media-library/client";
import { useMediaLibrary, useMediaLibraryUpload } from "@/lib/media-library/hooks";
import { MEDIA_LIBRARY_ACCEPT_ATTRIBUTE, canBackofficeUpload } from "@/lib/media-library/policy";
import type { MediaLibraryItem } from "@/lib/media-library/service";
import { BACKOFFICE_MEDIA_LIBRARY_LABELS, describeMediaLibraryState } from "./media-library-state";

/** 2 linhas na largura de desktop (grade de 6 colunas). */
const COMPACT_COUNT = 12;

export function MediaLibraryCard({ userId }: { userId: string }) {
  const labels = BACKOFFICE_MEDIA_LIBRARY_LABELS;
  const endpoints = useMemo(() => backofficeMediaLibraryEndpoints(userId), [userId]);
  const library = useMediaLibrary({ endpoint: endpoints.list });
  const upload = useMediaLibraryUpload({ endpoints, onUploaded: library.prepend });
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<MediaLibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaLibraryItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const summary = library.library;
  const canWrite = library.viewer?.canWrite ?? false;
  const canAdd = canWrite && summary !== null && canBackofficeUpload(summary.state);
  const visibleItems = expanded ? library.items : library.items.slice(0, COMPACT_COUNT);

  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleDownload = useCallback(
    async (item: MediaLibraryItem) => {
      setBusy(item.id, true);
      try {
        await requestMediaLibraryDownload(endpoints.download(item.id));
      } catch {
        toast.error(labels.downloadError);
      } finally {
        setBusy(item.id, false);
      }
    },
    [endpoints, labels.downloadError],
  );

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(target.id, true);
    try {
      await requestMediaLibraryDelete(endpoints.item(target.id));
      library.removeLocal(target.id);
      if (preview?.id === target.id) setPreview(null);
      toast.success(labels.deleteSuccess);
    } catch {
      toast.error(labels.deleteError);
    } finally {
      setBusy(target.id, false);
    }
  };

  return (
    <Card data-testid="media-library-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Biblioteca de mídias
              {library.status === "ready" ? <Badge variant="secondary">{library.total}</Badge> : null}
            </CardTitle>
            {summary ? (
              <p className="text-xs text-muted-foreground" data-testid="media-library-state">
                {describeMediaLibraryState(summary)}
              </p>
            ) : null}
          </div>
          {canWrite ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={!canAdd}
                title={canAdd ? undefined : labels.uploadDisabledClosed}
              >
                <UploadCloud className="size-4" />
                {labels.upload}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {canAdd ? labels.uploadHint : labels.uploadDisabledClosed}
              </span>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={MEDIA_LIBRARY_ACCEPT_ATTRIBUTE}
                className="hidden"
                data-testid="media-library-input"
                onChange={(event) => {
                  if (event.target.files && canAdd) upload.enqueue(Array.from(event.target.files));
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <MediaLibraryUploadQueue queue={upload.queue} labels={labels} onDismiss={upload.dismiss} />
        {library.status === "loading" ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {library.status === "error" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">{labels.loadError}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => void library.refresh()}>
              <RotateCcw className="size-3.5" />
              {labels.retry}
            </Button>
          </div>
        ) : null}
        {library.status === "ready" && summary?.state === "closed" ? (
          <p className="text-sm text-muted-foreground">
            O acesso do cliente expirou há mais de 1 mês: as mídias foram (ou serão, na próxima limpeza diária)
            apagadas e nada pode ser adicionado.
          </p>
        ) : null}
        {library.status === "ready" && summary?.state !== "closed" && library.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.empty}.</p>
        ) : null}
        {library.status === "ready" && library.items.length > 0 ? (
          <MediaLibraryGrid
            items={visibleItems}
            labels={labels}
            mode="manage"
            uploaderDisplay="details"
            busyIds={busyIds}
            canDelete={canWrite}
            onPreview={setPreview}
            onDownload={(item) => void handleDownload(item)}
            onDelete={setPendingDelete}
          />
        ) : null}
        {library.status === "ready" && !expanded && library.total > COMPACT_COUNT ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
            Ver todas ({library.total})
          </Button>
        ) : null}
        {expanded && library.hasMore ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void library.loadMore()} disabled={library.loadingMore}>
            {library.loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {labels.loadMore}
          </Button>
        ) : null}
      </CardContent>
      <MediaPreviewDialog
        item={preview}
        labels={labels}
        uploaderDisplay="details"
        onClose={() => setPreview(null)}
        onDownload={(item) => void handleDownload(item)}
      />
      <MediaLibraryDeleteDialog
        item={pendingDelete}
        labels={labels}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}
```
Se o `Badge` do BO não tiver `variant="secondary"`, use o padrão do arquivo `components/ui/badge.tsx`.

- [ ] **Step 4: Montar no workspace** — em `$BO/app/(admin)/marketing/components/marketing-workspace.tsx`, importe `import { MediaLibraryCard } from "./media-library-card";` e, imediatamente depois do fechamento do card "Detalhes do usuário" (o trecho `</CardContent>\n        </Card>\n      )}` que antecede `{selectedUser ? (\n        <PerformanceReportSection`), insira:
```tsx
      {selectedUser ? <MediaLibraryCard userId={selectedUser.id} /> : null}
```

Run: `cd $BO && bun test "app/(admin)/marketing/components/media-library-state.test.ts"` → PASS.

- [ ] **Step 5: Verificação com agent-browser (obrigatória)** — BO no ar, cookie aplicado (`verification.md` §3–§4):
  1. `open "http://localhost:3006/users/384f3178-3946-4fe5-b686-7f30adf16999?tab=marketing"` → `wait 8000` → `screenshot $BO_EVID/task-11-card-active.png` (`BO_EVID=$BO/docs/superpowers/plans/2026-10-13-media-library/evidence`). Esperado: card depois de "Detalhes do usuário", estado "Ativa até 24/10/2026", itens enviados na Tarefa 9 com "Enviada por: Cliente".
  2. `upload 'div[data-testid=media-library-card] input[data-testid=media-library-input]' "$FIX/produto-roxo.png"` → `wait 5000` → `screenshot $BO_EVID/task-11-admin-upload.png`. Esperado: "Enviada por: educacaoleg@gmail.com" com data/hora.
  3. "Ver todas (N)" → `screenshot $BO_EVID/task-11-expanded.png`.
  4. Baixar (mesma checagem de `content-disposition` da Tarefa 9, endpoint do BO) → `$BO_EVID/task-11-download-headers.txt`.
  5. Excluir a mídia do admin → confirmar → some.
  6. Aba "Auditoria" do cliente → linhas "Biblioteca de mídias" (adição e exclusão, com o e-mail) → `screenshot $BO_EVID/task-11-audit.png`.
  7. No app (`localhost:3000/app/biblioteca-de-midias`, recarregar) a mídia do admin aparece com o selo "Equipe Automatize" (antes de excluir no passo 5 — se já excluiu, envie outra pelo BO) → `screenshot $PLAN/evidence/task-11-team-badge-in-app.png`.
  8. Estados: `set-test-expiration.ts grace` → recarregar o card → "Carência — exclusão em …", "Adicionar mídias" habilitado → `screenshot $BO_EVID/task-11-grace.png`; no app, `/app/biblioteca-de-midias` redireciona para o bloqueio de assinatura (recarregue duas vezes por causa do JWT) → `screenshot $PLAN/evidence/task-11-app-grace-gate.png`. `set-test-expiration.ts closed` → card "Encerrada", lista vazia, botão desativado → `screenshot $BO_EVID/task-11-closed.png`. **`set-test-expiration.ts restore`** e confira com `show`.
  9. Drawer: `open "http://localhost:3006/embed/users/384f3178-3946-4fe5-b686-7f30adf16999?tab=marketing"` → card presente → `screenshot $BO_EVID/task-11-embed.png`.

- [ ] **Step 6: lint por arquivo, tsc sem erro novo, commit**

```bash
cd $BO && bunx eslint "app/(admin)/marketing/components/media-library-card.tsx" "app/(admin)/marketing/components/media-library-state.ts" "app/(admin)/marketing/components/marketing-workspace.tsx"
cd $BO && git add "app/(admin)/marketing/components/media-library-card.tsx" "app/(admin)/marketing/components/media-library-state.ts" "app/(admin)/marketing/components/media-library-state.test.ts" "app/(admin)/marketing/components/marketing-workspace.tsx" docs/superpowers/plans/2026-10-13-media-library/evidence/task-11-* && git commit -m "feat(biblioteca): card Biblioteca de mídias no Marketing do cliente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $FE && git add -f docs/superpowers/plans/2026-10-13-media-library/evidence/task-11-* && git commit -m "docs(biblioteca): evidências do selo da equipe e do bloqueio na carência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Seletor do backoffice com a aba "Biblioteca"; remover o upload antigo

**Files:**
- Modify: `$BO/app/(admin)/marketing/components/media-source-picker.tsx`
- Delete: `$BO/app/(admin)/marketing/components/device-upload-tab.tsx`, `$BO/app/api/files/upload/route.ts`
- Create: `$BO/tests/media-library-picker-contract.test.ts`

**Interfaces:**
- Consumes: `MediaLibraryPanel`, `BACKOFFICE_MEDIA_LIBRARY_LABELS` (Tarefa 11, `./media-library-state`), `backofficeMediaLibraryEndpoints`, `MediaLibraryItem`.
- Produces: `MediaSourcePicker` com a mesma API pública e o mesmo `SelectedMedia`.

- [ ] **Step 1: Contrato que falha** — crie `$BO/tests/media-library-picker-contract.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("seletor de mídia do backoffice", () => {
  it("a aba de dispositivo virou Biblioteca e usa o painel compartilhado", () => {
    const source = readFileSync(join(root, "app/(admin)/marketing/components/media-source-picker.tsx"), "utf8");
    assert.match(source, /MediaLibraryPanel/);
    assert.match(source, />Biblioteca</);
    assert.doesNotMatch(source, /DeviceUploadTab/);
  });
  it("o upload antigo saiu", () => {
    assert.equal(existsSync(join(root, "app/(admin)/marketing/components/device-upload-tab.tsx")), false);
    assert.equal(existsSync(join(root, "app/api/files/upload/route.ts")), false);
  });
});
```
Run: `cd $BO && bun test tests/media-library-picker-contract.test.ts` → FAIL.

- [ ] **Step 2: Seletor** — em `$BO/app/(admin)/marketing/components/media-source-picker.tsx`:
  1. Troque o import de `DeviceUploadTab`/`DeviceUploadSelection` por:
     ```ts
     import { useMemo } from "react";
     import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";
     import { backofficeMediaLibraryEndpoints } from "@/lib/media-library/client";
     import type { MediaLibraryItem } from "@/lib/media-library/service";
     import { BACKOFFICE_MEDIA_LIBRARY_LABELS } from "./media-library-state";

     type DeviceUploadSelection = {
       blobUrl: string;
       mediaType: "image" | "video";
       previewUrl: string;
     };
     ```
     (junte `useMemo` ao import de `react` existente.) Rode `grep -rn "DeviceUploadSelection\|device-upload-tab" app lib` — se outro arquivo importava o tipo de `device-upload-tab`, exporte-o daqui (`export type DeviceUploadSelection`) e aponte o import para cá.
  2. Dentro do componente, depois de `const remaining = ...`, acrescente:
     ```ts
     const libraryEndpoints = useMemo(() => backofficeMediaLibraryEndpoints(userId), [userId]);
     const deviceSelectedUrls = useMemo(
       () => new Set(deviceSelected.map((selection) => selection.blobUrl)),
       [deviceSelected],
     );
     // Upload termina depois do clique: leia a seleção e as vagas mais novas.
     const deviceSelectedRef = useRef(deviceSelected);
     deviceSelectedRef.current = deviceSelected;
     const remainingRef = useRef(remaining);
     remainingRef.current = remaining;

     const toDeviceSelection = (item: MediaLibraryItem): DeviceUploadSelection => ({
       blobUrl: item.url,
       mediaType: item.isVideo ? "video" : "image",
       previewUrl: item.url,
     });

     const selectLibraryItem = (item: MediaLibraryItem) => {
       const current = deviceSelectedRef.current;
       if (current.some((selection) => selection.blobUrl === item.url)) return;
       if (exclusive) handleDevice([toDeviceSelection(item)]);
       else if (remainingRef.current > 0) handleDevice([...current, toDeviceSelection(item)]);
     };

     const handleLibraryToggle = (item: MediaLibraryItem) => {
       const current = deviceSelectedRef.current;
       if (current.some((selection) => selection.blobUrl === item.url)) {
         handleDevice(current.filter((selection) => selection.blobUrl !== item.url));
         return;
       }
       selectLibraryItem(item);
     };

     const handleLibraryDeleted = (item: MediaLibraryItem) => {
       const current = deviceSelectedRef.current;
       if (current.some((selection) => selection.blobUrl === item.url)) {
         handleDevice(current.filter((selection) => selection.blobUrl !== item.url));
       }
     };
     ```
  3. Troque `<TabsTrigger value="device">Upload</TabsTrigger>` por `<TabsTrigger value="device">Biblioteca</TabsTrigger>` e o conteúdo da aba por:
     ```tsx
     <TabsContent value="device" className="mt-4">
       <MediaLibraryPanel
         endpoints={libraryEndpoints}
         labels={BACKOFFICE_MEDIA_LIBRARY_LABELS}
         actor="backoffice"
         uploaderDisplay="details"
         multiple={!exclusive}
         selectedUrls={deviceSelectedUrls}
         disableNewSelection={!exclusive && remaining <= 0}
         onToggle={handleLibraryToggle}
         onUploaded={selectLibraryItem}
         onDeleted={handleLibraryDeleted}
       />
     </TabsContent>
     ```
  4. Ajuste a frase de ajuda do topo: "Pode misturar Instagram, Automatize e mídias da biblioteca."
- [ ] **Step 3: Remover o legado** — `grep -rn "/api/files/upload\|device-upload-tab\|DeviceUploadTab" app lib components` → só devem sobrar referências que você vai apagar. Apague `app/(admin)/marketing/components/device-upload-tab.tsx` e `app/api/files/upload/route.ts`. **Não** apague `lib/storage/media-upload-client.ts` (usado pela comprovação de pagamento de afiliados).

Run: `cd $BO && bun test tests/media-library-picker-contract.test.ts` → PASS.

- [ ] **Step 4: Verificação com agent-browser (obrigatória)** — `open "http://localhost:3006/marketing/ai?userId=384f3178-3946-4fe5-b686-7f30adf16999&accountId=act_2102201707319672"` → `wait 8000` → avance só até o seletor de mídia (objetivo "Leads" evita o passo de pixel) → aba "Biblioteca" → `screenshot $BO_EVID/task-12-picker-library.png`; selecione 2 mídias e envie `produto-teste.jpg` (entra selecionado; "Enviada por: educacaoleg@gmail.com") → `screenshot $BO_EVID/task-12-picker-selected.png`. **Nunca** publique. Se o auto mode bloquear o avanço, abra o diálogo de criativo de um anúncio no card "Campanhas" e use a aba "Biblioteca" (mesmo componente) — registre o motivo.

- [ ] **Step 5: lint por arquivo, tsc sem erro novo, commit**

```bash
cd $BO && bunx eslint "app/(admin)/marketing/components/media-source-picker.tsx"
cd $BO && git add -A "app/(admin)/marketing/components" app/api/files tests/media-library-picker-contract.test.ts docs/superpowers/plans/2026-10-13-media-library/evidence/task-12-* && git commit -m "feat(biblioteca): seletor do backoffice com a aba Biblioteca; sai o upload antigo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Documentação, runbook e portão final de suítes

**Files:**
- Create: `$FE/docs/adr/0042-media-library-retention-by-access.md`
- Modify: `$FE/docs/adr/0021-device-media-7-day-retention.md` (status), `$FE/docs/CONTEXT.md` (seção "Media sources"), `$FE/CLAUDE.md` e `$FE/AGENTS.md` (tabela de crons + linha sobre `MEDIA_R2_ENDPOINT`), `$FE/.env.example` (`MEDIA_R2_ENDPOINT` comentado)
- Modify: `$BO/CONTEXT.md` (seção nova "Biblioteca de mídias"), `$BO/CLAUDE.md` (rotas novas, fim do apagador pós-Meta), `$BO/.env.example` (`BYPASS_STRIPE_EMAILS`, `MEDIA_R2_ENDPOINT` comentados)
- Create: `$PLAN/deploy-runbook.md`

- [ ] **Step 1: ADR 0042** — escreva `docs/adr/0042-media-library-retention-by-access.md` com: Status "Accepted (2026-10-13)", "Supersedes [[0021-device-media-7-day-retention]]"; Context (biblioteca de 7 dias + apagador pós-Meta no BO; pedido de biblioteca permanente gerenciada pelo admin); Decision (estados Ativa/Carência/Encerrada pela `expiration_date`, `purgeAt` = +1 mês de calendário UTC; cron diário como único apagador automático; exclusão explícita por cliente/admin; uploads em `media/library/<userId>/` com confirmação por HEAD; regras e UI espelhadas byte a byte); Consequences (armazenamento cresce com clientes ativos — sem cota por enquanto; anúncios publicados não dependem do objeto; `register` arbitrário fechado; staging/produção precisam migrar antes do deploy); Alternatives (tabela nova `media_library_items`; listar o prefixo do R2 sem banco). Em `0021`, troque o status para `Superseded by [[0042-media-library-retention-by-access]] (2026-10-13)`.
- [ ] **Step 2: CONTEXT do FE** — em `docs/CONTEXT.md`, seção "Media sources": substitua a entrada *Device media library* por **Biblioteca de mídias (media library)** — "o acervo permanente, por usuário, das linhas `campaign_media` de `blob_uploads` (uploads do app, do backoffice e do WhatsApp). Aparece na página `/app/biblioteca-de-midias` e na aba 'Biblioteca de mídias' dos seletores. Fica guardado enquanto o acesso estiver ativo; um mês depois da expiração tudo é apagado (ADR 0042). O admin do backoffice vê, baixa, exclui e adiciona, e fica registrado como autor." Ajuste a entrada *Device media* para apontar para a biblioteca e remova "last 7 days".
- [ ] **Step 3: CLAUDE.md/AGENTS.md do FE** — na tabela de crons, troque o propósito de `cleanup-blob-storage` para "Sweeps abandoned Post do Prato uploads (24 h)" e acrescente a linha `/api/cron-job/media-library/retention` | `0 6 * * *` (daily 06:00 UTC) | "Deletes every Biblioteca de mídias item of accounts expired ≥ 1 month (ADR 0042)". Mencione `MEDIA_R2_ENDPOINT` (só verificação local com S3 compatível).
- [ ] **Step 4: BO CONTEXT/CLAUDE/.env.example** — seção "Biblioteca de mídias" no `CONTEXT.md` (mesma definição + "Card no Marketing do cliente e aba 'Biblioteca' do seletor; o admin vira autor e as ações entram na Auditoria"); no `CLAUDE.md`, liste as rotas `app/api/users/[id]/media-library/**`, os espelhos novos (`lib/media-library/*`, `components/media-library/*`, `lib/access/billing-bypass.ts`) e que o apagador pós-Meta saiu; `.env.example` com `# BYPASS_STRIPE_EMAILS=` e `# MEDIA_R2_ENDPOINT=`.
- [ ] **Step 5: Runbook** — crie `$PLAN/deploy-runbook.md` com a ordem: (1) aplicar a migração em staging e depois em produção ANTES do deploy (`cd backoffice && APP_ENV=staging bun run db:migrate:status`, depois `db:migrate`, conferindo o ref impresso; mesma coisa com `APP_ENV=prod`) e conferir as 3 colunas e o índice; (2) conferir `BYPASS_STRIPE_EMAILS` no projeto Vercel do backoffice igual ao do frontend; (3) conferir o CORS do bucket de mídia (PUT de `automatizemarketing.com` e do domínio do backoffice); (4) deploy dos dois apps; (5) o cron novo aparece em Vercel → Crons do frontend; (6) primeira execução: olhar o log `[media-library/retention]`.
- [ ] **Step 6: Portão final** — rode as duas suítes completas e os comparadores (`verification.md` §6), `tsc` nos dois com `compare-tsc.py`, e o teste do LocalStack (`MEDIA_LOCALSTACK_TEST=1`). Salve as saídas em `$PLAN/evidence/final-fe-suite.txt`, `$BO/docs/superpowers/plans/2026-10-13-media-library/evidence/final-bo-suite.txt`, `final-*-tsc.txt`. Expected: `falhas novas: 0` e `novos: 0` nos dois repos.
- [ ] **Step 7: Commit (dois repos)**

```bash
cd $FE && git add -f docs/adr/0042-media-library-retention-by-access.md docs/adr/0021-device-media-7-day-retention.md docs/CONTEXT.md docs/superpowers/plans/2026-10-13-media-library && git add CLAUDE.md AGENTS.md .env.example && git commit -m "docs(biblioteca): ADR 0042, glossário, crons e runbook de deploy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd $BO && git add CONTEXT.md CLAUDE.md .env.example docs/superpowers/plans/2026-10-13-media-library && git commit -m "docs(biblioteca): glossário, rotas e evidências finais da Biblioteca de mídias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
