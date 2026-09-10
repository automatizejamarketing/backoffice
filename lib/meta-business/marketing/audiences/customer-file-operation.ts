import { createHash } from "node:crypto";

import { metaApiCall } from "@/lib/meta-business/api";
import { CUSTOMER_FILE_RETENTION_MS, type CustomerFileOperation } from "./customer-file";

/** Meta allows at most 10,000 customer records in one members request. */
export const CUSTOMER_FILE_BATCH_SIZE = 10_000;

export type CustomerFileIdentifier = { email?: string; phone?: string };
export type CustomerFileBatch = { schema: Array<"EMAIL" | "PHONE">; data: string[][] };
export type CustomerFileOperationState =
  | "awaiting_confirmation"
  | "running"
  | "reconciling"
  | "completed"
  | "failed_before_mutation"
  | "partial"
  | "unknown"
  | "action_required";

export type CustomerFileReceipt = {
  num_received?: number;
  num_invalid_entries?: number;
  session_id?: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Converts the already-previewed, normalized identifiers into Meta's v25
 * `schema`/`data` shape. This boundary intentionally accepts no raw fields:
 * parsing and normalization stay in customer-file.ts and the hashes never
 * belong in history or observability.
 */
export function buildCustomerFileBatches(rows: CustomerFileIdentifier[]): CustomerFileBatch[] {
  const schema: CustomerFileBatch["schema"] = [];
  if (rows.some((row) => row.email)) schema.push("EMAIL");
  if (rows.some((row) => row.phone)) schema.push("PHONE");
  if (!schema.length) throw new Error("A operação exige ao menos um identificador normalizado.");

  const batches: CustomerFileBatch[] = [];
  for (let offset = 0; offset < rows.length; offset += CUSTOMER_FILE_BATCH_SIZE) {
    batches.push({
      schema,
      data: rows.slice(offset, offset + CUSTOMER_FILE_BATCH_SIZE).map((row) =>
        schema.map((field) => {
          const value = field === "EMAIL" ? row.email : row.phone;
          return value ? hash(value) : "";
        }),
      ),
    });
  }
  return batches;
}

/** Maps a confirmed HTTP response without mistaking a receipt for matching. */
export function classifyCustomerFileReceipt(
  receipt: CustomerFileReceipt,
  attempted: number,
): { state: "completed" | "partial"; confirmed: number; rejected: number } {
  const rejected = Math.max(0, receipt.num_invalid_entries ?? 0);
  const received = Math.max(0, receipt.num_received ?? attempted);
  const confirmed = Math.max(0, Math.min(attempted - rejected, received - rejected));
  return rejected > 0 || received < attempted
    ? { state: "partial", confirmed, rejected: Math.max(rejected, attempted - received) }
    : { state: "completed", confirmed, rejected: 0 };
}

/**
 * A known partial or unknown import blocks only future advanced uses. It does
 * not reinterpret ordinary Meta processing or a pre-mutation failure.
 */
export function customerFileUsageAvailability(state: CustomerFileOperationState): {
  include: "available" | "blocked";
  exclude: "available" | "blocked";
  lookalikeSource: "available" | "blocked";
} {
  const blocked = state === "partial" || state === "unknown";
  return {
    include: blocked ? "blocked" : "available",
    exclude: blocked ? "blocked" : "available",
    lookalikeSource: blocked ? "blocked" : "available",
  };
}

/** Edge and method are explicit so callers cannot issue a forbidden GET /users. */
export function customerFileMembersRequest(operation: CustomerFileOperation): {
  method: "POST" | "DELETE";
  edge: "users" | "usersreplace";
} {
  if (operation === "remove") return { method: "DELETE", edge: "users" };
  if (operation === "replace") return { method: "POST", edge: "usersreplace" };
  return { method: "POST", edge: "users" };
}

/** Sends one already-authorized batch; this is never used for member reads. */
export async function sendCustomerFileBatch(input: {
  audienceId: string;
  accessToken: string;
  operation: CustomerFileOperation;
  batch: CustomerFileBatch;
  sessionId?: string;
}): Promise<CustomerFileReceipt> {
  const request = customerFileMembersRequest(input.operation);
  const body = new URLSearchParams({
    schema: JSON.stringify(input.batch.schema),
    data: JSON.stringify(input.batch.data),
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
  });
  return metaApiCall<CustomerFileReceipt>({
    method: request.method,
    path: `${input.audienceId}/${request.edge}`,
    params: "",
    body,
    accessToken: input.accessToken,
  });
}

/**
 * Durable execution boundary. The application and backoffice supply the same
 * database-backed store, so the lease is shared by Meta audience identity,
 * not by browser session or local customer context. The store must acquire
 * leases atomically (a conditional UPDATE/unique key), and must delete its
 * temporary material on `discardTemporary`.
 */
export type CustomerFileExecution = {
  id: string;
  audienceIdentity: string;
  operation: CustomerFileOperation;
  state: CustomerFileOperationState;
  receivedAt: Date;
  confirmedBatches: number[];
  /** Sanitized receipt evidence only: no members, hashes or samples. */
  receipts: Array<{ sequence: number; received?: number; rejected?: number }>;
  sessionId?: string;
  rows?: CustomerFileIdentifier[];
};

export interface CustomerFileExecutionStore {
  acquire(operationId: string, audienceIdentity: string, now: Date): Promise<{ token: string } | null>;
  stillOwns(operationId: string, token: string, now: Date): Promise<boolean>;
  save(execution: CustomerFileExecution): Promise<void>;
  discardTemporary(operationId: string): Promise<void>;
}

export interface CustomerFileExecutionDependencies {
  store: CustomerFileExecutionStore;
  /** Revalidates customer, account, token, capability and operator linkage. */
  authorize(): Promise<void>;
  /** Checks remote audience/session evidence before any send or recovery. */
  revalidateRemote(request?: {
    operation: CustomerFileOperation;
    state: CustomerFileOperationState;
    confirmedBatches: number[];
    sessionId?: string;
  }): Promise<{ safeToContinue: boolean }>;
  send(request: {
    operation: CustomerFileOperation;
    batch: CustomerFileBatch;
    sequence: number;
    sessionId?: string;
  }): Promise<CustomerFileReceipt>;
  now?: () => Date;
}

/**
 * Runs only confirmed, unsent batches. A timeout/error is deliberately left
 * `unknown`: a caller must reconcile remote evidence before another attempt;
 * this executor never assumes Meta idempotency.
 */
export async function executeCustomerFileOperation(
  execution: CustomerFileExecution,
  deps: CustomerFileExecutionDependencies,
): Promise<CustomerFileExecution> {
  const now = deps.now ?? (() => new Date());
  await deps.authorize();
  if (now().getTime() > execution.receivedAt.getTime() + CUSTOMER_FILE_RETENTION_MS) {
    const expired = { ...execution, state: "action_required" as const, rows: undefined };
    await deps.store.save(expired);
    await deps.store.discardTemporary(expired.id);
    return expired;
  }
  const lease = await deps.store.acquire(execution.id, execution.audienceIdentity, now());
  if (!lease) throw new Error("Já existe uma importação em andamento para este público.");
  if (!(await deps.revalidateRemote({
    operation: execution.operation,
    state: execution.state,
    confirmedBatches: execution.confirmedBatches,
    ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
  })).safeToContinue) {
    const blocked = { ...execution, state: "action_required" as const };
    await deps.store.save(blocked);
    return blocked;
  }
  if (!execution.rows) {
    const required = { ...execution, state: "action_required" as const };
    await deps.store.save(required);
    return required;
  }

  const batches = buildCustomerFileBatches(execution.rows);
  let current: CustomerFileExecution = { ...execution, state: "running" };
  await deps.store.save(current);
  for (let sequence = 0; sequence < batches.length; sequence += 1) {
    if (current.confirmedBatches.includes(sequence)) continue;
    // Permissions can be revoked while a multi-batch operation is running.
    // Recheck before every remote mutation; never turn that refusal into a
    // retryable/unknown send because no request was issued for this batch.
    await deps.authorize();
    if (!(await deps.store.stillOwns(current.id, lease.token, now()))) {
      const lost = { ...current, state: "unknown" as const };
      await deps.store.save(lost);
      return lost;
    }
    try {
      const receipt = await deps.send({ operation: current.operation, batch: batches[sequence]!, sequence, sessionId: current.sessionId });
      const outcome = classifyCustomerFileReceipt(receipt, batches[sequence]!.data.length);
      if (outcome.state === "partial") {
        const partial = {
          ...current,
          state: "partial" as const,
          ...(receipt.session_id ? { sessionId: receipt.session_id } : {}),
          receipts: [...current.receipts, {
            sequence,
            ...(receipt.num_received != null ? { received: receipt.num_received } : {}),
            ...(receipt.num_invalid_entries != null ? { rejected: receipt.num_invalid_entries } : {}),
          }],
        };
        await deps.store.save(partial);
        return partial;
      }
      current = {
        ...current,
        confirmedBatches: [...current.confirmedBatches, sequence],
        ...(receipt.session_id ? { sessionId: receipt.session_id } : {}),
        receipts: [...current.receipts, {
          sequence,
          ...(receipt.num_received != null ? { received: receipt.num_received } : {}),
          ...(receipt.num_invalid_entries != null ? { rejected: receipt.num_invalid_entries } : {}),
        }],
      };
      await deps.store.save(current);
    } catch {
      const unknown = { ...current, state: "unknown" as const };
      await deps.store.save(unknown);
      return unknown;
    }
  }
  const completed = { ...current, state: "completed" as const, rows: undefined };
  await deps.store.save(completed);
  await deps.store.discardTemporary(completed.id);
  return completed;
}
