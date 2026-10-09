import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeMcpOauthAuthorizationCode,
  backofficeMcpOauthClient,
  backofficeMcpOauthToken,
} from "@/lib/db/schema";
import type { StoredClient, TokenEndpointAuthMethod } from "./core";
import { createMcpOauthService, type McpOauthStore } from "./service";

export const mcpOauthDbStore: McpOauthStore = {
  async getClient(id): Promise<StoredClient | null> {
    const [row] = await db.select().from(backofficeMcpOauthClient).where(eq(backofficeMcpOauthClient.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      clientName: row.clientName,
      redirectUris: row.redirectUris,
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod as TokenEndpointAuthMethod,
      clientSecretHash: row.clientSecretHash,
    };
  },

  async insertClient(client) {
    await db.insert(backofficeMcpOauthClient).values({
      id: client.id,
      clientName: client.clientName,
      clientSecretHash: client.clientSecretHash,
      redirectUris: client.redirectUris,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      grantTypes: client.grantTypes,
    });
  },

  async insertCode(code) {
    await db.insert(backofficeMcpOauthAuthorizationCode).values(code);
  },

  async consumeCode(codeHash, now) {
    const [row] = await db
      .update(backofficeMcpOauthAuthorizationCode)
      .set({ usedAt: now })
      .where(and(eq(backofficeMcpOauthAuthorizationCode.codeHash, codeHash), isNull(backofficeMcpOauthAuthorizationCode.usedAt)))
      .returning();
    return row ?? null;
  },

  async insertToken(token) {
    const [row] = await db.insert(backofficeMcpOauthToken).values(token).returning({ id: backofficeMcpOauthToken.id });
    return row;
  },

  async findTokenByAccessHash(accessTokenHash) {
    const [row] = await db.select().from(backofficeMcpOauthToken).where(eq(backofficeMcpOauthToken.accessTokenHash, accessTokenHash)).limit(1);
    return row ?? null;
  },

  async consumeRefreshToken(refreshTokenHash, now) {
    const [row] = await db
      .update(backofficeMcpOauthToken)
      .set({ revokedAt: now })
      .where(and(eq(backofficeMcpOauthToken.refreshTokenHash, refreshTokenHash), isNull(backofficeMcpOauthToken.revokedAt)))
      .returning();
    return row ?? null;
  },

  async revokeConnection(actorEmail, clientId, now) {
    return db.transaction(async (tx) => {
      const revoked = await tx
        .update(backofficeMcpOauthToken)
        .set({ revokedAt: now })
        .where(and(
          eq(backofficeMcpOauthToken.actorEmail, actorEmail),
          eq(backofficeMcpOauthToken.clientId, clientId),
          isNull(backofficeMcpOauthToken.revokedAt),
        ))
        .returning({ refreshExpiresAt: backofficeMcpOauthToken.refreshExpiresAt });
      await tx
        .update(backofficeMcpOauthAuthorizationCode)
        .set({ usedAt: now })
        .where(and(
          eq(backofficeMcpOauthAuthorizationCode.actorEmail, actorEmail),
          eq(backofficeMcpOauthAuthorizationCode.clientId, clientId),
          isNull(backofficeMcpOauthAuthorizationCode.usedAt),
        ));
      return revoked.filter((row) => row.refreshExpiresAt > now).length;
    });
  },
};

/** The service the routes use; one instance per module load. */
export const mcpOauthService = createMcpOauthService(mcpOauthDbStore);
