import { randomUUID } from "node:crypto";

import {
  type CustomerFilePreview,
  CUSTOMER_FILE_RETENTION_MS,
  reviewCustomerFileConfirmation,
} from "./customer-file";
import {
  buildCustomerFileBatches,
  classifyCustomerFileReceipt,
  type CustomerFileBatch,
  type CustomerFileExecutionStore,
  type CustomerFileOperationState,
  type CustomerFileReceipt,
} from "./customer-file-operation";
import { metaApiCall } from "@/lib/meta-business/api";

/** Meta's documented usersreplace session window. It is independent of local retention. */
export const CUSTOMER_LIST_REPLACEMENT_SESSION_MS = 90 * 60 * 1000;

/**
 * Sanitized durable replacement record. It deliberately carries neither raw
 * rows nor hashes: those remain in the temporary file store until completion
 * or the 24-hour retention deadline.
 */
export type CustomerListReplacement = {
  id: string;
  audienceIdentity: string;
  audienceId: string;
  customerId: string;
  adAccountId: string;
  state: CustomerFileOperationState;
  receivedAt: Date;
  confirmedBatches: number[];
  receipts: Array<{ sequence: number; received?: number; rejected?: number }>;
  sessionId: string;
  sessionStartedAt: Date;
};

export interface CustomerListReplacementStore extends Omit<CustomerFileExecutionStore, "save"> {
  save(replacement: CustomerListReplacement): Promise<void>;
}

export type CustomerListReplacementReconciliation =
  | { safeToContinue: false }
  | { safeToContinue: true; sessionId: string; confirmedBatches: number[] };

export interface CustomerListReplacementDependencies {
  store: CustomerListReplacementStore;
  /** Revalidates customer, account, token, capability and operator linkage. */
  authorize(): Promise<void>;
  /**
   * Consults the available v25 session/status evidence. Continuation is safe
   * only when it confirms this exact session and already-confirmed sequence.
   */
  reconcile(replacement: CustomerListReplacement): Promise<CustomerListReplacementReconciliation>;
  send(request: {
    batch: CustomerFileBatch;
    sessionId: string;
    sequence: number;
    lastBatch: boolean;
  }): Promise<CustomerFileReceipt>;
  now?: () => Date;
}

/** Sends a single batch in the one product-level usersreplace session. */
export async function sendCustomerListReplacementBatch(input: {
  audienceId: string;
  accessToken: string;
  batch: CustomerFileBatch;
  sessionId: string;
  sequence: number;
  lastBatch: boolean;
}): Promise<CustomerFileReceipt> {
  const body = new URLSearchParams({
    schema: JSON.stringify(input.batch.schema),
    data: JSON.stringify(input.batch.data),
    session_id: input.sessionId,
    batch_seq: String(input.sequence),
    last_batch_flag: String(input.lastBatch),
  });
  return metaApiCall<CustomerFileReceipt>({
    method: "POST", path: `${input.audienceId}/usersreplace`, params: "", body, accessToken: input.accessToken,
  });
}

function replacementFromPreview(preview: CustomerFilePreview) {
  return preview.rows.filter((row) => row.valid).map((row) => row.identifiers);
}

function requiresReconciliation(state: CustomerFileOperationState): boolean {
  return state === "unknown" || state === "reconciling" || state === "running";
}

/**
 * Executes a complete intended list replacement. There is no automatic retry
 * or fresh session: an interruption becomes `action_required` unless v25
 * evidence confirms the existing session and its exact batch progress.
 */
export async function executeCustomerListReplacement(input: {
  replacement: CustomerListReplacement;
  preview: CustomerFilePreview;
}, deps: CustomerListReplacementDependencies): Promise<CustomerListReplacement> {
  const now = deps.now ?? (() => new Date());
  const confirmation = reviewCustomerFileConfirmation(input.preview, false);
  if (!confirmation.allowed) throw new Error(confirmation.reason);
  const replacement = input.replacement;
  if (input.preview.context.operation !== "replace") throw new Error("A substituição exige uma prévia de substituição.");
  if (now() > input.preview.expiresAt) throw new Error("A prévia expirou; envie o arquivo novamente.");
  if (
    input.preview.context.customerId !== replacement.customerId ||
    input.preview.context.adAccountId !== replacement.adAccountId ||
    input.preview.context.audienceId !== replacement.audienceId ||
    replacement.audienceIdentity !== replacement.audienceId
  ) throw new Error("A prévia não pertence ao cliente, conta ou público desta substituição.");

  await deps.authorize();
  const lease = await deps.store.acquire(replacement.id, replacement.audienceIdentity, now());
  if (!lease) throw new Error("Já existe uma importação em andamento para este público.");
  if (!(await deps.store.stillOwns(replacement.id, lease.token, now()))) {
    const lost = { ...replacement, state: "unknown" as const };
    await deps.store.save(lost);
    return lost;
  }

  if (now().getTime() > replacement.sessionStartedAt.getTime() + CUSTOMER_LIST_REPLACEMENT_SESSION_MS) {
    const expired = { ...replacement, state: "action_required" as const };
    await deps.store.save(expired);
    await deps.store.discardTemporary(expired.id);
    return expired;
  }
  if (now().getTime() > replacement.receivedAt.getTime() + CUSTOMER_FILE_RETENTION_MS) {
    const expired = { ...replacement, state: "action_required" as const };
    await deps.store.save(expired);
    await deps.store.discardTemporary(expired.id);
    return expired;
  }

  let current = replacement;
  if (requiresReconciliation(current.state)) {
    current = { ...current, state: "reconciling" };
    await deps.store.save(current);
    const reconciliation = await deps.reconcile(current);
    if (!reconciliation.safeToContinue || reconciliation.sessionId !== current.sessionId ||
      reconciliation.confirmedBatches.some((sequence) => !current.confirmedBatches.includes(sequence)) ||
      current.confirmedBatches.some((sequence) => !reconciliation.confirmedBatches.includes(sequence))) {
      const required = { ...current, state: "action_required" as const };
      await deps.store.save(required);
      return required;
    }
    current = { ...current, confirmedBatches: reconciliation.confirmedBatches, state: "running" };
  } else if (current.state === "awaiting_confirmation") {
    current = { ...current, state: "running" };
  } else if (current.state !== "running") {
    const required = { ...current, state: "action_required" as const };
    await deps.store.save(required);
    return required;
  }
  await deps.store.save(current);

  const batches = buildCustomerFileBatches(replacementFromPreview(input.preview));
  for (let sequence = 0; sequence < batches.length; sequence += 1) {
    if (current.confirmedBatches.includes(sequence)) continue;
    await deps.authorize();
    if (!(await deps.store.stillOwns(current.id, lease.token, now()))) {
      const lost = { ...current, state: "unknown" as const };
      await deps.store.save(lost);
      return lost;
    }
    try {
      const receipt = await deps.send({ batch: batches[sequence]!, sessionId: current.sessionId, sequence, lastBatch: sequence === batches.length - 1 });
      const outcome = classifyCustomerFileReceipt(receipt, batches[sequence]!.data.length);
      const recorded = {
        ...current,
        receipts: [...current.receipts, {
          sequence,
          ...(receipt.num_received != null ? { received: receipt.num_received } : {}),
          ...(receipt.num_invalid_entries != null ? { rejected: receipt.num_invalid_entries } : {}),
        }],
      };
      if (outcome.state === "partial") {
        const partial = { ...recorded, state: "partial" as const };
        await deps.store.save(partial);
        return partial;
      }
      current = { ...recorded, state: "running", confirmedBatches: [...current.confirmedBatches, sequence] };
      await deps.store.save(current);
    } catch {
      const unknown = { ...current, state: "unknown" as const };
      await deps.store.save(unknown);
      return unknown;
    }
  }
  const completed = { ...current, state: "completed" as const };
  await deps.store.save(completed);
  await deps.store.discardTemporary(completed.id);
  return completed;
}

/** Creates a non-contact session identity for callers preparing a replacement. */
export function createCustomerListReplacementSessionId(): string {
  return randomUUID();
}

