import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildAuthorizationServerMetadata,
  buildRedirect,
  generateSecret,
  hashSecret,
  isAllowedRedirectUri,
  mcpResourceUrl,
  parseAuthorizeRequest,
  parseBasicClientAuth,
  parseScopes,
  secretsEqual,
  validateClientRegistration,
  verifyPkceS256,
  type StoredClient,
} from "./core";

const client: StoredClient = {
  id: "client-1",
  clientName: "Claude",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  tokenEndpointAuthMethod: "none",
  clientSecretHash: null,
};

const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function authorizeParams(overrides: Record<string, string | null> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

describe("metadata", () => {
  it("advertises the endpoints under the issuer", () => {
    const meta = buildAuthorizationServerMetadata("https://app.example/");
    assert.equal(meta.issuer, "https://app.example");
    assert.equal(meta.authorization_endpoint, "https://app.example/oauth/authorize");
    assert.equal(meta.token_endpoint, "https://app.example/api/oauth/token");
    assert.equal(meta.registration_endpoint, "https://app.example/api/oauth/register");
    assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(meta.scopes_supported, ["backoffice:read", "backoffice:write", "offline_access"]);
    assert.equal(mcpResourceUrl("https://app.example/"), "https://app.example/api/mcp");
  });
});

describe("secrets and PKCE", () => {
  it("hashes deterministically and compares in constant time", () => {
    const secret = generateSecret();
    assert.equal(hashSecret(secret), hashSecret(secret));
    assert.equal(secretsEqual(secret, secret), true);
    assert.equal(secretsEqual(secret, generateSecret()), false);
  });

  it("verifies S256 challenges and rejects malformed verifiers", () => {
    assert.equal(verifyPkceS256(verifier, challenge), true);
    assert.equal(verifyPkceS256("b".repeat(43), challenge), false);
    assert.equal(verifyPkceS256("short", challenge), false);
  });
});

describe("parseScopes", () => {
  it("grants everything when nothing is requested", () => {
    assert.deepEqual(parseScopes(""), { ok: true, scopes: ["backoffice:read", "backoffice:write"] });
    assert.deepEqual(parseScopes(null), { ok: true, scopes: ["backoffice:read", "backoffice:write"] });
  });

  it("keeps a valid subset and rejects unknown scopes", () => {
    assert.deepEqual(parseScopes("backoffice:read backoffice:read"), { ok: true, scopes: ["backoffice:read"] });
    assert.deepEqual(parseScopes("backoffice:read admin"), { ok: false });
  });

  it("accepts offline_access without granting anything for it", () => {
    assert.deepEqual(parseScopes("backoffice:read offline_access"), { ok: true, scopes: ["backoffice:read"] });
    assert.deepEqual(parseScopes("backoffice:read backoffice:write offline_access"), { ok: true, scopes: ["backoffice:read", "backoffice:write"] });
    // Only offline_access asked for no access: read-only, never the write default.
    assert.deepEqual(parseScopes("offline_access"), { ok: true, scopes: ["backoffice:read"] });
  });
});

describe("validateClientRegistration", () => {
  it("accepts a public client with https callbacks and defaults", () => {
    const result = validateClientRegistration({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    });
    assert.ok(result.ok);
    assert.equal(result.client.clientName, "ChatGPT");
    assert.equal(result.client.tokenEndpointAuthMethod, "none");
    assert.deepEqual(result.client.grantTypes, ["authorization_code", "refresh_token"]);
  });

  it("allows http only on loopback and rejects fragments", () => {
    assert.equal(isAllowedRedirectUri("http://localhost:6274/oauth/callback"), true);
    assert.equal(isAllowedRedirectUri("http://127.0.0.1/cb"), true);
    assert.equal(isAllowedRedirectUri("http://evil.example/cb"), false);
    assert.equal(isAllowedRedirectUri("https://ok.example/cb#frag"), false);
    assert.equal(isAllowedRedirectUri("not a url"), false);
    const result = validateClientRegistration({ redirect_uris: ["http://evil.example/cb"] });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.error.error, "invalid_redirect_uri");
  });

  it("rejects unsupported auth methods, grants and response types", () => {
    const base = { redirect_uris: ["https://ok.example/cb"] };
    assert.equal(
      validateClientRegistration({ ...base, token_endpoint_auth_method: "private_key_jwt" }).ok,
      false,
    );
    assert.equal(
      validateClientRegistration({ ...base, grant_types: ["client_credentials"] }).ok,
      false,
    );
    assert.equal(validateClientRegistration({ ...base, response_types: ["token"] }).ok, false);
    assert.equal(validateClientRegistration(null).ok, false);
  });
});

describe("parseAuthorizeRequest", () => {
  const issuer = "https://app.example";

  it("returns the request with default scopes and preserved state", () => {
    const result = parseAuthorizeRequest(authorizeParams(), client, issuer);
    assert.ok(result.ok);
    assert.deepEqual(result.request, {
      clientId: "client-1",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: challenge,
      scopes: ["backoffice:read", "backoffice:write"],
      state: "xyz",
      resource: null,
    });
  });

  it("shows (never redirects) unknown clients and unregistered callbacks", () => {
    const unknown = parseAuthorizeRequest(authorizeParams(), null, issuer);
    assert.ok(!unknown.ok && unknown.kind === "display");
    assert.equal(unknown.error, "invalid_client");

    const badUri = parseAuthorizeRequest(
      authorizeParams({ redirect_uri: "https://evil.example/cb" }),
      client,
      issuer,
    );
    assert.ok(!badUri.ok && badUri.kind === "display");
  });

  it("redirects protocol errors back to the registered callback with state", () => {
    const noPkce = parseAuthorizeRequest(authorizeParams({ code_challenge: null }), client, issuer);
    assert.ok(!noPkce.ok && noPkce.kind === "redirect");
    assert.equal(noPkce.error, "invalid_request");
    assert.equal(noPkce.state, "xyz");

    const plain = parseAuthorizeRequest(
      authorizeParams({ code_challenge_method: "plain" }),
      client,
      issuer,
    );
    assert.ok(!plain.ok && plain.kind === "redirect");

    const badType = parseAuthorizeRequest(authorizeParams({ response_type: "token" }), client, issuer);
    assert.ok(!badType.ok && badType.kind === "redirect");
    assert.equal(badType.error, "unsupported_response_type");

    const badScope = parseAuthorizeRequest(authorizeParams({ scope: "root" }), client, issuer);
    assert.ok(!badScope.ok && badScope.kind === "redirect");
    assert.equal(badScope.error, "invalid_scope");
  });

  it("accepts the MCP resource and rejects any other", () => {
    const ok = parseAuthorizeRequest(
      authorizeParams({ resource: "https://app.example/api/mcp/" }),
      client,
      issuer,
    );
    assert.ok(ok.ok);
    assert.equal(ok.request.resource, "https://app.example/api/mcp");

    const other = parseAuthorizeRequest(
      authorizeParams({ resource: "https://other.example/api/mcp" }),
      client,
      issuer,
    );
    assert.ok(!other.ok && other.kind === "redirect");
    assert.equal(other.error, "invalid_target");
  });
});

describe("helpers", () => {
  it("builds redirects without empty params", () => {
    assert.equal(
      buildRedirect("https://c.example/cb?keep=1", { code: "abc", state: null }),
      "https://c.example/cb?keep=1&code=abc",
    );
  });

  it("parses basic client auth", () => {
    const header = `Basic ${Buffer.from("id:se:cret").toString("base64")}`;
    assert.deepEqual(parseBasicClientAuth(header), { clientId: "id", clientSecret: "se:cret" });
    assert.equal(parseBasicClientAuth("Bearer x"), null);
    assert.equal(parseBasicClientAuth(null), null);
  });
});
