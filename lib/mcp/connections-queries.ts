import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { backofficeMcpOauthClient, backofficeMcpOauthToken, backofficeUser } from "@/lib/db/schema";

export type McpConnection = {
  actorEmail: string;
  actorName: string | null;
  clientId: string;
  clientName: string;
  /** Registered redirects: what proves which assistant the client is (`identifyClient`). */
  redirectUris: string[];
  /**
   * First grant this person ever had on this app. Rows do not record whether a
   * revocation was a refresh or a disconnect, so the start of the current
   * connection is not recoverable; the page labels it "Primeira conexão".
   */
  firstConnectedAt: Date;
  /** Last time the app got or renewed its access: renewal happens on use, at most once an hour. */
  lastActivityAt: Date;
};

/**
 * Live connections: one per person and app with a grant still usable (not
 * revoked, refresh not expired). A refresh revokes the previous row and
 * inserts a new one, so the rows of a pair are the history of that connection.
 */
export async function listMcpConnections(actorEmail: string | null): Promise<McpConnection[]> {
  const t = backofficeMcpOauthToken;
  return db
    .select({
      actorEmail: t.actorEmail,
      actorName: backofficeUser.name,
      clientId: t.clientId,
      clientName: backofficeMcpOauthClient.clientName,
      redirectUris: backofficeMcpOauthClient.redirectUris,
      firstConnectedAt: sql<Date>`min(${t.createdAt})`.mapWith(t.createdAt),
      lastActivityAt: sql<Date>`max(${t.createdAt})`.mapWith(t.createdAt),
    })
    .from(t)
    .innerJoin(backofficeMcpOauthClient, eq(backofficeMcpOauthClient.id, t.clientId))
    .leftJoin(backofficeUser, sql`lower(${backofficeUser.email}) = lower(${t.actorEmail})`)
    .where(actorEmail ? eq(t.actorEmail, actorEmail) : undefined)
    .groupBy(t.actorEmail, backofficeUser.name, t.clientId, backofficeMcpOauthClient.clientName, backofficeMcpOauthClient.redirectUris)
    .having(sql`count(*) filter (where ${t.revokedAt} is null and ${t.refreshExpiresAt} > now()) > 0`)
    .orderBy(desc(sql`max(${t.createdAt})`));
}
