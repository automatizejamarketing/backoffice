import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { metaEnabledAsset } from "@/lib/db/schema";
import type { EnabledAssetFlagRow } from "./meta-asset-selection-flags";

export async function listEnabledAssetFlags(
  userId: string,
): Promise<EnabledAssetFlagRow[]> {
  return db
    .select({
      assetKind: metaEnabledAsset.assetKind,
      assetId: metaEnabledAsset.assetId,
      isPrimary: metaEnabledAsset.isPrimary,
    })
    .from(metaEnabledAsset)
    .where(eq(metaEnabledAsset.userId, userId));
}
