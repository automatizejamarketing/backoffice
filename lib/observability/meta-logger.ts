import { getMetaLogContext } from "./meta-log-context";

export type MetaMutationEntity =
  | "campaign"
  | "adset"
  | "ad"
  | "adcreative"
  | "leadform"
  | "adimage"
  | "advideo"
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
const MAX_STACK_LENGTH = 2000;

function truncate(value: string, max = MAX_STRING_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}

function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max_depth]";

  const lowerKey = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lowerKey)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    if (LARGE_FIELD_KEYS.has(lowerKey)) {
      return truncate(value, 200);
    }
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item, i) => redactValue(String(i), item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }

  return value;
}

/** Redacts access_token / appsecret_proof from a full URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return url
      .replace(/access_token=[^&]+/gi, "access_token=[REDACTED]")
      .replace(/appsecret_proof=[^&]+/gi, "appsecret_proof=[REDACTED]");
  }
}

/** Sanitizes query strings, URLSearchParams, FormData, or plain objects. */
export function sanitizeMetaParams(
  params: string | URLSearchParams | FormData | Record<string, unknown> | undefined,
): Record<string, unknown> | string | undefined {
  if (params === undefined) return undefined;

  if (typeof params === "string") {
    const redacted = params
      .replace(/access_token=[^&]+/gi, "access_token=[REDACTED]")
      .replace(/appsecret_proof=[^&]+/gi, "appsecret_proof=[REDACTED]");
    return truncate(redacted);
  }

  if (params instanceof URLSearchParams) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? "[REDACTED]"
        : LARGE_FIELD_KEYS.has(key)
          ? truncate(value, 200)
          : truncate(value);
    }
    return out;
  }

  if (params instanceof FormData) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        out[key] = LARGE_FIELD_KEYS.has(key)
          ? truncate(value, 200)
          : truncate(value);
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
    if (upperMethod === "DELETE") return { entity: "campaign", operation: "delete" };
    if (path.endsWith("/campaigns")) return { entity: "campaign", operation: "create" };
    if (paramStr.includes("name=") && !paramStr.includes("status=")) {
      return { entity: "campaign", operation: "rename" };
    }
    return { entity: "campaign", operation: "update" };
  }
  if (path.endsWith("/adsets") || path.includes("/adsets")) {
    if (upperMethod === "DELETE") return { entity: "adset", operation: "delete" };
    if (path.endsWith("/adsets")) return { entity: "adset", operation: "create" };
    if (paramStr.includes("name=") && !paramStr.includes("status=") && !paramStr.includes("targeting")) {
      return { entity: "adset", operation: "rename" };
    }
    return { entity: "adset", operation: "update" };
  }
  if (path.endsWith("/adcreatives") || path.includes("/adcreatives")) {
    if (upperMethod === "DELETE") return { entity: "adcreative", operation: "delete" };
    if (path.endsWith("/adcreatives")) return { entity: "adcreative", operation: "create" };
    return { entity: "adcreative", operation: "update" };
  }
  if (path.endsWith("/ads") || path.includes("/ads")) {
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
    return { entity: "unknown", operation: "update" };
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
      blame_field_specs = (errorData as { blame_field_specs?: string[][] })
        ?.blame_field_specs;
    } catch {
      /* ignore */
    }
  }

  return {
    code: typeof err.code === "number" ? err.code : undefined,
    error_subcode:
      typeof err.error_subcode === "number" ? err.error_subcode : undefined,
    type: typeof err.type === "string" ? err.type : undefined,
    fbtrace_id: typeof err.fbtrace_id === "string" ? err.fbtrace_id : undefined,
    message: typeof err.message === "string" ? err.message : undefined,
    error_user_title:
      typeof err.error_user_title === "string" ? err.error_user_title : undefined,
    error_user_msg:
      typeof err.error_user_msg === "string" ? err.error_user_msg : undefined,
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
};

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

  return {
    evt: "meta_mutation",
    ts: new Date().toISOString(),
    level: input.phase === "error" ? "error" : "info",
    phase: input.phase,
    app: ctx?.app ?? "backoffice",
    correlationId: ctx?.correlationId,
    route: ctx?.route,
    operation: input.operation ?? ctx?.operationHint ?? classified.operation,
    entity: input.entity ?? ctx?.entityHint ?? classified.entity,
    entityId: input.entityId,
    parentIds: ctx?.parentIds,
    actor: ctx?.actor,
    meta: {
      method: input.method,
      endpoint,
      requestParams: sanitizeMetaParams(input.requestParams),
      httpStatus: input.httpStatus,
      durationMs: input.durationMs,
      ...(input.errorData
        ? { error: extractMetaErrorFields(input.errorData) }
        : {}),
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
  const classified = classifyMetaCall(
    input.method,
    input.endpoint,
    input.requestParams,
  );
  const payload = buildBasePayload(input, classified);
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
    route: ctx?.route,
    operation: ctx?.operationHint ?? "unknown",
    entity: ctx?.entityHint ?? "unknown",
    parentIds: ctx?.parentIds,
    actor: ctx?.actor,
    appError: serializeAppError(error),
  };

  emitLog(payload, "error");
}

function serializeAppError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const metaErr = error as Error & {
      metaError?: MetaApiErrorFields;
      level?: string;
    };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? truncate(error.stack, MAX_STACK_LENGTH) : undefined,
      ...(metaErr.metaError ? { metaError: metaErr.metaError } : {}),
      ...(metaErr.level ? { level: metaErr.level } : {}),
    };
  }
  return { message: String(error) };
}
