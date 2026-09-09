import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  productCardDispute,
  productDisputeDefence,
  productDisputeDefenceFile,
  productOrder,
  type ProductCardDisputeStatus,
} from "@/lib/db/schema";
import {
  decideDisputeDefenceSubmission,
  MAX_DEFENCE_FILE_BYTES,
  MAX_DEFENCE_FILES,
  submitDisputeDefence,
  type DisputeDefenceCase,
  type DisputeDefenceFile,
} from "@/lib/products/dispute-defense";
import { getExpertMercadoPagoHistoricalAccount } from "@/lib/mercadopago/historical-account";
import { createMercadoPagoChargebackDefenceProvider } from "@/lib/mercadopago/chargeback-defense";

const ACCEPTED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const SUBMISSION_LOCK_MS = 2 * 60 * 1000;

export type DefenceFileSource = "proposed" | "expert" | "operator";

export class ProductDisputeDefenceError extends Error {
  status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409 = 400) {
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
  if (!fileName || !input.sizeBytes || input.sizeBytes < 1 || input.sizeBytes > MAX_DEFENCE_FILE_BYTES) {
    throw new ProductDisputeDefenceError("invalid_defence_file_size");
  }
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    throw new ProductDisputeDefenceError("invalid_defence_file_type");
  }
  return { fileName, contentType, sizeBytes: input.sizeBytes };
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
  source: DefenceFileSource;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedByUserId?: string | null;
}) {
  const file = validateFile(input);
  if (!input.storageKey || input.storageKey.includes("..")) {
    throw new ProductDisputeDefenceError("invalid_defence_file_storage_key");
  }
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
    const existing = await tx
      .select({ id: productDisputeDefenceFile.id })
      .from(productDisputeDefenceFile)
      .where(eq(productDisputeDefenceFile.defenceId, row.defence.id));
    if (existing.length >= MAX_DEFENCE_FILES) {
      throw new ProductDisputeDefenceError("too_many_defence_files", 409);
    }
    const [created] = await tx
      .insert(productDisputeDefenceFile)
      .values({
        defenceId: row.defence.id,
        source: input.source,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        storageKey: input.storageKey,
        uploadedByUserId: input.uploadedByUserId ?? null,
      })
      .returning();
    return created;
  });
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
