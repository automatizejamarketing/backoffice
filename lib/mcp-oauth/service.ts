import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  expiresAt,
  generateSecret,
  hashSecret,
  isExpired,
  isSameResource,
  parseScopes,
  secretsEqual,
  validateClientRegistration,
  verifyPkceS256,
  type AuthorizeRequest,
  type StoredClient,
} from "./core";

/**
 * Grant logic over an abstract store: the routes call this, the database
 * implementation lives in `store.ts`, and tests use an in-memory store.
 * Codes and refresh tokens are consumed atomically by the store (update ...
 * where unused returning), so a replayed code or refresh token loses.
 */

export type CodeRow = {
  codeHash: string;
  clientId: string;
  actorEmail: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
  expiresAt: Date;
};

export type TokenRow = {
  id: string;
  clientId: string;
  actorEmail: string;
  scope: string;
  resource: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
};

export type NewTokenRow = Omit<TokenRow, "id" | "revokedAt"> & {
  accessTokenHash: string;
  refreshTokenHash: string;
};

export interface McpOauthStore {
  /**
   * Runs `fn` in one database transaction. Consuming a code or refresh token
   * locks that person + app until commit, and so does `revokeConnection`, so a
   * grant being issued and a disconnect never interleave.
   */
  transaction<T>(fn: (store: McpOauthStore) => Promise<T>): Promise<T>;
  getClient(id: string): Promise<StoredClient | null>;
  insertClient(client: StoredClient & { grantTypes: string[] }): Promise<void>;
  insertCode(code: CodeRow): Promise<void>;
  /** Marks the code used and returns it; null when unknown or already used. */
  consumeCode(codeHash: string, now: Date): Promise<CodeRow | null>;
  insertToken(token: NewTokenRow): Promise<{ id: string }>;
  findTokenByAccessHash(accessTokenHash: string): Promise<TokenRow | null>;
  /** Revokes the grant and returns it; null when unknown or already revoked. */
  consumeRefreshToken(refreshTokenHash: string, now: Date): Promise<TokenRow | null>;
  /**
   * Revokes every live grant of this person on this client and burns their
   * unused codes, so a consent given seconds before cannot be exchanged after.
   * Returns how many grants were live.
   */
  revokeConnection(actorEmail: string, clientId: string, now: Date): Promise<number>;
}

export type TokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "unsupported_grant_type";

export type TokenError = { ok: false; error: TokenErrorCode; description: string };

export type TokenResponse = {
  ok: true;
  body: {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    refresh_token: string;
    scope: string;
  };
};

export type ClientCredentials = {
  clientId: string | null;
  clientSecret: string | null;
};

function tokenError(error: TokenErrorCode, description: string): TokenError {
  return { ok: false, error, description };
}

export function createMcpOauthService(
  store: McpOauthStore,
  now: () => Date = () => new Date(),
) {
  async function authenticateClient(
    credentials: ClientCredentials,
  ): Promise<StoredClient | TokenError> {
    if (!credentials.clientId) {
      return tokenError("invalid_client", "client_id is required.");
    }
    const client = await store.getClient(credentials.clientId);
    if (!client) {
      return tokenError("invalid_client", "Unknown client.");
    }
    if (client.tokenEndpointAuthMethod === "none") {
      return client;
    }
    if (
      !credentials.clientSecret ||
      !client.clientSecretHash ||
      !secretsEqual(hashSecret(credentials.clientSecret), client.clientSecretHash)
    ) {
      return tokenError("invalid_client", "Client authentication failed.");
    }
    return client;
  }

  async function issueTokens(store: McpOauthStore, input: {
    clientId: string;
    actorEmail: string;
    scopes: string[];
    resource: string | null;
    }): Promise<TokenResponse> {
    const accessToken = generateSecret();
    const refreshToken = generateSecret();
    const issuedAt = now();
    await store.insertToken({
      clientId: input.clientId,
      actorEmail: input.actorEmail,
      scope: input.scopes.join(" "),
      resource: input.resource,
      accessTokenHash: hashSecret(accessToken),
      refreshTokenHash: hashSecret(refreshToken),
      accessExpiresAt: expiresAt(issuedAt, ACCESS_TOKEN_TTL_SECONDS),
      refreshExpiresAt: expiresAt(issuedAt, REFRESH_TOKEN_TTL_SECONDS),
    });
    return {
      ok: true,
      body: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: input.scopes.join(" "),
      },
    };
  }

  return {
    /** RFC 7591 dynamic registration. Confidential clients get a one-time secret. */
    async registerClient(body: unknown) {
      const validated = validateClientRegistration(body);
      if (!validated.ok) {
        return validated;
      }
      const { client } = validated;
      const id = generateSecret(16);
      const secret =
        client.tokenEndpointAuthMethod === "none" ? null : generateSecret();
      await store.insertClient({
        id,
        clientName: client.clientName,
        redirectUris: client.redirectUris,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        clientSecretHash: secret ? hashSecret(secret) : null,
        grantTypes: client.grantTypes,
      });
      return {
        ok: true as const,
        response: {
          client_id: id,
          ...(secret ? { client_secret: secret } : {}),
          client_id_issued_at: Math.floor(now().getTime() / 1000),
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: client.tokenEndpointAuthMethod,
          grant_types: client.grantTypes,
          response_types: ["code"],
        },
      };
    },

    getClient(id: string) {
      return store.getClient(id);
    },

    /** Called after the user consents; returns the code to send back to the client. */
    async issueAuthorizationCode(input: {
      request: AuthorizeRequest;
      actorEmail: string;
    }): Promise<string> {
      const code = generateSecret();
      await store.insertCode({
        codeHash: hashSecret(code),
        clientId: input.request.clientId,
        actorEmail: input.actorEmail,
        redirectUri: input.request.redirectUri,
        codeChallenge: input.request.codeChallenge,
        scope: input.request.scopes.join(" "),
        resource: input.request.resource,
        expiresAt: expiresAt(now(), AUTHORIZATION_CODE_TTL_SECONDS),
      });
      return code;
    },

    async exchangeAuthorizationCode(input: {
      credentials: ClientCredentials;
      code: string | null;
      codeVerifier: string | null;
      redirectUri: string | null;
      resource: string | null;
    }): Promise<TokenResponse | TokenError> {
      const client = await authenticateClient(input.credentials);
      if ("ok" in client) {
        return client;
      }
      if (!input.code || !input.codeVerifier) {
        return tokenError("invalid_request", "code and code_verifier are required.");
      }
      const { code: rawCode, codeVerifier } = input;
      return store.transaction(async (tx) => {
        const current = now();
        const code = await tx.consumeCode(hashSecret(rawCode), current);
        if (!code || code.clientId !== client.id) {
          return tokenError("invalid_grant", "Unknown, used or foreign authorization code.");
        }
        if (isExpired(code.expiresAt, current)) {
          return tokenError("invalid_grant", "Authorization code expired.");
        }
        if (input.redirectUri !== null && input.redirectUri !== code.redirectUri) {
          return tokenError("invalid_grant", "redirect_uri does not match the authorization request.");
        }
        if (!verifyPkceS256(codeVerifier, code.codeChallenge)) {
          return tokenError("invalid_grant", "PKCE verification failed.");
        }
        if (input.resource && code.resource && !isSameResource(input.resource, code.resource)) {
          return tokenError("invalid_grant", "resource does not match the authorization request.");
        }
        return issueTokens(tx, {
          clientId: client.id,
          actorEmail: code.actorEmail,
          scopes: code.scope.split(" "),
          resource: code.resource,
        });
      });
    },

    /** Rotates the grant: the old row is revoked. */
    async refreshAccessToken(input: {
      credentials: ClientCredentials;
      refreshToken: string | null;
      scope: string | null;
    }): Promise<TokenResponse | TokenError> {
      const client = await authenticateClient(input.credentials);
      if ("ok" in client) {
        return client;
      }
      if (!input.refreshToken) {
        return tokenError("invalid_request", "refresh_token is required.");
      }
      const { refreshToken, scope } = input;
      return store.transaction(async (tx) => {
        const current = now();
        const previous = await tx.consumeRefreshToken(
          hashSecret(refreshToken),
          current,
        );
        if (!previous || previous.clientId !== client.id) {
          return tokenError("invalid_grant", "Unknown, rotated or foreign refresh token.");
        }
        if (isExpired(previous.refreshExpiresAt, current)) {
          return tokenError("invalid_grant", "Refresh token expired.");
        }
        const granted = previous.scope.split(" ");
        let scopes = granted;
        if (scope) {
          const requested = parseScopes(scope, granted);
          if (!requested.ok || requested.scopes.some((s) => !granted.includes(s))) {
            return tokenError("invalid_scope", "Requested scope exceeds the grant.");
          }
          scopes = requested.scopes;
        }
        return issueTokens(tx, {
          clientId: client.id,
          actorEmail: previous.actorEmail,
          scopes,
          resource: previous.resource,
        });
      });
    },

    /** "Desconectar": the client loses access at once and must ask for consent again. */
    disconnect(input: { actorEmail: string; clientId: string }): Promise<number> {
      return store.transaction((tx) => tx.revokeConnection(input.actorEmail, input.clientId, now()));
    },

    /** Bearer check for `/api/mcp`; null means 401. */
    async verifyAccessToken(token: string): Promise<(AuthInfo & { extra: McpAuthExtra }) | null> {
      const row = await store.findTokenByAccessHash(hashSecret(token));
      if (!row || row.revokedAt || isExpired(row.accessExpiresAt, now())) {
        return null;
      }
      return {
        token,
        clientId: row.clientId,
        scopes: row.scope.split(" "),
        expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000),
        ...(row.resource ? { resource: new URL(row.resource) } : {}),
        extra: {
          tokenId: row.id,
          actorEmail: row.actorEmail,
        },
      };
    },
  };
}

export type McpAuthExtra = {
  tokenId: string;
  actorEmail: string;
  /** Origem pública desta implantação na chamada (para links de volta ao backoffice). */
  origin?: string;
};

export type McpOauthService = ReturnType<typeof createMcpOauthService>;
