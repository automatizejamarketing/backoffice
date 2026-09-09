import type { SanitizedCustomerFileHistory } from "./sanitize";

export type CustomerFilePersistedRecord = {
  id: string;
  audienceIdentity: string;
  audienceId?: string;
  operation?: "create" | "add" | "remove" | "replace";
  state: string;
  receivedAt: Date;
  confirmedBatches?: number[];
  receipts?: Array<{ sequence: number; received?: number; rejected?: number }>;
  sessionId?: string;
  sessionStartedAt?: Date;
  customerId?: string;
  adAccountId?: string;
  actorKind?: "user" | "backoffice";
  actorId?: string;
  previewConfirmed?: boolean;
  declarationsConfirmed?: boolean;
  counts?: Record<string, number>;
  name?: string;
  description?: string;
  rows?: Array<{ email?: string; phone?: string }>;
};

export type CustomerFileTemporaryMaterial = {
  rawFile?: Uint8Array | null;
  rows?: Array<{ email?: string; phone?: string }>;
  hashes?: string[];
  errorSamples?: string[];
  report?: string;
  receivedAt: Date;
  expiresAt: Date;
};

export type CustomerFileConflict = {
  operationId: string;
  state: string;
  audienceIdentity: string;
};

export type CustomerFileDurableStore = {
  acquire(
    operationId: string,
    audienceIdentity: string,
    now: Date,
  ): Promise<{ token: string } | null>;
  stillOwns(operationId: string, token: string, now: Date): Promise<boolean>;
  bindAudienceIdentity(
    operationId: string,
    token: string,
    audienceIdentity: string,
    now: Date,
  ): Promise<boolean>;
  save(record: CustomerFilePersistedRecord): Promise<void>;
  discardTemporary(operationId: string): Promise<void>;
  putTemporary(
    operationId: string,
    material: Omit<CustomerFileTemporaryMaterial, "receivedAt" | "expiresAt">,
    receivedAt: Date,
  ): Promise<void>;
  getTemporary(
    operationId: string,
    access: { customerId: string },
    now: Date,
  ): Promise<CustomerFileTemporaryMaterial | null>;
  getConflict(audienceIdentity: string): Promise<CustomerFileConflict | null>;
  releaseAfterReconciliation(audienceIdentity: string, operationId: string): Promise<void>;
  listHistory(customerId: string): Promise<SanitizedCustomerFileHistory[]>;
  getOperation(operationId: string): Promise<SanitizedCustomerFileHistory | null>;
  discardExpiredTemporary(now: Date): Promise<number>;
  deactivateCustomer(customerId: string): Promise<void>;
  deleteHistoryForCustomer(customerId: string): Promise<void>;
  markAudienceDeleted(audienceId: string): Promise<void>;
};
