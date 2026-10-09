import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  backofficeMcpOauthAuthorizationCode,
  backofficeMcpOauthClient,
  backofficeMcpOauthToken,
} from "@/lib/db/schema";
import type { StoredClient, TokenEndpointAuthMethod } from "./core";
import { createMcpOauthService, type McpOauthStore } from "./service";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializes every grant change of one person on one app (code exchange,
 * refresh, disconnect) until the transaction ends. Without it a refresh that
 * already revoked its old row but has not inserted the new one is invisible to
 * "Desconectar", and its new token would outlive the disconnect.
 */
async function lockConnection(tx: Executor, actorEmail: string, clientId: string) {
  // A frozen function holding the lock must not hang refreshes and disconnects for long.
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mcp-oauth:${actorEmail}:${clientId}`}, 0))`);
}

function createDbStore(tx: Executor): McpOauthStore {
  const store: McpOauthStore = {
    async transaction(fn) {
      if (tx !== db) return fn(store);
      return db.transaction((inner) => fn(createDbStore(inner)));
    },

    async getClient(id): Promise<StoredClient | null> {
      const [row] = await tx.select().from(backofficeMcpOauthClient).where(eq(backofficeMcpOauthClient.id, id)).limit(1);
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
      await tx.insert(backofficeMcpOauthClient).values({
        id: client.id,
        clientName: client.clientName,
        clientSecretHash: client.clientSecretHash,
        redirectUris: client.redirectUris,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        grantTypes: client.grantTypes,
      });
    },

    async insertCode(code) {
      await tx.insert(backofficeMcpOauthAuthorizationCode).values(code);
    },

    async consumeCode(codeHash, now) {
      const code = backofficeMcpOauthAuthorizationCode;
      const [owner] = await tx.select({ actorEmail: code.actorEmail, clientId: code.clientId }).from(code).where(eq(code.codeHash, codeHash)).limit(1);
      if (!owner) return null;
      await lockConnection(tx, owner.actorEmail, owner.clientId);
      const [row] = await tx
        .update(code)
        .set({ usedAt: now })
        .where(and(eq(code.codeHash, codeHash), isNull(code.usedAt)))
        .returning();
      return row ?? null;
    },

    async insertToken(token) {
      const [row] = await tx.insert(backofficeMcpOauthToken).values(token).returning({ id: backofficeMcpOauthToken.id });
      return row;
    },

    async findTokenByAccessHash(accessTokenHash) {
      const [row] = await tx.select().from(backofficeMcpOauthToken).where(eq(backofficeMcpOauthToken.accessTokenHash, accessTokenHash)).limit(1);
      return row ?? null;
    },

    async consumeRefreshToken(refreshTokenHash, now) {
      const token = backofficeMcpOauthToken;
      const [owner] = await tx.select({ actorEmail: token.actorEmail, clientId: token.clientId }).from(token).where(eq(token.refreshTokenHash, refreshTokenHash)).limit(1);
      if (!owner) return null;
      await lockConnection(tx, owner.actorEmail, owner.clientId);
      const [row] = await tx
        .update(token)
        .set({ revokedAt: now })
        .where(and(eq(token.refreshTokenHash, refreshTokenHash), isNull(token.revokedAt)))
        .returning();
      return row ?? null;
    },

    async revokeConnection(actorEmail, clientId, now) {
      await lockConnection(tx, actorEmail, clientId);
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
    },
  };
  return store;
}

export const mcpOauthDbStore: McpOauthStore = createDbStore(db);

/** The service the routes use; one instance per module load. */
export const mcpOauthService = createMcpOauthService(mcpOauthDbStore);
