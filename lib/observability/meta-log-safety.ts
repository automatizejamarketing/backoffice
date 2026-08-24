import { createHmac } from "node:crypto";

export type TrackingIssueCategory =
  | "customer_action_required"
  | "external_transient"
  | "degraded_component"
  | "internal_failure";

export type SafeErrorSummary = {
  name: string;
  message: string;
  code?: number | string;
  subcode?: number;
  traceId?: string;
  isTransient?: boolean;
  stack?: string;
  cause?: {
    name: string;
    message: string;
    code?: number | string;
  };
};

const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ERROR_STACK_LENGTH = 2_000;
const MAX_CAUSE_MESSAGE_LENGTH = 500;
const TOKEN_ERROR_CODES = new Set([102, 190]);
const TRANSIENT_GRAPH_CODES = new Set([
  1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004, 80014,
]);

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const marker = "…[truncated]";
  return `${value.slice(0, Math.max(0, maxLength - marker.length))}${marker}`;
}

export function pseudonymizeMetaIdentifier(
  kind: string,
  value: string,
): string {
  const key =
    process.env.META_LOG_PSEUDONYM_KEY ??
    process.env.META_GENERAL_APP_SECRET ??
    "automatize-meta-log-v1";
  const digest = createHmac("sha256", key)
    .update(`${kind}:${value}`)
    .digest("hex")
    .slice(0, 12);
  return `${kind}-${digest}`;
}

/**
 * Sanitiza texto livre antes de log/persistência. O prefixo processado é
 * deliberadamente limitado: mensagens de ORM podem carregar megabytes de SQL
 * e parâmetros, e nada depois do limite será emitido.
 */
export function sanitizeMetaLogText(
  value: string,
  maxLength = MAX_ERROR_MESSAGE_LENGTH,
): string {
  const inspectionLimit = Math.max(maxLength * 4, maxLength);
  const inspected = value.slice(0, inspectionLimit);
  const sanitized = inspected
    .replace(
      /\bBearer\s+[^\s"',}\]]+/gi,
      "Bearer [REDACTED_TOKEN]",
    )
    .replace(
      /((?:access_token|appsecret_proof|authorization|client_secret|password)["']?\s*(?:=|:)\s*["']?)[^&\s"',}\]]+/gi,
      "$1[REDACTED_TOKEN]",
    )
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(/\bact_\d+\b/gi, (match) =>
      pseudonymizeMetaIdentifier("account", match),
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      (match) => pseudonymizeMetaIdentifier("id", match),
    )
    .replace(/\b\d{8,}\b/g, (match) =>
      pseudonymizeMetaIdentifier("id", match),
    );

  return truncate(
    value.length > inspectionLimit
      ? `${sanitized}…[source-truncated]`
      : sanitized,
    maxLength,
  );
}

type ErrorRecord = Record<string, unknown> & {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  code?: unknown;
  subcode?: unknown;
  cause?: unknown;
  errorReturn?: {
    reason?: { isTransient?: unknown };
    data?: {
      code?: unknown;
      errorSubcode?: unknown;
      error_subcode?: unknown;
      fbtraceId?: unknown;
      fbtrace_id?: unknown;
    };
  };
};

function asErrorRecord(error: unknown): ErrorRecord | undefined {
  return typeof error === "object" && error !== null
    ? (error as ErrorRecord)
    : undefined;
}

function graphFieldsOf(error: unknown): {
  code?: number | string;
  subcode?: number;
  traceId?: string;
  isTransient?: boolean;
} {
  const record = asErrorRecord(error);
  const data = record?.errorReturn?.data;
  const rawCode = data?.code ?? record?.code;
  const rawSubcode =
    data?.errorSubcode ?? data?.error_subcode ?? record?.subcode;
  const rawTraceId = data?.fbtraceId ?? data?.fbtrace_id;
  const rawTransient = record?.errorReturn?.reason?.isTransient;

  return {
    code:
      typeof rawCode === "number" || typeof rawCode === "string"
        ? rawCode
        : undefined,
    subcode: typeof rawSubcode === "number" ? rawSubcode : undefined,
    traceId:
      typeof rawTraceId === "string"
        ? sanitizeMetaLogText(rawTraceId, 128)
        : undefined,
    isTransient:
      typeof rawTransient === "boolean" ? rawTransient : undefined,
  };
}

function causeSummaryOf(
  cause: unknown,
): SafeErrorSummary["cause"] | undefined {
  const record = asErrorRecord(cause);
  if (!record && cause === undefined) return undefined;

  const code = record?.code;
  return {
    name:
      typeof record?.name === "string"
        ? sanitizeMetaLogText(record.name, 80)
        : "Error",
    message: sanitizeMetaLogText(
      typeof record?.message === "string"
        ? record.message
        : String(cause),
      MAX_CAUSE_MESSAGE_LENGTH,
    ),
    ...(typeof code === "number" || typeof code === "string" ? { code } : {}),
  };
}

export function safeErrorSummary(
  error: unknown,
  fallback = "Erro desconhecido",
): SafeErrorSummary {
  const record = asErrorRecord(error);
  const graph = graphFieldsOf(error);
  const message =
    typeof record?.message === "string" && record.message
      ? record.message
      : typeof error === "string" && error
        ? error
        : fallback;

  return {
    name:
      typeof record?.name === "string"
        ? sanitizeMetaLogText(record.name, 80)
        : "Error",
    message: sanitizeMetaLogText(message, MAX_ERROR_MESSAGE_LENGTH),
    ...graph,
    ...(typeof record?.stack === "string"
      ? {
          stack: sanitizeMetaLogText(
            record.stack,
            MAX_ERROR_STACK_LENGTH,
          ),
        }
      : {}),
    ...(record?.cause !== undefined
      ? { cause: causeSummaryOf(record.cause) }
      : {}),
  };
}

export function safeErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const summary = safeErrorSummary(error, fallback);
  const details: string[] = [];
  if (summary.code !== undefined) details.push(`code=${summary.code}`);
  if (summary.subcode !== undefined) details.push(`subcode=${summary.subcode}`);
  if (summary.cause) {
    const causeCode =
      summary.cause.code === undefined ? "" : `${summary.cause.code}:`;
    details.push(
      `cause=${causeCode}${truncate(summary.cause.message, 200)}`,
    );
  }
  if (details.length === 0) return summary.message;

  const suffix = ` [${details.join(" ")}]`;
  return `${truncate(
    summary.message,
    MAX_ERROR_MESSAGE_LENGTH - suffix.length,
  )}${suffix}`;
}

export function classifyTrackingIssue(
  error: unknown,
  fallback?: TrackingIssueCategory,
): TrackingIssueCategory {
  if (fallback === "degraded_component") return fallback;

  const { code, isTransient } = graphFieldsOf(error);
  const numericCode =
    typeof code === "number"
      ? code
      : typeof code === "string" && /^\d+$/.test(code)
        ? Number(code)
        : undefined;

  if (numericCode !== undefined && TOKEN_ERROR_CODES.has(numericCode)) {
    return "customer_action_required";
  }
  if (
    isTransient === true ||
    (numericCode !== undefined && TRANSIENT_GRAPH_CODES.has(numericCode))
  ) {
    return "external_transient";
  }
  if (numericCode !== undefined) return "internal_failure";

  return fallback ?? "internal_failure";
}
