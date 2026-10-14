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

/** Extensões que o nome pode manter para cada tipo validado (sem diferenciar maiúsculas). */
const ALLOWED_EXTENSIONS_BY_TYPE: Record<MediaLibraryContentType, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov", "qt"],
  "video/webm": ["webm"],
};

const MEDIA_LIBRARY_FILENAME_MAX_LENGTH = 120;
const INVISIBLE_FORMAT_CHARS = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

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

/**
 * Remove controles bidi e outros caracteres invisíveis de formatação. Um U+202E
 * no meio do nome faz `foto\u202Egnp.exe` aparecer como `fotoexe.png`: por isso sai.
 */
export function stripInvisibleFormatChars(text: string): string {
  return text.replace(INVISIBLE_FORMAT_CHARS, "");
}

/** Invisíveis de formatação mais os controles C0 e DEL. */
export function stripControlAndFormatChars(text: string): string {
  return stripInvisibleFormatChars(text).replace(CONTROL_CHARS, "");
}

/**
 * Nome mostrado e baixado: só o arquivo, sem controles, com extensão coerente
 * com o tipo validado e até 120 caracteres. Se a extensão do nome não for uma
 * do tipo, acrescenta a canônica (`foto.exe` + png → `foto.exe.png`), então o
 * nome nunca termina numa extensão que o tipo não aceita.
 */
export function sanitizeMediaLibraryFilename(
  filename: string,
  contentType: MediaLibraryContentType,
): string {
  const canonicalExtension = EXTENSION_BY_TYPE[contentType];
  const clean = stripControlAndFormatChars(lastPathSegment(filename))
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return `midia.${canonicalExtension}`;

  const dot = clean.lastIndexOf(".");
  const ownExtension = dot > 0 ? clean.slice(dot + 1).toLowerCase() : null;
  const keepsOwnExtension =
    ownExtension !== null && ALLOWED_EXTENSIONS_BY_TYPE[contentType].includes(ownExtension);
  const base = keepsOwnExtension ? clean.slice(0, dot) : clean;
  const extension = keepsOwnExtension ? clean.slice(dot) : `.${canonicalExtension}`;
  if (base.length + extension.length <= MEDIA_LIBRARY_FILENAME_MAX_LENGTH) {
    return `${base}${extension}`;
  }
  // Corta só a base: a extensão final (sempre do tipo) fica inteira.
  const room = MEDIA_LIBRARY_FILENAME_MAX_LENGTH - extension.length;
  return `${base.slice(0, room).trimEnd() || "midia"}${extension}`;
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
