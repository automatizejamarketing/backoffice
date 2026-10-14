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
  normalizeMediaLibraryContentType,
  parseMediaLibraryCursor,
  sanitizeMediaLibraryFilename,
  stripControlAndFormatChars,
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
  /** Só linhas vivas do próprio dono. Usado pela confirmação para nunca descartar o objeto de uma linha viva. */
  findRecordByUrl(query: { userId: string; blobUrl: string }): Promise<MediaLibraryRecord | null>;
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

/**
 * Nome usado na grade, na prévia, na exclusão e no download. Também limpa linhas
 * gravadas antes da correção (controles bidi, extensão que não bate com o tipo).
 */
export function mediaLibraryDisplayFilename(
  record: Pick<MediaLibraryRecord, "filename" | "pathname" | "contentType">,
): string {
  const raw = record.filename?.trim() || record.pathname?.split("/").pop() || "mídia";
  const contentType = normalizeMediaLibraryContentType(record.contentType);
  if (contentType) return sanitizeMediaLibraryFilename(raw, contentType);
  return stripControlAndFormatChars(raw).trim() || "mídia";
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
  const state = statusOf(deps, owner).state;

  // Confirmação repetida (ex.: cliente em carência reenviou o pedido): a linha viva já é dona deste
  // objeto. Devolve a mesma mídia e NUNCA descarta o objeto; descartar apagaria a mídia de uma linha viva.
  const existing = await deps.findRecordByUrl({ userId: input.userId, blobUrl: url });
  if (existing) {
    if (!canViewLibrary(state)) return fail(403, "library_closed");
    return {
      ok: true,
      value: { item: toMediaLibraryItem(existing, { includeBackofficeEmail: input.actor.kind === "backoffice" }) },
    };
  }

  const refusal = uploadRefusal(state, input.actor);
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
