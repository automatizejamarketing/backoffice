import { getMetaLogContext } from "./meta-log-context";
import {
  classifyTrackingIssue,
  pseudonymizeMetaIdentifier,
  safeErrorSummary,
  sanitizeMetaLogText,
  type TrackingIssueCategory,
} from "./meta-log-safety";

export type MetaMutationEntity =
  | "campaign"
  | "adset"
  | "ad"
  | "adcreative"
  | "leadform"
  | "adimage"
  | "advideo"
  | "adaccount"
  | "activity"
  | "insights_report"
  | "unknown";

export type MetaMutationOperation =
  | "create"
  | "update"
  | "delete"
  | "duplicate"
  | "rename"
  | "publish"
  | "pause"
  | "activate"
  | "status"
  | "upload"
  | "read"
  | "list"
  | "insights"
  | "activities"
  | "unknown";

export type MetaApiErrorFields = {
  code?: number;
  error_subcode?: number;
  type?: string;
  fbtrace_id?: string;
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  blame_field_specs?: string[][];
  is_transient?: boolean;
};

const SENSITIVE_KEYS = new Set([
  "access_token",
  "appsecret_proof",
  "authorization",
  "client_secret",
  "password",
]);

const LARGE_FIELD_KEYS = new Set([
  "asset_feed_spec",
  "object_story_spec",
  "targeting",
  "adset_schedule",
  "promoted_object",
]);

const MAX_STRING_LENGTH = 500;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    SENSITIVE_KEYS.has(key.toLowerCase()) ||
    normalized === "accesstoken" ||
    normalized === "appsecretproof" ||
    normalized === "authorization" ||
    normalized === "clientsecret" ||
    normalized === "password"
  );
}

function isEmailKey(key: string): boolean {
  return normalizedKey(key).endsWith("email");
}

function isIdentifierKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (
    normalized === "runid" ||
    normalized === "correlationid" ||
    normalized === "fbtraceid" ||
    normalized === "traceid"
  ) {
    return false;
  }
  return normalized === "id" || normalized.endsWith("id") || normalized.endsWith("ids");
}

function identifierKind(key: string): string {
  const normalized = normalizedKey(key);
  if (normalized.includes("account")) return "account";
  if (normalized.includes("user") || normalized.includes("actor")) return "user";
  if (normalized.includes("campaign")) return "campaign";
  if (normalized.includes("adset")) return "adset";
  if (normalized.includes("creative")) return "creative";
  if (normalized.includes("ad")) return "ad";
  return "entity";
}

function sanitizeStringValue(key: string, value: string): string {
  if (isSensitiveKey(key)) return "[REDACTED_TOKEN]";
  if (isEmailKey(key)) return "[REDACTED_EMAIL]";
  if (isIdentifierKey(key)) {
    return pseudonymizeMetaIdentifier(identifierKind(key), value);
  }
  return sanitizeMetaLogText(
    value,
    LARGE_FIELD_KEYS.has(key.toLowerCase()) ? 200 : MAX_STRING_LENGTH,
  );
}

function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max_depth]";

  if (isSensitiveKey(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return sanitizeStringValue(key, value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(key, item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, 50)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    if (entries.length > 50) out.__truncatedKeys = entries.length - 50;
    return out;
  }

  return value;
}

/** Redacts access_token / appsecret_proof from a full URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      const value = parsed.searchParams.get(key) ?? "";
      parsed.searchParams.set(key, sanitizeStringValue(key, value));
    }
    parsed.pathname = parsed.pathname
      .split("/")
      .map((segment) => sanitizeMetaLogText(segment, 200))
      .join("/");
    return parsed.toString();
  } catch {
    return sanitizeMetaLogText(
      url
      .replace(/access_token=[^&]+/gi, "access_token=[REDACTED]")
        .replace(/appsecret_proof=[^&]+/gi, "appsecret_proof=[REDACTED]"),
      1_000,
    );
  }
}

/** Sanitizes query strings, URLSearchParams, FormData, or plain objects. */
export function sanitizeMetaParams(
  params: string | URLSearchParams | FormData | Record<string, unknown> | undefined,
): Record<string, unknown> | string | undefined {
  if (params === undefined) return undefined;

  if (typeof params === "string") {
    if (params.includes("=")) {
      const parsed = new URLSearchParams(params);
      const out: Record<string, unknown> = {};
      for (const [key, value] of parsed.entries()) {
        out[key] = sanitizeStringValue(key, value);
      }
      return out;
    }
    return sanitizeMetaLogText(params, MAX_STRING_LENGTH);
  }

  if (params instanceof URLSearchParams) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      out[key] = sanitizeStringValue(key, value);
    }
    return out;
  }

  if (params instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (isSensitiveKey(key)) {
        out[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        out[key] = sanitizeStringValue(key, value);
      } else {
        out[key] = "[binary]";
      }
    }
    return out;
  }

  return redactValue("root", params) as Record<string, unknown>;
}

function extractNumericId(path: string): string | undefined {
  const match = path.match(/\/(\d+)(?:\/|$|\?)/);
  return match?.[1];
}

/** Infers entity + operation from Graph API endpoint and HTTP method. */
export function classifyMetaCall(
  method: string,
  endpoint: string,
  params?: string | URLSearchParams | FormData | Record<string, unknown>,
): { entity: MetaMutationEntity; operation: MetaMutationOperation } {
  const path = endpoint.replace(/^https?:\/\/[^/]+\/v[\d.]+\//, "").split("?")[0];
  const upperMethod = method.toUpperCase();
  const paramStr =
    typeof params === "string"
      ? params
      : params instanceof URLSearchParams
        ? params.toString()
        : params instanceof FormData
          ? [...params.entries()]
              .map(([k]) => k)
              .join("&")
          : JSON.stringify(params ?? {});
  const query =
    typeof params === "string"
      ? new URLSearchParams(params)
      : params instanceof URLSearchParams
        ? params
        : undefined;

  if (path.includes("/activities")) {
    return { entity: "adaccount", operation: "activities" };
  }
  if (path.includes("/insights")) {
    const level = query?.get("level");
    const entity: MetaMutationEntity =
      level === "campaign" || level === "adset" || level === "ad"
        ? level
        : "insights_report";
    return { entity, operation: "insights" };
  }
  if (path.includes("/assigned_ad_accounts") || path.includes("/adaccounts")) {
    return { entity: "adaccount", operation: "list" };
  }

  if (path.includes("/adimages")) {
    return { entity: "adimage", operation: "upload" };
  }
  if (path.includes("/advideos")) {
    return { entity: "advideo", operation: "upload" };
  }
  if (path.includes("/leadgen_forms")) {
    return { entity: "leadform", operation: upperMethod === "DELETE" ? "delete" : "create" };
  }
  if (path.endsWith("/copies") || path.includes("/copies")) {
    if (path.includes("/adsets/") || path.match(/\/\d+\/copies/)) {
      const entity: MetaMutationEntity = path.includes("/ads/")
        ? "ad"
        : path.includes("/adsets/")
          ? "adset"
          : "campaign";
      return { entity, operation: "duplicate" };
    }
    return { entity: "unknown", operation: "duplicate" };
  }
  if (path.endsWith("/campaigns") || path.includes("/campaigns")) {
    if (upperMethod === "GET") return { entity: "campaign", operation: "list" };
    if (upperMethod === "DELETE") return { entity: "campaign", operation: "delete" };
    if (path.endsWith("/campaigns")) return { entity: "campaign", operation: "create" };
    if (paramStr.includes("name=") && !paramStr.includes("status=")) {
      return { entity: "campaign", operation: "rename" };
    }
    return { entity: "campaign", operation: "update" };
  }
  if (path.endsWith("/adsets") || path.includes("/adsets")) {
    if (upperMethod === "GET") return { entity: "adset", operation: "list" };
    if (upperMethod === "DELETE") return { entity: "adset", operation: "delete" };
    if (path.endsWith("/adsets")) return { entity: "adset", operation: "create" };
    if (paramStr.includes("name=") && !paramStr.includes("status=") && !paramStr.includes("targeting")) {
      return { entity: "adset", operation: "rename" };
    }
    return { entity: "adset", operation: "update" };
  }
  if (path.endsWith("/adcreatives") || path.includes("/adcreatives")) {
    if (upperMethod === "GET") return { entity: "adcreative", operation: "read" };
    if (upperMethod === "DELETE") return { entity: "adcreative", operation: "delete" };
    if (path.endsWith("/adcreatives")) return { entity: "adcreative", operation: "create" };
    return { entity: "adcreative", operation: "update" };
  }
  if (path.endsWith("/ads") || path.includes("/ads")) {
    if (upperMethod === "GET") return { entity: "ad", operation: "list" };
    if (upperMethod === "DELETE") return { entity: "ad", operation: "delete" };
    if (path.endsWith("/ads")) return { entity: "ad", operation: "create" };
    if (paramStr.includes("name=") && !paramStr.includes("status=") && !paramStr.includes("creative")) {
      return { entity: "ad", operation: "rename" };
    }
    if (paramStr.includes("status=PAUSED")) return { entity: "ad", operation: "pause" };
    if (paramStr.includes("status=ACTIVE")) return { entity: "ad", operation: "activate" };
    return { entity: "ad", operation: "update" };
  }

  if (upperMethod === "DELETE") {
    return { entity: "unknown", operation: "delete" };
  }
  if (paramStr.includes("status=PAUSED")) {
    return { entity: "unknown", operation: "pause" };
  }
  if (paramStr.includes("status=ACTIVE")) {
    return { entity: "unknown", operation: "activate" };
  }
  if (extractNumericId(path)) {
    return {
      entity: "unknown",
      operation: upperMethod === "GET" ? "read" : "update",
    };
  }

  return { entity: "unknown", operation: "unknown" };
}

export function extractMetaErrorFields(data: unknown): MetaApiErrorFields | undefined {
  if (!data || typeof data !== "object") return undefined;
  const root = data as Record<string, unknown>;
  const err =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;

  if (!err.message && err.code === undefined) return undefined;

  let blame_field_specs: string[][] | undefined;
  if (err.error_data) {
    try {
      const errorData =
        typeof err.error_data === "string"
          ? JSON.parse(err.error_data)
          : err.error_data;
      const raw = (errorData as { blame_field_specs?: unknown })
        ?.blame_field_specs;
      if (Array.isArray(raw)) {
        blame_field_specs = raw.slice(0, 10).map((spec) =>
          Array.isArray(spec)
            ? spec
                .slice(0, 10)
                .filter((field): field is string => typeof field === "string")
                .map((field) => sanitizeMetaLogText(field, 100))
            : [],
        );
      }
    } catch {
      /* ignore */
    }
  }

  return {
    code: typeof err.code === "number" ? err.code : undefined,
    error_subcode:
      typeof err.error_subcode === "number" ? err.error_subcode : undefined,
    type:
      typeof err.type === "string"
        ? sanitizeMetaLogText(err.type, 100)
        : undefined,
    fbtrace_id:
      typeof err.fbtrace_id === "string"
        ? sanitizeMetaLogText(err.fbtrace_id, 128)
        : undefined,
    message:
      typeof err.message === "string"
        ? sanitizeMetaLogText(err.message, MAX_STRING_LENGTH)
        : undefined,
    error_user_title:
      typeof err.error_user_title === "string"
        ? sanitizeMetaLogText(err.error_user_title, 200)
        : undefined,
    error_user_msg:
      typeof err.error_user_msg === "string"
        ? sanitizeMetaLogText(err.error_user_msg, MAX_STRING_LENGTH)
        : undefined,
    blame_field_specs,
    is_transient:
      typeof err.is_transient === "boolean" ? err.is_transient : undefined,
  };
}

type LogMetaCallInput = {
  phase: "start" | "success" | "error";
  method: string;
  endpoint: string;
  requestParams?: string | URLSearchParams | FormData | Record<string, unknown>;
  httpStatus?: number;
  durationMs?: number;
  responseData?: unknown;
  errorData?: unknown;
  entityId?: string;
  operation?: MetaMutationOperation;
  entity?: MetaMutationEntity;
  category?: TrackingIssueCategory;
  /** Primeiro sucesso por operação/entidade e depois um a cada 25. */
  sampleSuccess?: boolean;
};

const SUCCESS_SAMPLE_INTERVAL = 25;
const MAX_SUCCESS_SAMPLE_KEYS = 512;
const successSampleOrdinals = new Map<string, number>();

function sampledSuccessOrdinal(
  classified: { entity: MetaMutationEntity; operation: MetaMutationOperation },
): number | undefined {
  const ctx = getMetaLogContext();
  const key = [
    ctx?.runId ?? ctx?.correlationId ?? "unscoped",
    classified.operation,
    classified.entity,
  ].join(":");
  if (
    !successSampleOrdinals.has(key) &&
    successSampleOrdinals.size >= MAX_SUCCESS_SAMPLE_KEYS
  ) {
    successSampleOrdinals.clear();
  }
  const ordinal = (successSampleOrdinals.get(key) ?? 0) + 1;
  successSampleOrdinals.set(key, ordinal);
  return ordinal === 1 || ordinal % SUCCESS_SAMPLE_INTERVAL === 0
    ? ordinal
    : undefined;
}

function emitLog(payload: Record<string, unknown>, level: "info" | "error"): void {
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function buildBasePayload(
  input: Partial<LogMetaCallInput>,
  classified: { entity: MetaMutationEntity; operation: MetaMutationOperation },
): Record<string, unknown> {
  const ctx = getMetaLogContext();
  const endpoint = redactUrl(input.endpoint ?? "");
  const errorFields = input.errorData
    ? extractMetaErrorFields(input.errorData)
    : undefined;
  const category =
    input.category ??
    (input.phase === "error"
      ? classifyTrackingIssue({
          code: errorFields?.code,
          errorReturn: {
            reason: { isTransient: errorFields?.is_transient },
            data: {
              code: errorFields?.code,
              errorSubcode: errorFields?.error_subcode,
              fbtraceId: errorFields?.fbtrace_id,
            },
          },
        })
      : undefined);

  return {
    evt: "meta_mutation",
    ts: new Date().toISOString(),
    level: input.phase === "error" ? "error" : "info",
    phase: input.phase,
    app: ctx?.app ?? "backoffice",
    correlationId: ctx?.correlationId,
    runId: ctx?.runId,
    route: ctx?.route,
    operation: input.operation ?? ctx?.operationHint ?? classified.operation,
    entity: input.entity ?? ctx?.entityHint ?? classified.entity,
    entityId: redactValue("entityId", input.entityId),
    parentIds: redactValue("parentIds", ctx?.parentIds),
    actor: redactValue("actor", ctx?.actor),
    category,
    traceId: errorFields?.fbtrace_id,
    meta: {
      method: input.method,
      endpoint,
      requestParams: sanitizeMetaParams(input.requestParams),
      httpStatus: input.httpStatus,
      durationMs: input.durationMs,
      ...(errorFields ? { error: errorFields } : {}),
      ...(input.phase === "success" && input.responseData
        ? {
            responseSummary: redactValue("response", input.responseData) as Record<
              string,
              unknown
            >,
          }
        : {}),
    },
  };
}

export function logMetaCall(input: LogMetaCallInput): void {
  const inferred = classifyMetaCall(
    input.method,
    input.endpoint,
    input.requestParams,
  );
  const ctx = getMetaLogContext();
  const classified = {
    operation:
      input.operation ??
      (ctx?.operationHint as MetaMutationOperation | undefined) ??
      inferred.operation,
    entity:
      input.entity ??
      (ctx?.entityHint as MetaMutationEntity | undefined) ??
      inferred.entity,
  };
  const ordinal =
    input.phase === "success" && input.sampleSuccess
      ? sampledSuccessOrdinal(classified)
      : undefined;
  if (input.phase === "success" && input.sampleSuccess && ordinal === undefined) {
    return;
  }
  const payload = buildBasePayload(input, classified);
  if (ordinal !== undefined) {
    (payload.meta as Record<string, unknown>).successSampleOrdinal = ordinal;
  }
  emitLog(payload, input.phase === "error" ? "error" : "info");
}

/** Convenience for raw fetch sites that already parsed the response body. */
export function logMetaCallResult(params: {
  method: string;
  endpoint: string;
  requestParams?: string | URLSearchParams | FormData | Record<string, unknown>;
  httpStatus: number;
  durationMs: number;
  data: unknown;
  entityId?: string;
  operation?: MetaMutationOperation;
  entity?: MetaMutationEntity;
}): void {
  const ok =
    params.httpStatus >= 200 &&
    params.httpStatus < 300 &&
    !(params.data &&
      typeof params.data === "object" &&
      "error" in (params.data as object));

  logMetaCall({
    phase: ok ? "success" : "error",
    method: params.method,
    endpoint: params.endpoint,
    requestParams: params.requestParams,
    httpStatus: params.httpStatus,
    durationMs: params.durationMs,
    responseData: ok ? params.data : undefined,
    errorData: ok ? undefined : params.data,
    entityId: params.entityId ?? extractEntityIdFromResponse(params.data),
    operation: params.operation,
    entity: params.entity,
  });
}

function extractEntityIdFromResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const id = (data as { id?: string }).id;
  return typeof id === "string" ? id : undefined;
}

export function logMetaMutationError(error: unknown): void {
  const ctx = getMetaLogContext();
  const payload: Record<string, unknown> = {
    evt: "meta_mutation",
    ts: new Date().toISOString(),
    level: "error",
    phase: "error",
    app: ctx?.app ?? "backoffice",
    correlationId: ctx?.correlationId,
    runId: ctx?.runId,
    route: ctx?.route,
    operation: ctx?.operationHint ?? "unknown",
    entity: ctx?.entityHint ?? "unknown",
    parentIds: redactValue("parentIds", ctx?.parentIds),
    actor: redactValue("actor", ctx?.actor),
    category: classifyTrackingIssue(error),
    appError: serializeAppError(error),
  };

  emitLog(payload, "error");
}

function serializeAppError(error: unknown): Record<string, unknown> {
  return { ...safeErrorSummary(error) };
}
