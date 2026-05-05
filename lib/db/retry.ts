/**
 * Retry helper for transient database errors.
 *
 * postgres.js can surface stale-socket failures (EPIPE / ECONNRESET / ETIMEDOUT
 * / "socket has been ended by the other party") when the server-side TCP
 * connection has been closed but the client hasn't realized it yet. The next
 * query opens a fresh connection, so a single retry is usually enough to
 * recover transparently.
 */

const TRANSIENT_CODES = new Set(["EPIPE", "ECONNRESET", "ETIMEDOUT"]);

type ErrLike = {
  code?: string;
  message?: string;
  cause?: { code?: string; message?: string };
};

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as ErrLike;
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  if (e.cause?.code && TRANSIENT_CODES.has(e.cause.code)) return true;
  const message = e.message ?? "";
  if (/socket has been ended/i.test(message)) return true;
  if (/Connection terminated/i.test(message)) return true;
  const causeMessage = e.cause?.message ?? "";
  if (/socket has been ended/i.test(causeMessage)) return true;
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const { retries = 2, baseDelayMs = 100 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === retries) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(
        `[withRetry] Transient DB error on attempt ${attempt + 1}/${
          retries + 1
        } — retrying in ${delay}ms:`,
        (error as ErrLike).message ?? error,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
