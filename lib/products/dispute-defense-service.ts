import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  productCardDispute,
  productDisputeDefence,
  productDisputeDefenceFile,
  productDisputeDefenceUploadGrant,
  productOrder,
  type ProductCardDisputeStatus,
} from "@/lib/db/schema";
import {
  decideDisputeDefenceSubmission,
  MAX_DEFENCE_FILE_BYTES,
  MAX_DEFENCE_FILES,
  detectDefenceContentType,
  submitDisputeDefence,
  type DisputeDefenceCase,
  type DisputeDefenceFile,
} from "@/lib/products/dispute-defense";
import { getExpertMercadoPagoHistoricalAccount } from "@/lib/mercadopago/historical-account";
import { createMercadoPagoChargebackDefenceProvider } from "@/lib/mercadopago/chargeback-defense";
import {
  deleteProductAsset,
  headProductAsset,
  readProductAssetBytes,
} from "@/lib/storage/product-assets-r2";

const ACCEPTED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const SUBMISSION_LOCK_MS = 2 * 60 * 1000;
const UPLOAD_GRANT_TTL_MS = 5 * 60 * 1000;

export type DefenceFileSource = "proposed" | "expert" | "operator";

export class ProductDisputeDefenceError extends Error {
  status: 400 | 404 | 409 | 503;

  constructor(message: string, status: 400 | 404 | 409 | 503 = 400) {
    super(message);
    this.name = "ProductDisputeDefenceError";
    this.status = status;
  }
}

function ensureOpen(status: ProductCardDisputeStatus) {
  if (!status.startsWith("open_")) {
    throw new ProductDisputeDefenceError("defence_case_closed", 409);
  }
}

function validateFile(input: {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}) {
  const fileName = input.fileName.trim().slice(0, 255);
  const contentType = input.contentType.trim().toLowerCase();
  if (
    !fileName ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > MAX_DEFENCE_FILE_BYTES
  ) {
    throw new ProductDisputeDefenceError("invalid_defence_file_size");
  }
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    throw new ProductDisputeDefenceError("invalid_defence_file_type");
  }
  return { fileName, contentType, sizeBytes: input.sizeBytes };
}

function storageValidationError(error: unknown): ProductDisputeDefenceError {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("não está configurado")) {
    return new ProductDisputeDefenceError(message, 503);
  }
  return new ProductDisputeDefenceError("defence_file_not_found", 400);
}

async function verifyStoredDefenceFile(input: {
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}) {
  let head: Awaited<ReturnType<typeof headProductAsset>>;
  try {
    head = await headProductAsset(input.storageKey);
  } catch (error) {
    throw storageValidationError(error);
  }
  if (head.ContentLength !== input.sizeBytes) {
    throw new ProductDisputeDefenceError("defence_file_size_mismatch");
  }
  const actualMetadataType = head.ContentType?.trim().toLowerCase();
  if (actualMetadataType !== input.contentType) {
    throw new ProductDisputeDefenceError("defence_file_type_mismatch");
  }
  let bytes: Uint8Array;
  try {
    bytes = await readProductAssetBytes(input.storageKey, MAX_DEFENCE_FILE_BYTES);
  } catch (error) {
    if (error instanceof ProductDisputeDefenceError) throw error;
    if (error instanceof Error && error.message === "product_asset_size_limit_exceeded") {
      throw new ProductDisputeDefenceError("defence_file_size_mismatch");
    }
    throw storageValidationError(error);
  }
  if (bytes.byteLength !== input.sizeBytes) {
    throw new ProductDisputeDefenceError("defence_file_size_mismatch");
  }
  if (detectDefenceContentType(bytes) !== input.contentType) {
    throw new ProductDisputeDefenceError("defence_file_content_type_mismatch");
  }
}

async function verifyStoredDefenceFiles(
  files: Array<{ storageKey: string; contentType: string; sizeBytes: number }>,
) {
  for (const file of files) await verifyStoredDefenceFile(file);
}

export async function getProductDisputeDefence(disputeId: string) {
  const [row] = await db
    .select({
      dispute: productCardDispute,
      defence: productDisputeDefence,
      order: productOrder,
    })
    .from(productCardDispute)
    .innerJoin(productOrder, eq(productOrder.id, productCardDispute.orderId))
    .leftJoin(productDisputeDefence, eq(productDisputeDefence.disputeId, productCardDispute.id))
    .where(eq(productCardDispute.id, disputeId))
    .limit(1);
  if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
  const files = row.defence
    ? await db
        .select()
        .from(productDisputeDefenceFile)
        .where(eq(productDisputeDefenceFile.defenceId, row.defence.id))
        .orderBy(asc(productDisputeDefenceFile.createdAt))
    : [];
  return { ...row, files };
}

/** Creates a short-lived, single-use grant bound to one dispute and object key. */
export async function createProductDisputeDefenceUploadGrant(input: {
  disputeId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}) {
  const file = validateFile(input);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        defence: productDisputeDefence,
        status: productCardDispute.status,
        productId: productOrder.productId,
      })
      .from(productDisputeDefence)
      .innerJoin(productCardDispute, eq(productCardDispute.id, productDisputeDefence.disputeId))
      .innerJoin(productOrder, eq(productOrder.id, productCardDispute.orderId))
      .where(eq(productDisputeDefence.disputeId, input.disputeId))
      .for("update");
    if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
    ensureOpen(row.status);
    if (row.defence.status === "submitted") {
      throw new ProductDisputeDefenceError("defence_already_submitted", 409);
    }

    const activeGrants = await tx
      .select({ id: productDisputeDefenceUploadGrant.id })
      .from(productDisputeDefenceUploadGrant)
      .where(
        and(
          eq(productDisputeDefenceUploadGrant.defenceId, row.defence.id),
          isNull(productDisputeDefenceUploadGrant.consumedAt),
          isNull(productDisputeDefenceUploadGrant.cleanedAt),
          gt(productDisputeDefenceUploadGrant.expiresAt, now),
        ),
      );
    const existingFiles = await tx
      .select({ id: productDisputeDefenceFile.id })
      .from(productDisputeDefenceFile)
      .where(eq(productDisputeDefenceFile.defenceId, row.defence.id));
    if (existingFiles.length + activeGrants.length >= MAX_DEFENCE_FILES) {
      throw new ProductDisputeDefenceError("too_many_defence_files", 409);
    }

    const nonce = randomUUID();
    const objectKey = `r2/products/${row.productId}/defence/${input.disputeId}/${nonce}-${file.fileName}`;
    const expiresAt = new Date(now.getTime() + UPLOAD_GRANT_TTL_MS);
    const [grant] = await tx
      .insert(productDisputeDefenceUploadGrant)
      .values({
        defenceId: row.defence.id,
        disputeId: input.disputeId,
        nonce,
        objectKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        expiresAt,
      })
      .returning();
    if (!grant) throw new Error("defence_upload_grant_not_persisted");
    return {
      grantId: grant.id,
      objectKey: grant.objectKey,
      contentType: grant.contentType,
      sizeBytes: grant.sizeBytes,
      expiresAt: grant.expiresAt,
    };
  });
}

export async function updateProductDisputeDefenceDraft(input: {
  disputeId: string;
  operatorNote?: string;
  expertNote?: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ defence: productDisputeDefence, status: productCardDispute.status })
      .from(productDisputeDefence)
      .innerJoin(productCardDispute, eq(productCardDispute.id, productDisputeDefence.disputeId))
      .where(eq(productDisputeDefence.disputeId, input.disputeId))
      .for("update");
    if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
    ensureOpen(row.status);
    if (row.defence.status === "submitted") {
      throw new ProductDisputeDefenceError("defence_already_submitted", 409);
    }
    const [updated] = await tx
      .update(productDisputeDefence)
      .set({
        ...(input.operatorNote !== undefined ? { operatorNote: input.operatorNote.trim() || null } : {}),
        ...(input.expertNote !== undefined ? { expertNote: input.expertNote.trim() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(productDisputeDefence.id, row.defence.id))
      .returning();
    return updated;
  });
}

export async function addProductDisputeDefenceFile(input: {
  disputeId: string;
  grantId: string;
  source: DefenceFileSource;
  uploadedByUserId?: string | null;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        grant: productDisputeDefenceUploadGrant,
        defence: productDisputeDefence,
        status: productCardDispute.status,
      })
      .from(productDisputeDefenceUploadGrant)
      .innerJoin(productDisputeDefence, eq(productDisputeDefence.id, productDisputeDefenceUploadGrant.defenceId))
      .innerJoin(productCardDispute, eq(productCardDispute.id, productDisputeDefenceUploadGrant.disputeId))
      .where(
        and(
          eq(productDisputeDefenceUploadGrant.id, input.grantId),
          eq(productDisputeDefenceUploadGrant.disputeId, input.disputeId),
        ),
      )
      .for("update");
    if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
    ensureOpen(row.status);
    if (row.defence.status === "submitted") {
      throw new ProductDisputeDefenceError("defence_already_submitted", 409);
    }
    if (row.grant.consumedAt || row.grant.cleanedAt) {
      throw new ProductDisputeDefenceError("defence_upload_grant_replayed", 409);
    }
    if (row.grant.expiresAt <= new Date()) {
      throw new ProductDisputeDefenceError("defence_upload_grant_expired", 409);
    }
    const existing = await tx
      .select({ id: productDisputeDefenceFile.id })
      .from(productDisputeDefenceFile)
      .where(eq(productDisputeDefenceFile.defenceId, row.defence.id));
    if (existing.length >= MAX_DEFENCE_FILES) {
      throw new ProductDisputeDefenceError("too_many_defence_files", 409);
    }
    await verifyStoredDefenceFile({
      storageKey: row.grant.objectKey,
      contentType: row.grant.contentType,
      sizeBytes: row.grant.sizeBytes,
    });
    const [created] = await tx
      .insert(productDisputeDefenceFile)
      .values({
        defenceId: row.defence.id,
        uploadGrantId: row.grant.id,
        source: input.source,
        fileName: row.grant.fileName,
        contentType: row.grant.contentType,
        sizeBytes: row.grant.sizeBytes,
        storageKey: row.grant.objectKey,
        uploadedByUserId: input.uploadedByUserId ?? null,
      })
      .returning();
    await tx
      .update(productDisputeDefenceUploadGrant)
      .set({ consumedAt: new Date() })
      .where(eq(productDisputeDefenceUploadGrant.id, row.grant.id));
    return created;
  });
}

/** Removes expired unconsumed objects while retaining their grant row as an
 * audit record. A consumed grant is never eligible for this cleanup. */
export async function cleanupExpiredProductDisputeDefenceUploads(
  now = new Date(),
  limit = 500,
) {
  const grants = await db
    .select()
    .from(productDisputeDefenceUploadGrant)
    .where(
      and(
        isNull(productDisputeDefenceUploadGrant.consumedAt),
        isNull(productDisputeDefenceUploadGrant.cleanedAt),
        lte(productDisputeDefenceUploadGrant.expiresAt, now),
      ),
    )
    .orderBy(asc(productDisputeDefenceUploadGrant.expiresAt))
    .limit(limit);

  let cleaned = 0;
  let missing = 0;
  let failed = 0;
  for (const grant of grants) {
    let reason = "expired_deleted";
    try {
      await deleteProductAsset(grant.objectKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("not_found")) {
        reason = "expired_missing";
        missing += 1;
      } else {
        failed += 1;
        continue;
      }
    }
    await db
      .update(productDisputeDefenceUploadGrant)
      .set({ cleanedAt: now, cleanupReason: reason })
      .where(
        and(
          eq(productDisputeDefenceUploadGrant.id, grant.id),
          isNull(productDisputeDefenceUploadGrant.consumedAt),
          isNull(productDisputeDefenceUploadGrant.cleanedAt),
        ),
      );
    cleaned += 1;
  }
  return { scanned: grants.length, cleaned, missing, failed };
}

export async function reviewProductDisputeDefence(input: {
  disputeId: string;
  operatorEmail: string;
  operatorNote?: string;
}) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ defence: productDisputeDefence, status: productCardDispute.status })
      .from(productDisputeDefence)
      .innerJoin(productCardDispute, eq(productCardDispute.id, productDisputeDefence.disputeId))
      .where(eq(productDisputeDefence.disputeId, input.disputeId))
      .for("update");
    if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
    ensureOpen(row.status);
    if (row.defence.status === "submitted") {
      throw new ProductDisputeDefenceError("defence_already_submitted", 409);
    }
    const files = await tx
      .select({ contentType: productDisputeDefenceFile.contentType, sizeBytes: productDisputeDefenceFile.sizeBytes })
      .from(productDisputeDefenceFile)
      .where(eq(productDisputeDefenceFile.defenceId, row.defence.id));
    if (files.length === 0) throw new ProductDisputeDefenceError("defence_requires_file");
    if (files.some((file) => file.sizeBytes <= 0 || file.sizeBytes > MAX_DEFENCE_FILE_BYTES || !ACCEPTED_CONTENT_TYPES.has(file.contentType))) {
      throw new ProductDisputeDefenceError("invalid_defence_file");
    }
    if (row.defence.deadlineAt && row.defence.deadlineAt <= new Date()) {
      throw new ProductDisputeDefenceError("defence_deadline_expired", 409);
    }
    const [updated] = await tx
      .update(productDisputeDefence)
      .set({
        reviewedAt: new Date(),
        reviewedByEmail: input.operatorEmail.trim().toLowerCase(),
        ...(input.operatorNote !== undefined ? { operatorNote: input.operatorNote.trim() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(productDisputeDefence.id, row.defence.id))
      .returning();
    return updated;
  });
}

export async function submitProductDisputeDefence(input: {
  disputeId: string;
}) {
  const now = new Date();
  const locked = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        defence: productDisputeDefence,
        dispute: productCardDispute,
        order: productOrder,
      })
      .from(productDisputeDefence)
      .innerJoin(productCardDispute, eq(productCardDispute.id, productDisputeDefence.disputeId))
      .innerJoin(productOrder, eq(productOrder.id, productCardDispute.orderId))
      .where(eq(productDisputeDefence.disputeId, input.disputeId))
      .for("update");
    if (!row) throw new ProductDisputeDefenceError("defence_case_not_found", 404);
    if (row.defence.submissionLockUntil && row.defence.submissionLockUntil > now) {
      throw new ProductDisputeDefenceError("defence_submission_in_progress", 409);
    }
    if (row.defence.status === "submitted") {
      throw new ProductDisputeDefenceError("defence_already_submitted", 409);
    }
    const files = await tx
      .select()
      .from(productDisputeDefenceFile)
      .where(eq(productDisputeDefenceFile.defenceId, row.defence.id))
      .orderBy(asc(productDisputeDefenceFile.createdAt));
    const caseInput: DisputeDefenceCase = {
      status: row.dispute.status,
      deadlineAt: row.defence.deadlineAt,
      originalProviderAccountId: row.defence.originalProviderAccountId,
      submittedAt: row.defence.submittedAt,
      submissionState: row.defence.status,
      files: files.map((file) => ({ name: file.fileName, contentType: file.contentType, size: file.sizeBytes, storageKey: file.storageKey })),
    };
    const decision = decideDisputeDefenceSubmission({ case: caseInput, reviewed: Boolean(row.defence.reviewedAt), now });
    if (!decision.allowed) return { row, files, decision, locked: false as const };
    const lockUntil = new Date(now.getTime() + SUBMISSION_LOCK_MS);
    await tx
      .update(productDisputeDefence)
      .set({ submissionLockUntil: lockUntil, updatedAt: now })
      .where(eq(productDisputeDefence.id, row.defence.id));
    return { row, files, decision, caseInput, locked: true as const };
  });

  if (!locked.locked) {
    await db.update(productDisputeDefence).set({ lastProviderError: locked.decision.reason, updatedAt: now }).where(eq(productDisputeDefence.id, locked.row.defence.id));
    return { state: "draft" as const, reason: locked.decision.reason };
  }

  try {
    await verifyStoredDefenceFiles(locked.files);
  } catch (error) {
    const failure =
      error instanceof ProductDisputeDefenceError
        ? error
        : new ProductDisputeDefenceError("defence_file_not_found");
    await db
      .update(productDisputeDefence)
      .set({
        submissionLockUntil: null,
        lastProviderError: failure.message,
        updatedAt: now,
      })
      .where(eq(productDisputeDefence.id, locked.row.defence.id));
    throw failure;
  }

  let providerResult:
    | Awaited<ReturnType<typeof submitDisputeDefence>>
    | { state: "unknown" };
  try {
    if (locked.row.dispute.provider !== "mercadopago") throw new Error("unsupported_defence_provider");
    if (!locked.row.defence.originalProviderAccountId) throw new Error("defence_original_provider_account_missing");
    const credentials = locked.row.order.expertIdSnapshot
      ? await getExpertMercadoPagoHistoricalAccount(locked.row.order.expertIdSnapshot, locked.row.defence.originalProviderAccountId)
      : { accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? process.env.MERCADO_PAGO_ACCESS_TOKEN ?? "" };
    if (!credentials.accessToken) throw new Error("mercadopago_not_configured");
    const provider = createMercadoPagoChargebackDefenceProvider({
      chargebackId: locked.row.dispute.providerDisputeId,
      accessToken: credentials.accessToken,
      callerId: locked.row.defence.originalProviderAccountId,
      idempotencyKey: `product-defence-${locked.row.defence.id}`,
    });
    providerResult = await submitDisputeDefence({
      case: locked.caseInput,
      reviewed: true,
      now,
      provider,
    });
  } catch (error) {
    providerResult = { state: "unknown" };
    console.error("product.dispute_defence.provider_failed", error);
  }

  if (providerResult.state === "submitted") {
    await db
      .update(productDisputeDefence)
      .set({
        status: "submitted",
        providerSubmissionId: providerResult.submissionId,
        providerResult: providerResult.result,
        submittedAt: now,
        lastProviderCheckedAt: now,
        lastProviderError: null,
        submissionLockUntil: null,
        updatedAt: now,
      })
      .where(eq(productDisputeDefence.id, locked.row.defence.id));
    return providerResult;
  }

  await db
    .update(productDisputeDefence)
    .set({
      status: "unknown",
      lastProviderCheckedAt: now,
      lastProviderError: "provider_state_inconclusive",
      submissionLockUntil: null,
      updatedAt: now,
    })
    .where(eq(productDisputeDefence.id, locked.row.defence.id));
  return { state: "unknown" as const };
}

export function isAllowedDefenceFileType(contentType: string) {
  return ACCEPTED_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}
