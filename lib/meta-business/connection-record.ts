import type { MetaBusinessAccount } from "@/lib/db/schema";
import { decryptAccessToken } from "./token-vault";

export type MetaTokenKind = "user" | "bisu";

export type MetaConnectionStatus =
  | "active"
  | "needs_reconnect"
  | "degraded_assets";

export type SafeMetaConnection = {
  id: string;
  userId: string;
  tokenKind: MetaTokenKind;
  accessToken: string;
  connectionStatus: MetaConnectionStatus;
  clientBusinessId: string | null;
  bisuAppScopedId: string | null;
  facebookUserId: string | null;
  name: string | null;
  pictureUrl: string | null;
  tokenExpiresAt: Date | null;
  grantedScopes: string[] | null;
  assignedAssets: MetaBusinessAccount["assignedAssets"];
  configId: string | null;
};

/**
 * Map a stored meta_business_accounts row to a usable connection,
 * decrypting the access-token envelope when present.
 */
export function mapStoredMetaConnection(
  row: MetaBusinessAccount,
): SafeMetaConnection {
  return {
    id: row.id,
    userId: row.userId,
    tokenKind: row.tokenKind === "bisu" ? "bisu" : "user",
    accessToken: decryptAccessToken(row.accessToken),
    connectionStatus:
      row.connectionStatus === "needs_reconnect" ||
      row.connectionStatus === "degraded_assets"
        ? row.connectionStatus
        : "active",
    clientBusinessId: row.clientBusinessId ?? null,
    bisuAppScopedId: row.bisuAppScopedId ?? null,
    facebookUserId: row.facebookUserId ?? null,
    name: row.name ?? null,
    pictureUrl: row.pictureUrl ?? null,
    tokenExpiresAt: row.tokenExpiresAt ?? null,
    grantedScopes: row.grantedScopes ?? null,
    assignedAssets: row.assignedAssets ?? null,
    configId: row.configId ?? null,
  };
}
