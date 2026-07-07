import "server-only";
import Stripe from "stripe";

/**
 * Structured, sanitized logging for Stripe-touching API routes — the sibling of
 * {@link ./meta-logger}, focused on Stripe operations.
 *
 * Emits one JSON line per event (`evt: "stripe_op"`) with a per-request
 * `correlationId`, the operation, the acting admin, timing, and — on failure —
 * the extracted Stripe error fields (type / code / statusCode / requestId /
 * param / message). This turns the previous opaque
 * `console.error("Error approving affiliate:", error)` into a greppable,
 * correlatable trace, so a failed Stripe call can be diagnosed straight from the
 * server logs.
 *
 * Secrets (api keys, tokens, client secrets, passwords) are redacted and long
 * strings truncated before anything is logged.
 */

const SENSITIVE_KEY_HINTS = [
  "secret",
  "client_secret",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "access_token",
  "token",
];

const MAX_STRING_LENGTH = 500;
const MAX_STACK_LENGTH = 2000;

function truncate(value: string, max = MAX_STRING_LENGTH): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated]`;
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_HINTS.some((hint) => lower.includes(hint));
}

function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max_depth]";
  if (isSensitiveKey(key)) return "[REDACTED]";

  if (typeof value === "string") return truncate(value);

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

/** Redacts sensitive keys and truncates long strings from a plain object. */
export function sanitize(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return redactValue("root", data) as Record<string, unknown>;
}

export type StripeErrorFields = {
  /** Stripe error class, e.g. "StripeInvalidRequestError", "StripeCardError". */
  type?: string;
  /** Machine code, e.g. "resource_missing", "coupon_expired", "code_already_exists". */
  code?: string;
  /** Card decline reason (card errors only). */
  declineCode?: string;
  /** HTTP status Stripe returned. */
  statusCode?: number;
  /** Stripe request id (give this to Stripe support / find it in the Dashboard). */
  requestId?: string;
  /** The offending request parameter, when Stripe reports one. */
  param?: string;
  message?: string;
};

export function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError;
}

/** Pulls the debuggable fields out of a Stripe SDK error; undefined if not one. */
export function extractStripeError(error: unknown): StripeErrorFields | undefined {
  if (!isStripeError(error)) return undefined;
  const e = error as Stripe.errors.StripeError & { decline_code?: string };
  return {
    type: e.type,
    code: e.code,
    declineCode: e.decline_code,
    statusCode: e.statusCode,
    requestId: e.requestId,
    param: e.param,
    message: e.message,
  };
}

function serializeAppError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? truncate(error.stack, MAX_STACK_LENGTH) : undefined,
    };
  }
  return { message: String(error) };
}

function emit(payload: Record<string, unknown>, level: "info" | "error"): void {
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export type StripeLogActor = {
  id?: string;
  email?: string;
  role?: string;
};

export type StripeLoggerInit = {
  /** Route path, e.g. "/api/affiliates/approve". */
  route: string;
  /** Logical operation, e.g. "affiliate.approve". */
  op: string;
  actor?: StripeLogActor;
  /** Reuse an existing correlationId; a fresh one is generated otherwise. */
  correlationId?: string;
};

export type StripeLogger = {
  correlationId: string;
  /** A named checkpoint inside the handler (validation, db read, stripe call…). */
  step: (step: string, data?: Record<string, unknown>) => void;
  /** Terminal success. */
  success: (data?: Record<string, unknown>) => void;
  /**
   * Terminal failure. Logs the extracted Stripe error (or a serialized app
   * error) and RETURNS the Stripe fields so the caller can shape a better
   * HTTP response (code/message/correlationId).
   */
  error: (error: unknown, data?: Record<string, unknown>) => StripeErrorFields | undefined;
};

/**
 * Creates a per-request logger and immediately emits a `start` event. Create it
 * AFTER authorization so unauthenticated noise is not logged.
 */
export function createStripeLogger(init: StripeLoggerInit): StripeLogger {
  const correlationId = init.correlationId ?? crypto.randomUUID();
  const startedAt = Date.now();

  const base = (phase: string): Record<string, unknown> => ({
    evt: "stripe_op",
    ts: new Date().toISOString(),
    app: "backoffice",
    phase,
    route: init.route,
    op: init.op,
    correlationId,
    actor: init.actor,
  });

  emit({ ...base("start"), level: "info" }, "info");

  return {
    correlationId,
    step(step, data) {
      emit(
        { ...base("step"), level: "info", step, data: sanitize(data) },
        "info",
      );
    },
    success(data) {
      emit(
        {
          ...base("success"),
          level: "info",
          durationMs: Date.now() - startedAt,
          data: sanitize(data),
        },
        "info",
      );
    },
    error(error, data) {
      const stripeError = extractStripeError(error);
      emit(
        {
          ...base("error"),
          level: "error",
          durationMs: Date.now() - startedAt,
          data: sanitize(data),
          ...(stripeError
            ? { stripeError }
            : { appError: serializeAppError(error) }),
        },
        "error",
      );
      return stripeError;
    },
  };
}
