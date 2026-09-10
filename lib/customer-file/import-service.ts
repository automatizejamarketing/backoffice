/**
 * The public customer-list import operation: receive a file, preview it, confirm
 * it, run it durably, follow it and recover it. Both applications drive this
 * module — the frontend for the signed-in customer and the backoffice for an
 * authorized operator — so the rules, the limits and the observable states
 * cannot drift between the two surfaces.
 *
 * Everything that talks to Meta is injected. The service itself only decides
 * WHAT may happen: it revalidates authorization at every entry point, keeps
 * contact material inside the temporary area, binds a confirmation to every
 * input that can change a send, and refuses anything the specification refuses.
 */

import { createHash, randomUUID } from "node:crypto";
import type { CountryCode } from "libphonenumber-js";

import {
  CUSTOMER_FILE_MAX_BYTES,
  CUSTOMER_FILE_MAX_ROWS,
  CUSTOMER_FILE_RETENTION_MS,
  type CustomerFileMapping,
  type CustomerFileOperation,
  type CustomerFilePreview,
  type CustomerFileXlsxSelection,
  customerFileCorrectionReport,
  detectCustomerFileFormat,
  inspectCustomerFile,
  prepareCustomerFile,
  reviewCustomerFileConfirmation,
} from "@/lib/meta-business/marketing/audiences/customer-file";
import {
  CUSTOMER_FILE_BATCH_SIZE,
  type CustomerFileBatch,
  type CustomerFileExecution,
  type CustomerFileOperationState,
  type CustomerFileReceipt,
  customerFileUsageAvailability,
  executeCustomerFileOperation,
} from "@/lib/meta-business/marketing/audiences/customer-file-operation";
import {
  CUSTOMER_LIST_SOURCE,
  type CustomerListCreation,
  type CustomerListCreationState,
  executeCustomerListCreation,
} from "@/lib/meta-business/marketing/audiences/customer-list-creation";
import {
  type CustomerListRemoval,
  executeCustomerListRemoval,
} from "@/lib/meta-business/marketing/audiences/customer-list-removal";
import {
  type CustomerListReplacement,
  type CustomerListReplacementReconciliation,
  createCustomerListReplacementSessionId,
  executeCustomerListReplacement,
} from "@/lib/meta-business/marketing/audiences/customer-list-replacement";
import { formatCustomerFileBytes } from "./limits";
import type { SanitizedCustomerFileHistory } from "./sanitize";
import type { CustomerFileDurableStore, CustomerFilePersistedRecord } from "./types";

export { formatCustomerFileBytes };
export {
  CUSTOMER_FILE_MAX_BYTES,
  CUSTOMER_FILE_MAX_ROWS,
  CUSTOMER_FILE_RETENTION_MS,
  CUSTOMER_LIST_SOURCE,
};


export type CustomerFileImportStage =
  | "upload"
  | "preview"
  | "start"
  | "status"
  | "report"
  | "recover";

/** Who is acting, and for which Automatize customer. Never taken from the browser. */
export type CustomerFileImportActor = {
  kind: "user" | "backoffice";
  actorId: string;
  customerId: string;
};

export type CustomerFileImportTarget = {
  adAccountId: string;
  operation: CustomerFileOperation;
  /** Required for add/remove/replace; absent while creating a new list. */
  audienceId?: string;
  /** The new list's name/description, for `create`. */
  name?: string;
  description?: string;
};

/** Explicit per-operation declarations. There is no default and no silent accept. */
export type CustomerFileImportDeclarations = {
  dataOrigin: typeof CUSTOMER_LIST_SOURCE;
  termsAccepted: boolean;
};

export type CustomerFileImportSelection = {
  mapping: CustomerFileMapping;
  referenceCountry?: CountryCode;
  worksheet?: string;
};

export interface CustomerFileImportDependencies {
  store: CustomerFileDurableStore;
  /**
   * Revalidates actor, customer, ad account, token and Meta capabilities for
   * this stage. Throwing refuses the stage; it must throw when a permission or
   * a consultant linkage was revoked since the preview.
   */
  authorize(request: {
    stage: CustomerFileImportStage;
    target: CustomerFileImportTarget;
  }): Promise<void>;
  /** Reads the Meta customer-audience terms state. It must never accept them. */
  termsState(): Promise<{ accepted: boolean; guidance?: string }>;
  /** Creates the list shell with the declared data origin. */
  createAudience(input: {
    name: string;
    description?: string;
    adAccountId: string;
    customerFileSource: typeof CUSTOMER_LIST_SOURCE;
  }): Promise<{ id: string }>;
  send(request: {
    /** Resolved by the service: for a creation it is the list Meta just returned. */
    audienceId: string;
    operation: CustomerFileOperation;
    batch: CustomerFileBatch;
    sequence: number;
    sessionId?: string;
    lastBatch?: boolean;
  }): Promise<CustomerFileReceipt>;
  /** Consults remote evidence before any send or recovery. */
  revalidateRemote(request?: {
    operation: CustomerFileOperation;
    state: CustomerFileOperationState;
    confirmedBatches: number[];
    sessionId?: string;
  }): Promise<{ safeToContinue: boolean }>;
  /** Looks for a list that a failed create may already have produced. */
  reconcileCreation(creation: {
    id: string;
    name: string;
    adAccountId: string;
  }): Promise<{ id: string } | undefined>;
  /** Consults the v25 replacement session evidence before continuing it. */
  reconcileReplacement(
    replacement: CustomerListReplacement,
  ): Promise<CustomerListReplacementReconciliation>;
  newOperationId?(): string;
  now?(): Date;
}
export type CustomerFileImportErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_FILE"
  | "FILE_TOO_LARGE"
  | "MAPPING_REQUIRED"
  | "TEMPORARY_DATA_EXPIRED"
  | "STALE_PREVIEW"
  | "NO_VALID_ROWS"
  | "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED"
  | "REPLACEMENT_REQUIRES_CORRECTED_FILE"
  | "DECLARATIONS_REQUIRED"
  | "TERMS_PENDING"
  | "IMPORT_IN_PROGRESS"
  | "FEATURE_DISABLED";

const ERROR_STATUS: Record<CustomerFileImportErrorCode, number> = {
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  INVALID_FILE: 422,
  FILE_TOO_LARGE: 413,
  MAPPING_REQUIRED: 400,
  TEMPORARY_DATA_EXPIRED: 410,
  STALE_PREVIEW: 409,
  NO_VALID_ROWS: 422,
  EXPLICIT_VALID_ROWS_CONSENT_REQUIRED: 409,
  REPLACEMENT_REQUIRES_CORRECTED_FILE: 409,
  DECLARATIONS_REQUIRED: 409,
  TERMS_PENDING: 409,
  IMPORT_IN_PROGRESS: 409,
  FEATURE_DISABLED: 503,
};

export class CustomerFileImportError extends Error {
  readonly code: CustomerFileImportErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CustomerFileImportErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CustomerFileImportError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export type CustomerFileUploadResult = {
  operationId: string;
  format: "csv" | "xlsx";
  /** Present only while an XLSX worksheet ambiguity is unresolved. */
  worksheets?: string[];
  headers?: string[];
  receivedAt: string;
  expiresAt: string;
  limits: { maxBytes: number; maxBytesLabel: string; maxRows: number; batchSize: number };
  retentionNotice: string;
};

export type CustomerFileImportPreview = {
  operationId: string;
  previewToken: string;
  adAccountId: string;
  audience: { id?: string; name?: string; isNew: boolean };
  operation: CustomerFileOperation;
  mapping: CustomerFileMapping;
  /** Only meaningful when a phone column is mapped. */
  referenceCountry?: CountryCode;
  format: "csv" | "xlsx";
  worksheet?: string;
  samples: Array<{ line: number; email?: string; phone?: string; warnings: string[] }>;
  counts: CustomerFilePreview["counts"];
  invalidReasons: Array<{ code: string; message: string; count: number }>;
  report: { available: boolean; expiresAt: string; notice: string };
  confirmation: {
    allowed: boolean;
    reason?: "NO_VALID_ROWS" | "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED" | "REPLACEMENT_REQUIRES_CORRECTED_FILE";
    requiresValidRowsChoice: boolean;
    requiresCorrectedFile: boolean;
  };
  declarations: { dataOrigin: typeof CUSTOMER_LIST_SOURCE; termsAccepted: boolean; guidance?: string };
  limits: { maxBytes: number; maxBytesLabel: string; maxRows: number; batchSize: number };
};

export type CustomerFileImportPhase =
  | "validating"
  | "running"
  | "recovering"
  | "completed"
  | "failed_before_mutation"
  | "partial_or_unknown"
  | "action_required";

export type CustomerFileImportStatus = {
  operationId: string;
  operation: string;
  state: string;
  phase: CustomerFileImportPhase;
  label: string;
  detail: string;
  adAccountId: string | null;
  audienceId: string | null;
  audienceIdentity: string;
  receivedAt: string;
  updatedAt: string;
  counts: Record<string, number>;
  confirmedBatches: number;
  confirmedRecords: number;
  rejectedRecords: number;
  previewConfirmed: boolean;
  declarationsConfirmed: boolean;
  pendingUnresolved: boolean;
  temporaryDataAvailable: boolean;
  availability: ReturnType<typeof customerFileUsageAvailability>;
};

const PHASES: Record<string, { phase: CustomerFileImportPhase; label: string; detail: string }> = {
  awaiting_confirmation: {
    phase: "validating",
    label: "Em validação e prévia",
    detail: "Nenhum contato foi enviado à Meta. Confirme a prévia e as declarações para iniciar.",
  },
  creating: {
    phase: "running",
    label: "Em execução",
    detail: "Criando a lista na Meta antes da primeira carga. A operação continua com a tela fechada.",
  },
  running: {
    phase: "running",
    label: "Em execução",
    detail: "Enviando os lotes confirmados. A operação continua com a tela fechada.",
  },
  reconciling: {
    phase: "recovering",
    label: "Em recuperação e reconciliação",
    detail: "Consultando a evidência disponível antes de continuar. As quantidades já confirmadas são preservadas.",
  },
  completed: {
    phase: "completed",
    label: "Envio concluído",
    detail: "Todos os envios necessários foram confirmados e o material temporário foi eliminado. A população na Meta pode continuar em andamento e recebimento não é correspondência de pessoas.",
  },
  failed_before_mutation: {
    phase: "failed_before_mutation",
    label: "Falha comprovada antes de qualquer alteração",
    detail: "A operação falhou antes de alterar a lista. Isso não classifica a lista anterior como comprometida.",
  },
  partial: {
    phase: "partial_or_unknown",
    label: "Resultado parcial ou incerto",
    detail: "Parte dos registros foi rejeitada ou não confirmada. A lista pode estar diferente da pretendida até a resolução.",
  },
  unknown: {
    phase: "partial_or_unknown",
    label: "Resultado parcial ou incerto",
    detail: "Não há evidência suficiente do resultado do último envio. Reconcilie antes de qualquer nova tentativa.",
  },
  action_required: {
    phase: "action_required",
    label: "Nova ação necessária",
    detail: "É preciso corrigir o arquivo, enviar um novo arquivo ou resolver a pendência remota. Nada é reiniciado automaticamente.",
  },
};

function clock(deps: CustomerFileImportDependencies): Date {
  return deps.now ? deps.now() : new Date();
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function audienceIdentityOf(operationId: string, target: CustomerFileImportTarget): string {
  return target.operation === "create" ? `local-${operationId}` : target.audienceId!;
}

function limits() {
  return {
    maxBytes: CUSTOMER_FILE_MAX_BYTES,
    maxBytesLabel: formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES),
    maxRows: CUSTOMER_FILE_MAX_ROWS,
    batchSize: CUSTOMER_FILE_BATCH_SIZE,
  };
}

function retentionNotice(expiresAt: Date): string {
  return `O arquivo, os identificadores e o relatório de correção ficam disponíveis até ${expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (24 horas desde o recebimento) ou até a confirmação de todos os envios, o que ocorrer primeiro. Depois disso, uma nova ação exige um novo arquivo.`;
}

/** History is queried by customer; a foreign identifier never resolves. */
async function loadOperation(
  operationId: string,
  actor: CustomerFileImportActor,
  deps: CustomerFileImportDependencies,
): Promise<SanitizedCustomerFileHistory> {
  const operation = await deps.store.getOperation(operationId);
  if (!operation || operation.customerId !== actor.customerId) {
    throw new CustomerFileImportError("NOT_FOUND", "A operação de importação não existe neste contexto.");
  }
  return operation;
}

function targetOf(operation: SanitizedCustomerFileHistory, override?: Partial<CustomerFileImportTarget>): CustomerFileImportTarget {
  return {
    adAccountId: operation.adAccountId ?? "",
    operation: operation.operation as CustomerFileOperation,
    ...(operation.audienceId ? { audienceId: operation.audienceId } : {}),
    ...override,
  };
}

/**
 * Rebuilds the preview from the stored file. Re-parsing (instead of trusting a
 * client-held preview) is what makes a changed mapping, country or worksheet
 * produce a different token — and therefore a refused confirmation.
 */
async function reparse(
  operation: SanitizedCustomerFileHistory,
  selection: CustomerFileImportSelection,
  actor: CustomerFileImportActor,
  deps: CustomerFileImportDependencies,
): Promise<{ preview: CustomerFilePreview; token: string; receivedAt: Date; expiresAt: Date }> {
  const now = clock(deps);
  const material = await deps.store.getTemporary(operation.id, { customerId: actor.customerId }, now);
  if (!material?.rawFile) {
    throw new CustomerFileImportError(
      "TEMPORARY_DATA_EXPIRED",
      "Os dados temporários desta operação não estão mais disponíveis. Envie o arquivo novamente; a operação anterior continua registrada para reconciliação.",
    );
  }
  if (!selection.mapping.emailColumn && !selection.mapping.phoneColumn) {
    throw new CustomerFileImportError("MAPPING_REQUIRED", "Mapeie uma coluna de e-mail ou telefone.");
  }
  const prepared = prepareCustomerFile({
    bytes: material.rawFile,
    worksheet: selection.worksheet,
    mapping: selection.mapping,
    referenceCountry: selection.referenceCountry,
    context: {
      customerId: operation.customerId!,
      adAccountId: operation.adAccountId!,
      ...(operation.audienceId ? { audienceId: operation.audienceId } : {}),
      operation: operation.operation as CustomerFileOperation,
    },
    // Anchored to the original receipt: a retry never restarts the 24h clock.
    now: material.receivedAt,
  });
  if ("selectionRequired" in prepared) {
    throw new CustomerFileImportError("MAPPING_REQUIRED", "Escolha a planilha do arquivo antes de confirmar a prévia.", {
      worksheets: prepared.worksheets,
    });
  }
  return {
    preview: prepared,
    token: previewToken(operation, selection, prepared, material.rawFile),
    receivedAt: material.receivedAt,
    expiresAt: material.expiresAt,
  };
}

/** Binds a confirmation to every input that can change what gets sent. */
function previewToken(
  operation: SanitizedCustomerFileHistory,
  selection: CustomerFileImportSelection,
  preview: CustomerFilePreview,
  bytes: Uint8Array,
): string {
  return digest(
    JSON.stringify({
      operationId: operation.id,
      customerId: operation.customerId,
      adAccountId: operation.adAccountId,
      audienceId: operation.audienceId,
      operation: operation.operation,
      audienceName: operation.audienceName,
      mapping: { email: selection.mapping.emailColumn ?? null, phone: selection.mapping.phoneColumn ?? null },
      referenceCountry: preview.referenceCountry,
      worksheet: preview.worksheet ?? null,
      format: preview.format,
      file: digest(bytes),
    }),
  );
}

/**
 * A partial write must never blank the send progress: the durable record
 * overwrites batches and receipts, so every partial save carries them forward.
 */
function carriedProgress(operation: SanitizedCustomerFileHistory): CustomerFilePersistedRecord {
  return {
    id: operation.id,
    audienceIdentity: operation.audienceIdentity,
    ...(operation.audienceId ? { audienceId: operation.audienceId } : {}),
    state: operation.state,
    receivedAt: operation.receivedAt,
    confirmedBatches: operation.confirmedBatches,
    receipts: operation.receipts,
    ...(operation.sessionId ? { sessionId: operation.sessionId } : {}),
  };
}

function invalidReasons(preview: CustomerFilePreview) {
  const reasons = new Map<string, { code: string; message: string; count: number }>();
  for (const row of preview.rows) {
    for (const warning of row.warnings) {
      const current = reasons.get(warning.code) ?? { code: warning.code, message: warning.message, count: 0 };
      reasons.set(warning.code, { ...current, count: current.count + 1 });
    }
    if (!row.valid) {
      const current = reasons.get("NO_IDENTIFIER") ?? {
        code: "NO_IDENTIFIER",
        message: "Linha sem nenhum identificador válido.",
        count: 0,
      };
      reasons.set("NO_IDENTIFIER", { ...current, count: current.count + 1 });
    }
  }
  return [...reasons.values()];
}

function samplesOf(preview: CustomerFilePreview) {
  const valid = preview.rows.filter((row) => row.valid).slice(0, 5);
  const invalid = preview.rows.filter((row) => !row.valid).slice(0, 5);
  return [...valid, ...invalid]
    .sort((first, second) => first.line - second.line)
    .map((row) => ({
      line: row.line,
      ...(row.identifiers.email ? { email: row.identifiers.email } : {}),
      ...(row.identifiers.phone ? { phone: row.identifiers.phone } : {}),
      warnings: row.warnings.map((warning) => warning.message),
    }));
}

/**
 * Receives the file itself. Size, real format and structure are decided from
 * the object that actually arrived, never from its name or from a browser
 * preview. Nothing is sent to Meta here.
 */
export async function receiveCustomerFileUpload(
  input: {
    actor: CustomerFileImportActor;
    target: CustomerFileImportTarget;
    bytes: Uint8Array;
    worksheet?: string;
  },
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileUploadResult> {
  await deps.authorize({ stage: "upload", target: input.target });
  if (input.target.operation !== "create" && !input.target.audienceId) {
    throw new CustomerFileImportError("NOT_FOUND", "Escolha o público de lista de clientes desta operação.");
  }
  if (input.target.operation === "create" && !input.target.name?.trim()) {
    throw new CustomerFileImportError("INVALID_FILE", "Informe o nome da nova lista de clientes.");
  }
  if (input.bytes.byteLength === 0) {
    throw new CustomerFileImportError("INVALID_FILE", "O arquivo recebido está vazio.");
  }
  if (input.bytes.byteLength > CUSTOMER_FILE_MAX_BYTES) {
    throw new CustomerFileImportError(
      "FILE_TOO_LARGE",
      `O arquivo tem ${formatCustomerFileBytes(input.bytes.byteLength)} e excede o limite de ${formatCustomerFileBytes(CUSTOMER_FILE_MAX_BYTES)}. Envie um arquivo dentro do limite; nada é truncado.`,
    );
  }

  const operationId = deps.newOperationId ? deps.newOperationId() : randomUUID();
  const audienceIdentity = audienceIdentityOf(operationId, input.target);
  const conflict = await deps.store.getConflict(audienceIdentity);
  if (conflict) {
    throw new CustomerFileImportError(
      "IMPORT_IN_PROGRESS",
      "Já existe uma importação em andamento para este público. Atualize a situação dela; um segundo envio não entra em fila.",
      { operationId: conflict.operationId, state: conflict.state },
    );
  }

  let inspected: ReturnType<typeof inspectCustomerFile>;
  try {
    inspected = inspectCustomerFile({ bytes: input.bytes, worksheet: input.worksheet });
  } catch (error) {
    throw new CustomerFileImportError(
      "INVALID_FILE",
      error instanceof Error ? error.message : "O arquivo recebido não pôde ser interpretado com segurança.",
    );
  }

  const receivedAt = clock(deps);
  const expiresAt = new Date(receivedAt.getTime() + CUSTOMER_FILE_RETENTION_MS);
  await deps.store.save({
    id: operationId,
    audienceIdentity,
    ...(input.target.audienceId ? { audienceId: input.target.audienceId } : {}),
    operation: input.target.operation,
    state: "awaiting_confirmation",
    receivedAt,
    confirmedBatches: [],
    receipts: [],
    customerId: input.actor.customerId,
    adAccountId: input.target.adAccountId,
    actorKind: input.actor.kind,
    actorId: input.actor.actorId,
    ...(input.target.name ? { name: input.target.name, audienceName: input.target.name } : {}),
    ...(input.target.description ? { description: input.target.description } : {}),
  });
  await deps.store.putTemporary(operationId, { rawFile: input.bytes }, receivedAt);

  return {
    operationId,
    format: detectCustomerFileFormat(input.bytes),
    ...("selectionRequired" in inspected
      ? { worksheets: inspected.worksheets }
      : { headers: inspected.headers, ...(inspected.worksheet ? { worksheets: [inspected.worksheet] } : {}) }),
    receivedAt: receivedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    limits: limits(),
    retentionNotice: retentionNotice(expiresAt),
  };
}

/** Lists the worksheets/headers of an already received file, after a sheet choice. */
export async function inspectCustomerFileImport(
  input: { actor: CustomerFileImportActor; operationId: string; worksheet?: string },
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileXlsxSelection | { format: "csv" | "xlsx"; worksheet?: string; headers: string[] }> {
  const operation = await loadOperation(input.operationId, input.actor, deps);
  await deps.authorize({ stage: "preview", target: targetOf(operation) });
  const material = await deps.store.getTemporary(input.operationId, { customerId: input.actor.customerId }, clock(deps));
  if (!material?.rawFile) {
    throw new CustomerFileImportError("TEMPORARY_DATA_EXPIRED", "Os dados temporários expiraram. Envie o arquivo novamente.");
  }
  try {
    return inspectCustomerFile({ bytes: material.rawFile, worksheet: input.worksheet });
  } catch (error) {
    throw new CustomerFileImportError(
      "INVALID_FILE",
      error instanceof Error ? error.message : "O arquivo recebido não pôde ser interpretado com segurança.",
    );
  }
}

/** Interpreted examples, counts and reasons — still with nothing sent to Meta. */
export async function previewCustomerFileImport(
  input: {
    actor: CustomerFileImportActor;
    operationId: string;
    selection: CustomerFileImportSelection;
  },
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileImportPreview> {
  const operation = await loadOperation(input.operationId, input.actor, deps);
  await deps.authorize({ stage: "preview", target: targetOf(operation) });
  const { preview, token, expiresAt } = await reparse(operation, input.selection, input.actor, deps);
  const confirmation = reviewCustomerFileConfirmation(preview, true);
  const strict = reviewCustomerFileConfirmation(preview, false);
  const terms = await deps.termsState();

  await deps.store.save({
    ...carriedProgress(operation),
    counts: {
      read: preview.counts.read,
      valid: preview.counts.valid,
      invalid: preview.counts.invalid,
      warnings: preview.counts.warnings,
      duplicatesRemoved: preview.counts.duplicatesRemoved,
    },
  });

  return {
    operationId: operation.id,
    previewToken: token,
    adAccountId: operation.adAccountId!,
    audience: {
      ...(operation.audienceId ? { id: operation.audienceId } : {}),
      ...(operation.audienceName ? { name: operation.audienceName } : {}),
      isNew: operation.operation === "create",
    },
    operation: operation.operation as CustomerFileOperation,
    mapping: preview.mapping,
    ...(preview.mapping.phoneColumn ? { referenceCountry: preview.referenceCountry } : {}),
    format: preview.format,
    ...(preview.worksheet ? { worksheet: preview.worksheet } : {}),
    samples: samplesOf(preview),
    counts: preview.counts,
    invalidReasons: invalidReasons(preview),
    report: {
      available: preview.counts.invalid > 0 || preview.counts.warnings > 0,
      expiresAt: expiresAt.toISOString(),
      notice: retentionNotice(expiresAt),
    },
    confirmation: {
      allowed: confirmation.allowed,
      ...(confirmation.allowed ? {} : { reason: confirmation.reason }),
      requiresValidRowsChoice: confirmation.allowed && !strict.allowed,
      requiresCorrectedFile: !confirmation.allowed && confirmation.reason === "REPLACEMENT_REQUIRES_CORRECTED_FILE",
    },
    declarations: {
      dataOrigin: CUSTOMER_LIST_SOURCE,
      termsAccepted: terms.accepted,
      ...(terms.guidance ? { guidance: terms.guidance } : {}),
    },
    limits: limits(),
  };
}

/**
 * The correction report. It lives exactly as long as the temporary material,
 * and every value is escaped so a spreadsheet cannot execute it as a formula.
 */
export async function customerFileImportReport(
  input: {
    actor: CustomerFileImportActor;
    operationId: string;
    selection: CustomerFileImportSelection;
  },
  deps: CustomerFileImportDependencies,
): Promise<{ filename: string; csv: string; expiresAt: string }> {
  const operation = await loadOperation(input.operationId, input.actor, deps);
  await deps.authorize({ stage: "report", target: targetOf(operation) });
  const { preview, expiresAt } = await reparse(operation, input.selection, input.actor, deps);
  return {
    filename: `correcao-${operation.id}.csv`,
    csv: customerFileCorrectionReport(preview, clock(deps)),
    expiresAt: expiresAt.toISOString(),
  };
}

export type CustomerFileImportPlan = {
  actor: CustomerFileImportActor;
  operation: SanitizedCustomerFileHistory;
  target: CustomerFileImportTarget;
  preview: CustomerFilePreview;
  explicitlySendValidRows: boolean;
};

/**
 * Validates a start or a recovery completely — authorization, freshness of the
 * confirmation, the declarations and the per-operation rules for invalid rows —
 * and returns the plan to execute. Nothing has reached Meta when this resolves.
 */
export async function prepareCustomerFileImportRun(
  input: {
    actor: CustomerFileImportActor;
    operationId: string;
    previewToken: string;
    selection: CustomerFileImportSelection;
    explicitlySendValidRows: boolean;
    declarations: CustomerFileImportDeclarations;
    stage?: "start" | "recover";
  },
  deps: CustomerFileImportDependencies,
): Promise<{ plan: CustomerFileImportPlan; status: CustomerFileImportStatus }> {
  const operation = await loadOperation(input.operationId, input.actor, deps);
  const target = targetOf(operation, operation.operation === "create" ? { name: operation.audienceName ?? undefined } : {});
  await deps.authorize({ stage: input.stage ?? "start", target });

  if (input.declarations.dataOrigin !== CUSTOMER_LIST_SOURCE || !input.declarations.termsAccepted) {
    throw new CustomerFileImportError(
      "DECLARATIONS_REQUIRED",
      "Declare a origem dos dados e aceite os termos de listas de clientes da Meta antes de enviar contatos.",
    );
  }
  const terms = await deps.termsState();
  if (!terms.accepted) {
    throw new CustomerFileImportError(
      "TERMS_PENDING",
      terms.guidance ??
        "Os termos de públicos de listas de clientes ainda não constam como aceitos para esta conta. Aceite-os explicitamente antes de enviar contatos.",
    );
  }

  const { preview, token } = await reparse(operation, input.selection, input.actor, deps);
  if (token !== input.previewToken) {
    throw new CustomerFileImportError(
      "STALE_PREVIEW",
      "O arquivo, o mapeamento, o país de referência, o público ou a operação mudaram desde a prévia confirmada. Gere uma nova prévia antes de enviar.",
    );
  }

  const confirmation = reviewCustomerFileConfirmation(preview, input.explicitlySendValidRows);
  if (!confirmation.allowed) {
    throw new CustomerFileImportError(confirmation.reason, refusalMessage(confirmation.reason));
  }

  const conflict = await deps.store.getConflict(operation.audienceIdentity);
  if (conflict && conflict.operationId !== operation.id) {
    throw new CustomerFileImportError(
      "IMPORT_IN_PROGRESS",
      "Já existe uma importação em andamento para este público. Atualize a situação dela; um segundo envio não entra em fila.",
      { operationId: conflict.operationId, state: conflict.state },
    );
  }

  await deps.store.save({
    ...carriedProgress(operation),
    previewConfirmed: true,
    declarationsConfirmed: true,
  });

  const confirmed = await loadOperation(input.operationId, input.actor, deps);
  return {
    plan: {
      actor: input.actor,
      operation: confirmed,
      target,
      preview,
      explicitlySendValidRows: input.explicitlySendValidRows,
    },
    status: statusOf(confirmed, true),
  };
}

function refusalMessage(reason: "NO_VALID_ROWS" | "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED" | "REPLACEMENT_REQUIRES_CORRECTED_FILE"): string {
  if (reason === "NO_VALID_ROWS") return "Nenhuma linha tem identificador válido; nada será enviado à Meta.";
  if (reason === "REPLACEMENT_REQUIRES_CORRECTED_FILE") {
    return "A substituição exige um arquivo corrigido: há linhas sem nenhum identificador válido e a lista não pode ser trocada por um subconjunto involuntário.";
  }
  return "Há linhas sem identificador válido. Escolha explicitamente enviar somente as linhas válidas, conhecendo os descartes.";
}

/**
 * Enriches every executor save with the actor and context of the operation, and
 * observes the Meta audience id as soon as a creation binds one — that is how a
 * first load knows where to send without a second lookup.
 */
function persistingStore(
  plan: CustomerFileImportPlan,
  deps: CustomerFileImportDependencies,
  observeAudienceId: (audienceId: string) => void,
) {
  const identity: Partial<CustomerFilePersistedRecord> = {
    actorKind: plan.actor.kind,
    actorId: plan.actor.actorId,
    customerId: plan.actor.customerId,
    adAccountId: plan.target.adAccountId,
    previewConfirmed: true,
    declarationsConfirmed: true,
  };
  return {
    acquire: (operationId: string, audienceIdentity: string, now: Date) =>
      deps.store.acquire(operationId, audienceIdentity, now),
    stillOwns: (operationId: string, token: string, now: Date) =>
      deps.store.stillOwns(operationId, token, now),
    bindAudienceIdentity: async (operationId: string, token: string, audienceIdentity: string, now: Date) => {
      const bound = await deps.store.bindAudienceIdentity(operationId, token, audienceIdentity, now);
      if (bound) observeAudienceId(audienceIdentity);
      return bound;
    },
    discardTemporary: (operationId: string) => deps.store.discardTemporary(operationId),
    save: (record: CustomerFilePersistedRecord) => {
      if (record.audienceId) observeAudienceId(record.audienceId);
      return deps.store.save({ ...identity, ...record });
    },
  };
}

/**
 * Runs the confirmed plan. Progress is written to the shared store after every
 * batch, so closing the screen does not lose it and a later query — or a later
 * recovery — sees exactly what was confirmed.
 */
export async function runCustomerFileImportPlan(
  plan: CustomerFileImportPlan,
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileImportStatus> {
  const now = () => clock(deps);
  const operation = plan.operation;
  let audienceId = operation.audienceId ?? undefined;
  const store = persistingStore(plan, deps, (bound) => { audienceId = bound; });
  const authorize = async () => {
    await deps.authorize({ stage: "start", target: { ...plan.target, ...(audienceId ? { audienceId } : {}) } });
  };
  /** A batch can only leave once the list it belongs to is known. */
  const send = (request: {
    operation: CustomerFileOperation;
    batch: CustomerFileBatch;
    sequence: number;
    sessionId?: string;
    lastBatch?: boolean;
  }) => {
    if (!audienceId) throw new Error("A operação não tem um público Meta vinculado para receber os contatos.");
    return deps.send({ ...request, audienceId });
  };
  const shared = {
    store,
    authorize,
    revalidateRemote: deps.revalidateRemote,
    now,
  };

  if (operation.operation === "create") {
    const creation: CustomerListCreation = {
      id: operation.id,
      audienceIdentity: operation.audienceIdentity,
      ...(operation.audienceId ? { audienceId: operation.audienceId } : {}),
      state: operation.state as CustomerListCreationState,
      name: plan.target.name ?? operation.audienceName ?? "Lista de clientes",
      ...(plan.target.description ? { description: plan.target.description } : {}),
      customerId: operation.customerId!,
      adAccountId: operation.adAccountId!,
      receivedAt: operation.receivedAt,
      confirmedBatches: operation.confirmedBatches,
      receipts: operation.receipts,
      ...(operation.sessionId ? { sessionId: operation.sessionId } : {}),
    };
    await executeCustomerListCreation(
      { creation, preview: plan.preview, explicitlySendValidRows: plan.explicitlySendValidRows },
      {
        ...shared,
        createAudience: deps.createAudience,
        reconcileCreation: (pending) =>
          deps.reconcileCreation({ id: pending.id, name: pending.name, adAccountId: pending.adAccountId }),
        send,
      },
    );
  } else if (operation.operation === "replace") {
    const sessionStartedAt = operation.sessionStartedAt ?? now();
    const replacement: CustomerListReplacement = {
      id: operation.id,
      audienceIdentity: operation.audienceIdentity,
      audienceId: operation.audienceId!,
      customerId: operation.customerId!,
      adAccountId: operation.adAccountId!,
      state: operation.state as CustomerFileOperationState,
      receivedAt: operation.receivedAt,
      confirmedBatches: operation.confirmedBatches,
      receipts: operation.receipts,
      sessionId: operation.sessionId ?? createCustomerListReplacementSessionId(),
      sessionStartedAt,
    };
    await store.save({ ...replacement, operation: "replace" });
    await executeCustomerListReplacement(
      { replacement, preview: plan.preview },
      {
        store,
        authorize,
        reconcile: deps.reconcileReplacement,
        send: (request) =>
          send({
            operation: "replace",
            batch: request.batch,
            sequence: request.sequence,
            sessionId: request.sessionId,
            lastBatch: request.lastBatch,
          }),
        now,
      },
    );
  } else if (operation.operation === "remove") {
    const removal: CustomerListRemoval = {
      id: operation.id,
      audienceIdentity: operation.audienceIdentity,
      audienceId: operation.audienceId!,
      customerId: operation.customerId!,
      adAccountId: operation.adAccountId!,
      state: operation.state as CustomerFileOperationState,
      receivedAt: operation.receivedAt,
      confirmedBatches: operation.confirmedBatches,
      receipts: operation.receipts,
      ...(operation.sessionId ? { sessionId: operation.sessionId } : {}),
    };
    await executeCustomerListRemoval(
      { removal, preview: plan.preview, explicitlySendValidRows: plan.explicitlySendValidRows },
      { ...shared, send },
    );
  } else {
    const execution: CustomerFileExecution = {
      id: operation.id,
      audienceIdentity: operation.audienceIdentity,
      operation: "add",
      state: operation.state as CustomerFileOperationState,
      receivedAt: operation.receivedAt,
      confirmedBatches: operation.confirmedBatches,
      receipts: operation.receipts,
      ...(operation.sessionId ? { sessionId: operation.sessionId } : {}),
      rows: plan.preview.rows.filter((row) => row.valid).map((row) => row.identifiers),
    };
    await executeCustomerFileOperation(execution, { ...shared, send });
  }

  return customerFileImportStatus({ actor: plan.actor, operationId: operation.id }, deps);
}

/** Leaves a revoked or lost run visible as requiring explicit operator action. */
export async function markCustomerFileImportActionRequired(
  operationId: string,
  deps: CustomerFileImportDependencies,
): Promise<void> {
  const operation = await deps.store.getOperation(operationId);
  if (!operation || !["creating", "reconciling", "running"].includes(operation.state)) return;
  await deps.store.save({
    id: operation.id,
    audienceIdentity: operation.audienceIdentity,
    ...(operation.audienceId ? { audienceId: operation.audienceId } : {}),
    operation: operation.operation as CustomerFilePersistedRecord["operation"],
    state: "action_required",
    receivedAt: operation.receivedAt,
    confirmedBatches: operation.confirmedBatches,
    receipts: operation.receipts,
    ...(operation.sessionId ? { sessionId: operation.sessionId } : {}),
    ...(operation.sessionStartedAt ? { sessionStartedAt: operation.sessionStartedAt } : {}),
    ...(operation.customerId ? { customerId: operation.customerId } : {}),
    ...(operation.adAccountId ? { adAccountId: operation.adAccountId } : {}),
    ...(operation.actorKind ? { actorKind: operation.actorKind } : {}),
    ...(operation.actorId ? { actorId: operation.actorId } : {}),
    ...(operation.audienceName ? { audienceName: operation.audienceName } : {}),
    counts: operation.counts,
    previewConfirmed: operation.previewConfirmed,
    declarationsConfirmed: operation.declarationsConfirmed,
  });
}

function statusOf(
  operation: SanitizedCustomerFileHistory,
  temporaryDataAvailable: boolean,
): CustomerFileImportStatus {
  const phase = PHASES[operation.state] ?? PHASES.action_required!;
  return {
    operationId: operation.id,
    operation: operation.operation,
    state: operation.state,
    phase: phase.phase,
    label: phase.label,
    detail: phase.detail,
    adAccountId: operation.adAccountId,
    audienceId: operation.audienceId,
    audienceIdentity: operation.audienceIdentity,
    receivedAt: operation.receivedAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
    counts: operation.counts,
    confirmedBatches: operation.confirmedBatches.length,
    confirmedRecords: operation.receipts.reduce((total, receipt) => total + (receipt.received ?? 0) - (receipt.rejected ?? 0), 0),
    rejectedRecords: operation.receipts.reduce((total, receipt) => total + (receipt.rejected ?? 0), 0),
    previewConfirmed: operation.previewConfirmed,
    declarationsConfirmed: operation.declarationsConfirmed,
    pendingUnresolved: operation.pendingUnresolved,
    temporaryDataAvailable,
    availability: customerFileUsageAvailability(operation.state as CustomerFileOperationState),
  };
}

/** Follows one operation. Reopening the screen shows the confirmed progress. */
export async function customerFileImportStatus(
  input: { actor: CustomerFileImportActor; operationId: string },
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileImportStatus> {
  const operation = await loadOperation(input.operationId, input.actor, deps);
  await deps.authorize({ stage: "status", target: targetOf(operation) });
  const material = await deps.store.getTemporary(operation.id, { customerId: input.actor.customerId }, clock(deps));
  return statusOf(operation, Boolean(material?.rawFile));
}

/**
 * The customer's operational history, without contacts. It survives the
 * deletion of the Meta audience and the deactivation of the customer.
 */
export async function customerFileImportHistory(
  input: { actor: CustomerFileImportActor; adAccountId?: string },
  deps: CustomerFileImportDependencies,
): Promise<CustomerFileImportStatus[]> {
  await deps.authorize({
    stage: "status",
    target: { adAccountId: input.adAccountId ?? "", operation: "add" },
  });
  const history = await deps.store.listHistory(input.actor.customerId);
  return history
    .filter((operation) => !input.adAccountId || operation.adAccountId === input.adAccountId)
    .map((operation) => statusOf(operation, false));
}
