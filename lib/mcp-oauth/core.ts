import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Scopes a grant can carry; write covers everything that changes state. */
export const MCP_SCOPE_READ = "backoffice:read";
export const MCP_SCOPE_WRITE = "backoffice:write";
export const MCP_SCOPES = [MCP_SCOPE_READ, MCP_SCOPE_WRITE] as const;

/**
 * OAuth 2.1 authorization server for the backoffice MCP connector — the pure part.
 * Ported from the frontend Mat connector; grants belong to a team member e-mail.
 * Authorization code + PKCE (S256, mandatory), dynamic client registration
 * (RFC 7591), refresh-token rotation, RFC 8414 / 9728 metadata. No storage
 * here; `service.ts` wires this to the database.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;

export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const MCP_PATH = "/api/mcp";

export const TOKEN_ENDPOINT_AUTH_METHODS = [
  "none",
  "client_secret_post",
  "client_secret_basic",
] as const;
export type TokenEndpointAuthMethod =
  (typeof TOKEN_ENDPOINT_AUTH_METHODS)[number];

const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export type GrantType = (typeof GRANT_TYPES)[number];

export function mcpResourceUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}${MCP_PATH}`;
}

export function buildAuthorizationServerMetadata(issuer: string) {
  const origin = issuer.replace(/\/$/, "");
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: [...GRANT_TYPES],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...TOKEN_ENDPOINT_AUTH_METHODS],
    scopes_supported: [...MCP_SCOPES],
  };
}

// ───────────────────────── secrets ─────────────────────────

export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens, codes and client secrets are stored hashed; lookups hash first. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time compare of two equal-purpose strings (e.g. two hashes). */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_RE.test(verifier)) {
    return false;
  }
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(computed);
  const right = Buffer.from(challenge);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ───────────────────────── scopes ─────────────────────────

export function parseScopes(
  raw: string | null | undefined,
): { ok: true; scopes: string[] } | { ok: false } {
  const requested = (raw ?? "").split(/\s+/).filter(Boolean);
  if (requested.length === 0) {
    return { ok: true, scopes: [...MCP_SCOPES] };
  }
  const unique = [...new Set(requested)];
  const supported = new Set<string>(MCP_SCOPES);
  if (unique.some((scope) => !supported.has(scope))) {
    return { ok: false };
  }
  return { ok: true, scopes: unique };
}

// ───────────────────────── client registration ─────────────────────────

export type ClientRegistration = {
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  grantTypes: GrantType[];
};

export type ClientRegistrationError = {
  error: "invalid_redirect_uri" | "invalid_client_metadata";
  description: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere; plain http only on loopback (local MCP inspectors). No fragments. */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

export function validateClientRegistration(
  body: unknown,
): { ok: true; client: ClientRegistration } | { ok: false; error: ClientRegistrationError } {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: {
        error: "invalid_client_metadata",
        description: "Request body must be a JSON object.",
      },
    };
  }
  const meta = body as Record<string, unknown>;

  const redirectUris = asStringArray(meta.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    return {
      ok: false,
      error: {
        error: "invalid_redirect_uri",
        description: "redirect_uris must be a non-empty array of URLs.",
      },
    };
  }
  const rejected = redirectUris.find((uri) => !isAllowedRedirectUri(uri));
  if (rejected) {
    return {
      ok: false,
      error: {
        error: "invalid_redirect_uri",
        description: `redirect_uri not allowed: ${rejected}`,
      },
    };
  }

  const method = meta.token_endpoint_auth_method ?? "none";
  if (
    typeof method !== "string" ||
    !(TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(method)
  ) {
    return {
      ok: false,
      error: {
        error: "invalid_client_metadata",
        description: "Unsupported token_endpoint_auth_method.",
      },
    };
  }

  const grantTypes = meta.grant_types === undefined
    ? [...GRANT_TYPES]
    : asStringArray(meta.grant_types);
  if (
    !grantTypes ||
    grantTypes.length === 0 ||
    grantTypes.some((grant) => !(GRANT_TYPES as readonly string[]).includes(grant))
  ) {
    return {
      ok: false,
      error: {
        error: "invalid_client_metadata",
        description: "grant_types may only contain authorization_code and refresh_token.",
      },
    };
  }

  const responseTypes = meta.response_types === undefined
    ? ["code"]
    : asStringArray(meta.response_types);
  if (!responseTypes || responseTypes.some((type) => type !== "code")) {
    return {
      ok: false,
      error: {
        error: "invalid_client_metadata",
        description: "response_types may only contain code.",
      },
    };
  }

  const clientName =
    typeof meta.client_name === "string" && meta.client_name.trim()
      ? meta.client_name.trim().slice(0, 200)
      : "MCP client";

  return {
    ok: true,
    client: {
      clientName,
      redirectUris: [...new Set(redirectUris)],
      tokenEndpointAuthMethod: method as TokenEndpointAuthMethod,
      grantTypes: grantTypes as GrantType[],
    },
  };
}

// ───────────────────────── authorize request ─────────────────────────

export type StoredClient = {
  id: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  clientSecretHash: string | null;
};

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state: string | null;
  resource: string | null;
};

/**
 * Errors before the redirect_uri is trusted must be shown to the user, never
 * bounced to an attacker-chosen URL. Everything after is sent back to the
 * client the OAuth way.
 */
export type AuthorizeParseResult =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; kind: "display"; error: string; description: string }
  | {
      ok: false;
      kind: "redirect";
      redirectUri: string;
      state: string | null;
      error: string;
      description: string;
    };

export function parseAuthorizeRequest(
  params: URLSearchParams,
  client: StoredClient | null,
  issuer: string,
): AuthorizeParseResult {
  const clientId = params.get("client_id");
  if (!clientId || !client || client.id !== clientId) {
    return {
      ok: false,
      kind: "display",
      error: "invalid_client",
      description: "Cliente desconhecido.",
    };
  }

  const redirectUri = params.get("redirect_uri");
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      kind: "display",
      error: "invalid_request",
      description: "redirect_uri não registrada para este cliente.",
    };
  }

  const state = params.get("state");
  const redirectError = (error: string, description: string) =>
    ({ ok: false, kind: "redirect", redirectUri, state, error, description }) as const;

  if (params.get("response_type") !== "code") {
    return redirectError("unsupported_response_type", "Only response_type=code is supported.");
  }

  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || !PKCE_CHALLENGE_RE.test(codeChallenge)) {
    return redirectError("invalid_request", "code_challenge (S256) is required.");
  }
  if ((params.get("code_challenge_method") ?? "S256") !== "S256") {
    return redirectError("invalid_request", "Only code_challenge_method=S256 is supported.");
  }

  const scopes = parseScopes(params.get("scope"));
  if (!scopes.ok) {
    return redirectError("invalid_scope", "Unknown scope requested.");
  }

  const resource = params.get("resource");
  if (resource && !isSameResource(resource, mcpResourceUrl(issuer))) {
    return redirectError("invalid_target", "resource must be the Automatize backoffice MCP server.");
  }

  return {
    ok: true,
    request: {
      clientId,
      redirectUri,
      codeChallenge,
      scopes: scopes.scopes,
      state,
      resource: resource ? mcpResourceUrl(issuer) : null,
    },
  };
}

export function isSameResource(a: string, b: string): boolean {
  return a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

export function buildRedirect(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function expiresAt(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

export function isExpired(at: Date, now: Date): boolean {
  return at.getTime() <= now.getTime();
}

/** Parses `Authorization: Basic base64(client_id:client_secret)`. */
export function parseBasicClientAuth(
  header: string | null,
): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  return {
    clientId: decodeURIComponent(decoded.slice(0, separator)),
    clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}
