export type VindiKeyKind = "private" | "public";

export type VindiErrorItem = {
  id: string;
  parameter?: string;
  message: string;
};

export class VindiApiError extends Error {
  readonly status: number;
  readonly errors: VindiErrorItem[];

  constructor(status: number, errors: VindiErrorItem[]) {
    const first = errors[0];
    super(
      first
        ? `${first.id}: ${first.message}`
        : `Vindi request failed (${status})`,
    );
    this.name = "VindiApiError";
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Vindi 422 "já está em uso". O ÚNICO campo único por empresa é `code` —
 * medido contra a API de produção em 2026-09-01: `email` e `registry_code`
 * aceitam duplicata tanto no POST quanto no PUT (ADR 0029 no frontend).
 */
export function isVindiAlreadyInUseError(error: unknown): boolean {
  if (!(error instanceof VindiApiError) || error.status !== 422) {
    return false;
  }
  return error.errors.some(
    (item) =>
      item.id === "invalid_parameter" && /já está em uso/i.test(item.message),
  );
}

export type VindiRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

export type VindiClient = {
  request<T>(input: VindiRequest): Promise<T>;
};

export type CreateVindiClientOptions = {
  keyKind: VindiKeyKind;
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_429_RETRIES = 3;

function encodeBasicAuth(apiKey: string): string {
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function isPublicPath(path: string): boolean {
  return path === "/v1/public" || path.startsWith("/v1/public/");
}

function assertKeyScope(keyKind: VindiKeyKind, path: string): void {
  if (keyKind === "private" && isPublicPath(path)) {
    throw new Error("Vindi private key cannot call /v1/public/");
  }
  if (keyKind === "public" && !isPublicPath(path)) {
    throw new Error("Vindi public key can only call /v1/public/");
  }
}

function asErrorItems(value: unknown): VindiErrorItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      "id" in item &&
      "message" in item &&
      typeof item.id === "string" &&
      typeof item.message === "string"
    ) {
      const parameter =
        "parameter" in item && typeof item.parameter === "string"
          ? item.parameter
          : undefined;
      return [{ id: item.id, parameter, message: item.message }];
    }
    return [];
  });
}

const DEFAULT_RETRY_AFTER_MS = 1000;

function retryAfterMs(header: string | null): number {
  const seconds = Number.parseInt(header ?? "", 10);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return seconds * 1000;
}

async function vindiErrorFromResponse(
  response: Response,
): Promise<VindiApiError> {
  try {
    const payload = (await response.json()) as { errors?: unknown };
    return new VindiApiError(response.status, asErrorItems(payload.errors));
  } catch {
    return new VindiApiError(response.status, []);
  }
}

export function createVindiClient(
  options: CreateVindiClientOptions,
): VindiClient {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep =
    options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return {
    async request<T>({ method, path, body }: VindiRequest): Promise<T> {
      assertKeyScope(options.keyKind, path);

      const init: RequestInit = {
        method,
        headers: {
          Authorization: encodeBasicAuth(options.apiKey),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      };

      for (let attempt = 0; ; attempt += 1) {
        const response = await fetchFn(`${baseUrl}${path}`, init);

        if (response.status === 429 && attempt < MAX_429_RETRIES) {
          await sleep(retryAfterMs(response.headers.get("Retry-After")));
          continue;
        }

        if (!response.ok) {
          throw await vindiErrorFromResponse(response);
        }

        const text = await response.text();
        if (!text) return undefined as T;
        return JSON.parse(text) as T;
      }
    },
  };
}
