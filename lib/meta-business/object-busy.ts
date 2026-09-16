import { GraphApiError, parseGraphError, parseRateLimitHeaders } from "./error";

/** Confirmed by the production Graph response, distinct from app/account quotas. */
export const OBJECT_BUSY_SUBCODE = 4841018;
export const OBJECT_BUSY_WINDOW_MS = 30_000;
export const OBJECT_BUSY_MARGIN_MS = 3_000;
const MAX_BUSY_RETRIES = 2;
const MAX_BUSY_WAIT_MS = 70_000;

export function isObjectBusyCode(code?: number, subcode?: number): boolean {
  return code === 613 && subcode === OBJECT_BUSY_SUBCODE;
}

export function isObjectBusyError(error: unknown): error is GraphApiError {
  return error instanceof GraphApiError && isObjectBusyCode(
    error.errorReturn.data?.code,
    error.errorReturn.data?.errorSubcode,
  );
}

// Prevent an enclosing metaWrite/duplication retry from starting a second budget.
const exhaustedErrors = new WeakSet<GraphApiError>();
export function objectBusyRetryExhausted(error: unknown): boolean {
  return error instanceof GraphApiError && exhaustedErrors.has(error);
}

/** Retry only an explicit Meta rejection; never replay a timeout, HTML, or 5xx. */
export async function withObjectBusyRetry<T>(
  write: () => Promise<T>,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!isObjectBusyError(error) || objectBusyRetryExhausted(error)) throw error;
      const timing = error.errorReturn.rateLimit;
      const waitMs = Math.max(
        OBJECT_BUSY_WINDOW_MS + OBJECT_BUSY_MARGIN_MS + Math.floor(Math.random() * 1_000),
        timing?.retryAfterMs ?? 0,
        timing?.estimatedRegainMs ?? 0,
      );
      if (attempt >= MAX_BUSY_RETRIES || waitedMs + waitMs > MAX_BUSY_WAIT_MS) {
        exhaustedErrors.add(error);
        throw error;
      }
      await sleep(waitMs);
      waitedMs += waitMs;
    }
  }
}

/** Keep fetchMetaGraph's response contract, including its final rejection. */
export async function withObjectBusyResponseRetry<T extends { response: Response; data: unknown }>(
  write: () => Promise<T>,
): Promise<T> {
  let lastResult: T | undefined;
  let lastError: GraphApiError | undefined;
  try {
    return await withObjectBusyRetry(async () => {
      const result = await write();
      const error = (result.data as { error?: { code?: number; error_subcode?: number } } | null)?.error;
      if (!isObjectBusyCode(error?.code, error?.error_subcode)) return result;
      lastResult = result;
      lastError = new GraphApiError({
        ...parseGraphError(result.data),
        rateLimit: parseRateLimitHeaders(result.response.headers),
      });
      throw lastError;
    });
  } catch (error) {
    if (error === lastError && lastResult) return lastResult;
    throw error;
  }
}
