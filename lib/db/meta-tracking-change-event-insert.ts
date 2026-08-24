import type { TrackingChangeEventDraft } from "@/lib/meta-tracking/compute-tracking-delta";

/**
 * Cada change event envia 15 valores parametrizados. O lote-alvo de 500
 * manterá cada statement em 7.500 binds, com ampla folga do teto de 65.535 do
 * protocolo PostgreSQL.
 */
export const CHANGE_EVENT_INSERT_BATCH_SIZE = 500;
export const CHANGE_EVENT_BIND_PARAMETERS_PER_ROW = 15;
export const CHANGE_EVENT_INSERT_ERROR_CATEGORY =
  "DB_CHANGE_EVENTS_BULK_INSERT_FAILED";

const MAX_SAFE_DATABASE_CAUSE_LENGTH = 300;
const MAX_ERROR_CAUSE_DEPTH = 5;
const SAFE_DATABASE_REASON_FALLBACK =
  "Database statement rejected; sensitive details omitted.";

export type ChangeEventInsertRow = Omit<
  TrackingChangeEventDraft,
  "toVersionRef"
> & {
  toConfigVersionId: string | null;
  detectionRunId: string;
};

export type ChangeEventBatchWriter = (
  rows: ChangeEventInsertRow[],
) => Promise<void>;

type ErrorWithCauseAndCode = Error & {
  cause?: unknown;
  code?: string;
};

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (
    current !== null &&
    current !== undefined &&
    !seen.has(current) &&
    chain.length < MAX_ERROR_CAUSE_DEPTH
  ) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return chain;
}

function errorMessageOf(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  if (typeof error === "string" && error) return error;
  return null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}

function sanitizeDatabaseReason(
  message: string,
  sqlState: string | undefined,
): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  const bindCount = normalized.match(
    /\bbind message supplies (\d{1,6}) parameters?, but prepared statement requires (\d{1,6})\b/i,
  );
  if (sqlState === "08P01" && bindCount) {
    return truncate(
      `Bind parameter count mismatch (supplied ${bindCount[1]}, expected ${bindCount[2]}).`,
      MAX_SAFE_DATABASE_CAUSE_LENGTH,
    );
  }

  const knownReason: Record<string, string> = {
    "22001": "Value exceeds the target column length.",
    "22P02": "Invalid value syntax.",
    "23502": "Required database value is missing.",
    "23503": "Foreign key constraint violation.",
    "23505": "Unique constraint violation.",
    "40001": "Database transaction serialization failure.",
    "40P01": "Database transaction deadlock.",
    "57014": "Database statement was cancelled.",
    "08P01": "Database protocol violation.",
  };
  if (sqlState && knownReason[sqlState]) return knownReason[sqlState];
  if (sqlState?.startsWith("08")) return "Database connection or protocol failure.";
  if (sqlState?.startsWith("23")) return "Database integrity constraint violation.";
  return SAFE_DATABASE_REASON_FALLBACK;
}

function sqlStateOf(chain: readonly unknown[]): string | undefined {
  for (const item of chain) {
    if (typeof item !== "object" || item === null || !("code" in item)) continue;
    const code = (item as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/i.test(code)) {
      return code.toUpperCase();
    }
  }
  return undefined;
}

/**
 * Drizzle inclui o statement inteiro e todos os parâmetros em `error.message`.
 * O erro do driver fica em `cause`, mas nem ele é confiável: mensagens de
 * constraint podem carregar valores, PII e tokens. Só SQLSTATE válido e uma
 * razão redigida saem daqui; o erro original nunca é ligado ao wrapper.
 */
function safeDatabaseCause(error: unknown): ErrorWithCauseAndCode {
  const chain = errorChain(error);
  const detail =
    [...chain]
      .reverse()
      .map(errorMessageOf)
      .find((message): message is string => message !== null) ??
    SAFE_DATABASE_REASON_FALLBACK;
  const code = sqlStateOf(chain);
  const reason = sanitizeDatabaseReason(detail, code);
  const safe = new Error(
    `${code === undefined ? "" : `[${code}] `}${reason}`,
  ) as ErrorWithCauseAndCode;

  safe.name = "DatabaseError";
  if (code !== undefined) safe.code = code;
  return safe;
}

export class ChangeEventBulkInsertError extends Error {
  readonly category = CHANGE_EVENT_INSERT_ERROR_CATEGORY;

  constructor(args: {
    batchNumber: number;
    batchCount: number;
    batchSize: number;
    cause: unknown;
  }) {
    const cause = safeDatabaseCause(args.cause);
    super(
      `${CHANGE_EVENT_INSERT_ERROR_CATEGORY}: failed to insert change events ` +
        `(batch ${args.batchNumber}/${args.batchCount}, ${args.batchSize} rows). ` +
        `Cause: ${cause.message}`,
      { cause },
    );
    this.name = "ChangeEventBulkInsertError";
  }
}

function toInsertRows(args: {
  events: readonly TrackingChangeEventDraft[];
  runId: string;
  versionIdByRef: ReadonlyMap<string, string>;
}): ChangeEventInsertRow[] {
  return args.events.map((event) => ({
    userId: event.userId,
    accountId: event.accountId,
    entityLevel: event.entityLevel,
    entityId: event.entityId,
    entityName: event.entityName,
    campaignId: event.campaignId,
    adsetId: event.adsetId,
    changeKind: event.changeKind,
    changedFields: event.changedFields,
    fromConfigVersionId: event.fromConfigVersionId,
    toConfigVersionId: event.toVersionRef
      ? (args.versionIdByRef.get(event.toVersionRef) ?? null)
      : null,
    source: event.source,
    occurredAt: event.occurredAt,
    detectedAt: event.detectedAt,
    detectionRunId: args.runId,
  }));
}

export async function insertChangeEvents(args: {
  events: readonly TrackingChangeEventDraft[];
  runId: string;
  versionIdByRef: ReadonlyMap<string, string>;
  writeBatch: ChangeEventBatchWriter;
}): Promise<number> {
  if (args.events.length === 0) return 0;

  let inserted = 0;
  const batchCount = Math.ceil(
    args.events.length / CHANGE_EVENT_INSERT_BATCH_SIZE,
  );

  for (
    let offset = 0;
    offset < args.events.length;
    offset += CHANGE_EVENT_INSERT_BATCH_SIZE
  ) {
    const events = args.events.slice(
      offset,
      offset + CHANGE_EVENT_INSERT_BATCH_SIZE,
    );
    const rows = toInsertRows({
      events,
      runId: args.runId,
      versionIdByRef: args.versionIdByRef,
    });

    try {
      await args.writeBatch(rows);
      // O writer é um INSERT plain. Statement bem-sucedido gravou o chunk
      // inteiro; qualquer falha lança e a transação externa desfaz os anteriores.
      inserted += rows.length;
    } catch (error) {
      throw new ChangeEventBulkInsertError({
        batchNumber: Math.floor(offset / CHANGE_EVENT_INSERT_BATCH_SIZE) + 1,
        batchCount,
        batchSize: rows.length,
        cause: error,
      });
    }
  }

  return inserted;
}
