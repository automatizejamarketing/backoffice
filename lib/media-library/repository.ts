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

/** Linha viva do próprio dono com esta URL (apagadas e de outra origem/dono não contam). */
export async function findMediaLibraryRecordByUrl(query: {
  userId: string;
  blobUrl: string;
}): Promise<MediaLibraryRecord | null> {
  const [row] = await db
    .select(RECORD_COLUMNS)
    .from(blobUpload)
    .where(and(eq(blobUpload.blobUrl, query.blobUrl), liveLibraryRows(query.userId)))
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
    // Só a linha viva deste dono e desta origem conta como "já gravada". Linha apagada
    // (ou de outro usuário/origem) com a mesma URL continua ocupando o índice único:
    // o conflito é lançado em vez de devolver um registro que a biblioteca não mostra.
    const [existing] = await tx
      .select(RECORD_COLUMNS)
      .from(blobUpload)
      .where(
        and(
          eq(blobUpload.blobUrl, input.blobUrl),
          eq(blobUpload.userId, input.userId),
          eq(blobUpload.source, MEDIA_LIBRARY_SOURCE),
          isNull(blobUpload.deletedAt),
        ),
      )
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
      .where(
        and(
          eq(blobUpload.id, input.record.id),
          eq(blobUpload.userId, input.record.userId),
          isNull(blobUpload.deletedAt),
        ),
      )
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
