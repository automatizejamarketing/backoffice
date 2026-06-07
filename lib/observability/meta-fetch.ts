import { logMetaCallResult } from "./meta-logger";
import type { MetaMutationEntity, MetaMutationOperation } from "./meta-logger";

export type MetaFetchOptions = RequestInit & {
  requestParams?: string | URLSearchParams | FormData | Record<string, unknown>;
  entity?: MetaMutationEntity;
  operation?: MetaMutationOperation;
};

export type MetaFetchResult = {
  response: Response;
  data: unknown;
  durationMs: number;
};

/**
 * Wraps fetch to a Meta Graph endpoint with structured logging.
 * Parses JSON once and emits a meta_mutation log entry.
 */
export async function fetchMetaGraph(
  url: string,
  options: MetaFetchOptions = {},
): Promise<MetaFetchResult> {
  const { requestParams, entity, operation, ...init } = options;
  const startedAt = Date.now();
  const method = (init.method ?? "GET").toUpperCase();

  const response = await fetch(url, init);
  const durationMs = Date.now() - startedAt;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = { error: { message: "Failed to parse JSON response" } };
  }

  logMetaCallResult({
    method,
    endpoint: url.split("?")[0],
    requestParams,
    httpStatus: response.status,
    durationMs,
    data,
    entity,
    operation,
  });

  return { response, data, durationMs };
}
