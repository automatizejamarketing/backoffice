import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaEnabledAsset } from "@/lib/db/schema";
import { orderedEnabledAdAccountIds } from "./enabled-ad-account-scope";
import type { EnabledAssetFlagRow } from "./meta-asset-selection-flags";

/** Bare ad account ids the client enabled, principal first. Empty = no selection. */
export async function listEnabledAdAccountIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({
      assetId: metaEnabledAsset.assetId,
      isPrimary: metaEnabledAsset.isPrimary,
    })
    .from(metaEnabledAsset)
    .where(
      and(
        eq(metaEnabledAsset.userId, userId),
        eq(metaEnabledAsset.assetKind, "ad_account"),
      ),
    );
  return orderedEnabledAdAccountIds(rows);
}

export async function listEnabledAssetFlags(
  userId: string,
): Promise<EnabledAssetFlagRow[]> {
  return db
    .select({
      assetKind: metaEnabledAsset.assetKind,
      assetId: metaEnabledAsset.assetId,
      isPrimary: metaEnabledAsset.isPrimary,
      instagramBusinessAccountId: metaEnabledAsset.instagramBusinessAccountId,
    })
    .from(metaEnabledAsset)
    .where(eq(metaEnabledAsset.userId, userId));
}
