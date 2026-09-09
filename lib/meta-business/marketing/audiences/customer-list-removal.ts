import {
  type CustomerFilePreview,
  reviewCustomerFileConfirmation,
} from "./customer-file";
import {
  type CustomerFileBatch,
  type CustomerFileExecution,
  type CustomerFileExecutionDependencies,
  type CustomerFileExecutionStore,
  type CustomerFileOperationState,
  type CustomerFileReceipt,
  executeCustomerFileOperation,
} from "./customer-file-operation";

/**
 * Sanitized durable record for an explicit customer-list removal. The shared
 * store is keyed by the Meta audience identity, allowing frontend and
 * backoffice adapters to reject concurrent member operations alike.
 */
export type CustomerListRemoval = {
  id: string;
  audienceIdentity: string;
  audienceId: string;
  customerId: string;
  adAccountId: string;
  state: CustomerFileOperationState;
  receivedAt: Date;
  confirmedBatches: number[];
  receipts: CustomerFileExecution["receipts"];
  sessionId?: string;
};

export interface CustomerListRemovalStore extends Omit<CustomerFileExecutionStore, "save"> {
  save(removal: CustomerListRemoval): Promise<void>;
}

export interface CustomerListRemovalDependencies {
  store: CustomerListRemovalStore;
  /** Revalidates the current customer, account, token, and operator linkage. */
  authorize(): Promise<void>;
  /** Refuses a send/recovery when the remote audience is no longer compatible. */
  revalidateRemote(): Promise<{ safeToContinue: boolean }>;
  /** Must use the v25 DELETE /{audience_id}/users adapter. */
  send(request: {
    operation: "remove";
    batch: CustomerFileBatch;
    sequence: number;
    sessionId?: string;
  }): Promise<CustomerFileReceipt>;
  now?: () => Date;
}

function executionFromRemoval(
  removal: CustomerListRemoval,
  preview: CustomerFilePreview,
): CustomerFileExecution {
  return {
    id: removal.id,
    audienceIdentity: removal.audienceIdentity,
    operation: "remove",
    state: removal.state,
    receivedAt: removal.receivedAt,
    confirmedBatches: removal.confirmedBatches,
    receipts: removal.receipts,
    sessionId: removal.sessionId,
    rows: preview.rows.filter((row) => row.valid).map((row) => row.identifiers),
  };
}

function removalFromExecution(
  removal: CustomerListRemoval,
  execution: CustomerFileExecution,
): CustomerListRemoval {
  return {
    ...removal,
    audienceIdentity: execution.audienceIdentity,
    state: execution.state,
    confirmedBatches: execution.confirmedBatches,
    receipts: execution.receipts,
    sessionId: execution.sessionId,
  };
}

/**
 * Confirms and executes one file-based removal. Receipt counts mean Meta
 * received/rejected entries; they never claim a number of matched people or
 * deleted members. Errors after a possible remote send stay `unknown` for
 * reconciliation and are never blindly retried here.
 */
export async function executeCustomerListRemoval(input: {
  removal: CustomerListRemoval;
  preview: CustomerFilePreview;
  explicitlySendValidRows: boolean;
}, deps: CustomerListRemovalDependencies): Promise<CustomerListRemoval> {
  const now = deps.now ?? (() => new Date());
  const confirmation = reviewCustomerFileConfirmation(input.preview, input.explicitlySendValidRows);
  if (!confirmation.allowed) throw new Error(confirmation.reason);
  if (input.preview.context.operation !== "remove") throw new Error("A remoção exige uma prévia de remoção.");
  if (now() > input.preview.expiresAt) throw new Error("A prévia expirou; envie o arquivo novamente.");
  if (
    input.preview.context.customerId !== input.removal.customerId ||
    input.preview.context.adAccountId !== input.removal.adAccountId ||
    input.preview.context.audienceId !== input.removal.audienceId ||
    input.removal.audienceIdentity !== input.removal.audienceId
  ) throw new Error("A prévia não pertence ao cliente, conta ou público desta remoção.");

  const store: CustomerFileExecutionStore = {
    acquire: deps.store.acquire.bind(deps.store),
    stillOwns: deps.store.stillOwns.bind(deps.store),
    save: async (execution) => deps.store.save(removalFromExecution(input.removal, execution)),
    discardTemporary: deps.store.discardTemporary.bind(deps.store),
  };
  const execution = await executeCustomerFileOperation(executionFromRemoval(input.removal, input.preview), {
    store,
    authorize: deps.authorize,
    revalidateRemote: deps.revalidateRemote,
    send: deps.send,
    now,
  });
  return removalFromExecution(input.removal, execution);
}

