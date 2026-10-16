import "server-only";

import {
  parseAuthorizeRequest,
  parseBasicClientAuth,
  type AuthorizeParseResult,
} from "./core";
import type { ClientCredentials, TokenError } from "./service";
import { mcpOauthService } from "./store";

/**
 * Public origin of this deployment (issuer, resource URL, redirect targets).
 * Vercel routes by host, so the forwarded host is trustworthy; locally it is
 * whatever `next dev` is listening on. Falls back to the configured app URL.
 */
export function resolveIssuer(headers: Headers): string {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))
    ?.split(",")[0]
    ?.trim();
  if (!host) {
    return (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
} as const;

export function oauthJson(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...init.headers,
    },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function tokenErrorResponse(error: TokenError): Response {
  const status = error.error === "invalid_client" ? 401 : 400;
  return oauthJson(
    { error: error.error, error_description: error.description },
    {
      status,
      headers: status === 401 ? { "WWW-Authenticate": 'Basic realm="mcp"' } : undefined,
    },
  );
}

/** Token / registration bodies arrive as form-urlencoded (RFC 6749) or JSON. */
export async function readFormBody(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => null)) as unknown;
    const params = new URLSearchParams();
    if (json && typeof json === "object") {
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (typeof value === "string") {
          params.set(key, value);
        }
      }
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

/** Basic header wins over body credentials (RFC 6749 §2.3.1). */
export function clientCredentialsFrom(
  request: Request,
  form: URLSearchParams,
): ClientCredentials {
  const basic = parseBasicClientAuth(request.headers.get("authorization"));
  if (basic) {
    return basic;
  }
  return {
    clientId: form.get("client_id"),
    clientSecret: form.get("client_secret"),
  };
}

/** Loads the client and validates an authorize request; shared by page and action. */
export async function resolveAuthorizeRequest(
  params: URLSearchParams,
  headers: Headers,
): Promise<{ parsed: AuthorizeParseResult; clientName: string | null; redirectUris: string[] }> {
  const clientId = params.get("client_id");
  const client = clientId ? await mcpOauthService.getClient(clientId) : null;
  return {
    parsed: parseAuthorizeRequest(params, client, resolveIssuer(headers)),
    clientName: client?.clientName ?? null,
    redirectUris: client?.redirectUris ?? [],
  };
}

/** Another grant of the same person + app held the connection lock past `lock_timeout`. */
export function isLockTimeout(error: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined);
  return code(error) === "55P03" || code(error && typeof error === "object" && "cause" in error ? error.cause : undefined) === "55P03";
}
