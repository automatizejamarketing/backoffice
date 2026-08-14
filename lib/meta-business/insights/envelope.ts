/**
 * Structured tool envelope + Meta-error → kind mapping.
 *
 * Every marketing chatbot tool returns a JSON-serializable {@link ToolEnvelope}
 * instead of throwing, so the agent can turn failures into dialogue (system-prompt
 * rule 11). The `kind` is mapped from Meta's Graph API error codes via the existing
 * {@link errorToGraphErrorReturn} helper — we do NOT re-implement error parsing.
 *
 * Source of truth for codes: the `errorMap` in `lib/meta-business/error.ts`
 * (already aligned with the Marketing API v25.0 error reference).
 */
import {
  errorToGraphErrorReturn,
  isObjectUnavailableCode,
  type GraphErrorReturn,
} from "@/lib/meta-business/error";
import {
  isSameAccount,
  stripActPrefix,
} from "@/lib/meta-business/account-match";

export type ErrorKind =
  | "RATE_LIMIT"
  | "AUTH_EXPIRED"
  | "OVERSIZED"
  | "INVALID_PARAM"
  | "NOT_FOUND"
  | "UNKNOWN";

export type ToolError = {
  kind: ErrorKind;
  /** Whether a retry could succeed (rate limit / transient). */
  retryable: boolean;
  /** Concise pt-BR explanation the agent can relay to the user. */
  message: string;
  /** Meta's own user-facing message when present (error_user_msg). */
  metaMessage?: string;
  /** Server-suggested backoff (ms) parsed from rate-limit headers, when present. */
  retryAfterMs?: number;
};

export type ToolEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export const ok = <T>(data: T): ToolEnvelope<T> => ({ ok: true, data });
export const err = (error: ToolError): { ok: false; error: ToolError } => ({
  ok: false,
  error,
});

/**
 * Thrown by the insights client when an estimated query size exceeds the
 * synchronous ceiling, so the agent can negotiate a narrower cut (OVERSIZED).
 * Kept internal — never reaches the model as an exception, only as an envelope.
 */
export class OversizedError extends Error {
  constructor(message = "A consulta excede o limite síncrono.") {
    super(message);
    this.name = "OversizedError";
  }
}

/**
 * Thrown by a read tool when the object actually fetched belongs to a DIFFERENT
 * account than the conversation's (read-side ownership guard, ADR 0013). Account
 * ACCESS (ADR 0011) doesn't prove the object LIVES in the declared account, and
 * Meta resolves ids globally within the token — so reading a bare id from another
 * accessible account would leak its data. Maps to NOT_FOUND so the agent treats it
 * as "not in this account" and re-resolves via the account-scoped findObjects.
 */
export class CrossAccountObjectError extends Error {
  constructor(
    public readonly objectId: string,
    public readonly ownerAccountId: string,
    public readonly expectedAccountId: string,
  ) {
    super(
      `O objeto ${objectId} não pertence à conta ${stripActPrefix(expectedAccountId)}.`,
    );
    this.name = "CrossAccountObjectError";
  }
}

/**
 * Throw {@link CrossAccountObjectError} if a freshly-read object's `account_id`
 * doesn't match the conversation account. No-op when the owner is unknown
 * (can't disprove → allow) — never silently allow a PROVEN mismatch.
 */
export function assertObjectInAccount(
  objectId: string,
  ownerAccountId: string | null | undefined,
  expectedAccountId: string,
): void {
  if (!ownerAccountId) return;
  if (!isSameAccount(String(ownerAccountId), expectedAccountId)) {
    throw new CrossAccountObjectError(
      objectId,
      String(ownerAccountId),
      expectedAccountId,
    );
  }
}

/** Meta error codes that mean "back off and retry" (rate limit / temp block). Aligned with RETRYABLE_THROTTLE_CODES in duplicate.ts. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613, 80000, 80003, 80004, 80014, 1404078, 2859015]);
/** Meta error codes that mean "the user must reconnect their Meta account". */
const AUTH_CODES = new Set([102, 190]);
/** Meta error codes for malformed/invalid query parameters. */
const INVALID_PARAM_CODES = new Set([100, 2500, 2635]);

const KIND_MESSAGES: Record<ErrorKind, string> = {
  RATE_LIMIT:
    "A Meta limitou temporariamente as requisições. Posso tentar de novo em instantes.",
  AUTH_EXPIRED:
    "Sua conexão com a Meta expirou ou foi revogada. Reconecte sua conta Meta para continuar.",
  OVERSIZED:
    "Essa consulta é ampla demais para responder de uma vez. Posso restringir o período, o nível ou a quantidade de itens?",
  INVALID_PARAM:
    "Houve um parâmetro inválido nessa consulta. Posso ajustar e tentar de novo.",
  NOT_FOUND: "Não encontrei esse objeto na conta de anúncios.",
  UNKNOWN:
    "Tive um problema inesperado ao consultar a Meta. Podemos tentar de novo.",
};

function classify(errorReturn: GraphErrorReturn, raw: unknown): ErrorKind {
  if (raw instanceof OversizedError) return "OVERSIZED";
  // A cross-account read is reported as "not in this account" (ADR 0013).
  if (raw instanceof CrossAccountObjectError) return "NOT_FOUND";

  const code = errorReturn.data?.code;
  const status = errorReturn.statusCode;
  const message = (errorReturn.data?.message ?? "").toLowerCase();
  const name = raw instanceof Error ? raw.name : "";

  // Network/timeout aborts and Meta's "reduce the amount of data" hint → OVERSIZED.
  if (name === "AbortError" || name === "TimeoutError") return "OVERSIZED";
  if (message.includes("reduce the amount of data")) return "OVERSIZED";

  if (typeof code === "number") {
    if (RATE_LIMIT_CODES.has(code)) return "RATE_LIMIT";
    if (AUTH_CODES.has(code)) return "AUTH_EXPIRED";
    // 803 = "Some of the aliases you requested do not exist".
    if (code === 803) return "NOT_FOUND";
    // 100/33 is a 100 too, but it is not a bad parameter — the id simply does
    // not resolve for this token. Telling the agent INVALID_PARAM invited it to
    // "ajustar e tentar de novo" against an object that cannot come back, the
    // model-side twin of the UI loop in item B-02 of the Vercel report.
    if (isObjectUnavailableCode(code, errorReturn.data?.errorSubcode)) {
      return "NOT_FOUND";
    }
    if (INVALID_PARAM_CODES.has(code)) return "INVALID_PARAM";
  }

  if (status === 429) return "RATE_LIMIT";
  if (status === 401) return "AUTH_EXPIRED";
  if (status === 404) return "NOT_FOUND";
  if (
    message.includes("does not exist") ||
    message.includes("unsupported get request")
  ) {
    return "NOT_FOUND";
  }
  if (status === 400) return "INVALID_PARAM";

  return "UNKNOWN";
}

/**
 * Map any thrown error (GraphApiError or otherwise) into a {@link ToolError}.
 * Reuses `errorToGraphErrorReturn` so the code/subcode mapping stays in one place.
 */
export function mapErrorKind(error: unknown): ToolError {
  if (error instanceof Error && error.name === "AccountNotAccessibleError") {
    return {
      kind: "INVALID_PARAM",
      retryable: false,
      message: error.message,
    };
  }

  const errorReturn = errorToGraphErrorReturn(error);
  const kind = classify(errorReturn, error);

  const retryable =
    kind === "RATE_LIMIT" ||
    (kind === "OVERSIZED" ? false : errorReturn.reason.isTransient);

  return {
    kind,
    retryable,
    message: KIND_MESSAGES[kind],
    ...(errorReturn.data?.errorUserMsg
      ? { metaMessage: errorReturn.data.errorUserMsg }
      : {}),
    ...(errorReturn.rateLimit?.retryAfterMs != null
      ? { retryAfterMs: errorReturn.rateLimit.retryAfterMs }
      : errorReturn.rateLimit?.estimatedRegainMs != null
        ? { retryAfterMs: errorReturn.rateLimit.estimatedRegainMs }
        : {}),
  };
}
