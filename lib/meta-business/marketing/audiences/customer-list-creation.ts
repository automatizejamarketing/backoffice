import { type CustomerFilePreview, reviewCustomerFileConfirmation } from "./customer-file";
import {
  type CustomerFileBatch,
  type CustomerFileExecution,
  type CustomerFileExecutionDependencies,
  type CustomerFileExecutionStore,
  type CustomerFileOperationState,
  type CustomerFileReceipt,
  executeCustomerFileOperation,
} from "./customer-file-operation";
import { createCustomAudience } from "./create";

/** The declared origin required for a first-party customer list in Meta v25. */
export const CUSTOMER_LIST_SOURCE = "USER_PROVIDED_ONLY" as const;

export type CustomerListCreationState = "creating" | CustomerFileOperationState;

/** Persisted without members or hashes. */
export type CustomerListCreation = {
  id: string;
  audienceIdentity: string;
  audienceId?: string;
  state: CustomerListCreationState;
  name: string;
  description?: string;
  customerId: string;
  adAccountId: string;
  receivedAt: Date;
  confirmedBatches?: number[];
  receipts?: CustomerFileExecution["receipts"];
  sessionId?: string;
};

export interface CustomerListCreationStore {
  acquire(operationId: string, audienceIdentity: string, now: Date): Promise<{ token: string } | null>;
  stillOwns(operationId: string, token: string, now: Date): Promise<boolean>;
  bindAudienceIdentity(operationId: string, token: string, audienceIdentity: string, now: Date): Promise<boolean>;
  save(creation: CustomerListCreation): Promise<void>;
  discardTemporary(operationId: string): Promise<void>;
}

export interface CustomerListCreationDependencies {
  store: CustomerListCreationStore;
  fileStore?: CustomerFileExecutionStore;
  authorize(): Promise<void>;
  revalidateRemote(): Promise<{ safeToContinue: boolean }>;
  createAudience?(input: { name: string; description?: string; adAccountId: string; customerFileSource: typeof CUSTOMER_LIST_SOURCE }): Promise<{ id: string }>;
  accessToken?: string;
  reconcileCreation(creation: CustomerListCreation): Promise<{ id: string } | undefined>;
  send(request: { operation: "add"; batch: CustomerFileBatch; sequence: number; sessionId?: string }): Promise<CustomerFileReceipt>;
  now?: () => Date;
}

export async function createCustomerListAudience(input: { name: string; description?: string; adAccountId: string; accessToken: string }) {
  return createCustomAudience({
    type: "raw", subtype: "CUSTOM", customerFileSource: CUSTOMER_LIST_SOURCE,
    name: input.name, description: input.description, adAccountId: input.adAccountId, accessToken: input.accessToken,
  });
}

function importExecution(creation: CustomerListCreation, preview: CustomerFilePreview): CustomerFileExecution {
  return {
    id: creation.id, audienceIdentity: creation.audienceId!, operation: "add",
    state: creation.state === "creating" ? "awaiting_confirmation" : creation.state,
    receivedAt: creation.receivedAt, confirmedBatches: creation.confirmedBatches ?? [],
    receipts: creation.receipts ?? [], sessionId: creation.sessionId,
    rows: preview.rows.filter((row) => row.valid).map((row) => row.identifiers),
  };
}

function creationFromImport(creation: CustomerListCreation, execution: CustomerFileExecution): CustomerListCreation {
  return {
    ...creation, audienceIdentity: execution.audienceIdentity, audienceId: execution.audienceIdentity,
    state: execution.state, confirmedBatches: execution.confirmedBatches, receipts: execution.receipts, sessionId: execution.sessionId,
  };
}

/** Creates the list shell once, then delegates its initial member load to the shared executor. */
export async function executeCustomerListCreation(input: {
  creation: CustomerListCreation;
  preview: CustomerFilePreview;
  explicitlySendValidRows: boolean;
}, deps: CustomerListCreationDependencies): Promise<CustomerListCreation> {
  const now = deps.now ?? (() => new Date());
  const confirmation = reviewCustomerFileConfirmation(input.preview, input.explicitlySendValidRows);
  if (!confirmation.allowed) throw new Error(confirmation.reason);
  if (input.preview.context.operation !== "create") throw new Error("A primeira carga exige uma prévia de criação.");
  if (now() > input.preview.expiresAt) throw new Error("A prévia expirou; envie o arquivo novamente.");
  if (input.preview.context.customerId !== input.creation.customerId || input.preview.context.adAccountId !== input.creation.adAccountId) {
    throw new Error("A prévia não pertence ao cliente ou à conta desta criação.");
  }

  await deps.authorize();
  let creation = input.creation;
  let creationLease: { token: string } | undefined;
  if (!creation.audienceId) {
    const lease = await deps.store.acquire(creation.id, creation.audienceIdentity, now());
    if (!lease) throw new Error("Já existe uma criação de lista em andamento.");
    creationLease = lease;
    if (!(await deps.store.stillOwns(creation.id, lease.token, now()))) {
      const unknown = { ...creation, state: "unknown" as const };
      await deps.store.save(unknown);
      return unknown;
    }
    creation = { ...creation, state: "creating" };
    await deps.store.save(creation);
    try {
      const requested = { name: creation.name, description: creation.description, adAccountId: creation.adAccountId, customerFileSource: CUSTOMER_LIST_SOURCE };
      const created = deps.createAudience
        ? await deps.createAudience(requested)
        : await (async () => {
          if (!deps.accessToken) throw new Error("Token de acesso é obrigatório para criar a lista.");
          const result = await createCustomerListAudience({ ...requested, accessToken: deps.accessToken });
          if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join(","));
          return { id: result.id };
        })();
      if (!(await deps.store.bindAudienceIdentity(creation.id, lease.token, created.id, now()))) {
        const unknown = { ...creation, state: "unknown" as const };
        await deps.store.save(unknown);
        return unknown;
      }
      creation = { ...creation, audienceId: created.id, audienceIdentity: created.id, state: "awaiting_confirmation" };
      await deps.store.save(creation);
    } catch {
      creation = { ...creation, state: "reconciling" };
      await deps.store.save(creation);
      const reconciled = await deps.reconcileCreation(creation);
      if (!reconciled || !(await deps.store.bindAudienceIdentity(creation.id, lease.token, reconciled.id, now()))) {
        const unknown = { ...creation, state: "unknown" as const };
        await deps.store.save(unknown);
        return unknown;
      }
      creation = { ...creation, audienceId: reconciled.id, audienceIdentity: reconciled.id, state: "awaiting_confirmation" };
      await deps.store.save(creation);
    }
  }

  const fileStore = deps.fileStore ?? {
    acquire: async (operationId: string, audienceIdentity: string, acquiredAt: Date) =>
      creationLease && operationId === creation.id && audienceIdentity === creation.audienceId
        ? creationLease
        : deps.store.acquire(operationId, audienceIdentity, acquiredAt),
    stillOwns: deps.store.stillOwns.bind(deps.store),
    save: async (execution: CustomerFileExecution) => deps.store.save(creationFromImport(creation, execution)),
    discardTemporary: deps.store.discardTemporary.bind(deps.store),
  };
  const completed = await executeCustomerFileOperation(importExecution(creation, input.preview), {
    store: fileStore, authorize: deps.authorize, revalidateRemote: deps.revalidateRemote, send: deps.send, now,
  });
  return creationFromImport(creation, completed);
}

