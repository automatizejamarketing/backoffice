import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  businessManagedCampaignCache,
  metaTrackingConfigVersion,
} from "@/lib/db/schema";

const META_CHECK_PLACEHOLDER = "__meta_check__";

/**
 * Accounts where Automatize actually created a campaign for this user.
 * Tracking `is_managed` survives a rename; the cache covers active [AM] names.
 * Recent spend is intentionally not a signal.
 */
export async function listAutomatizeManagedAdAccountIds(
  userId: string,
): Promise<string[]> {
  const [tracked, cached] = await Promise.all([
    db
      .select({ accountId: metaTrackingConfigVersion.accountId })
      .from(metaTrackingConfigVersion)
      .where(
        and(
          eq(metaTrackingConfigVersion.userId, userId),
          eq(metaTrackingConfigVersion.entityLevel, "campaign"),
          eq(metaTrackingConfigVersion.isManaged, true),
        ),
      ),
    db
      .select({
        adAccountId: businessManagedCampaignCache.adAccountId,
        names: businessManagedCampaignCache.managedCampaignNames,
        active: businessManagedCampaignCache.hasActiveManagedCampaign,
      })
      .from(businessManagedCampaignCache)
      .where(eq(businessManagedCampaignCache.userId, userId)),
  ]);

  const ids = new Set<string>();
  for (const row of tracked) {
    if (row.accountId) ids.add(row.accountId);
  }
  for (const row of cached) {
    if (row.adAccountId === META_CHECK_PLACEHOLDER) continue;
    if (row.active || (row.names?.length ?? 0) > 0) {
      ids.add(row.adAccountId);
    }
  }
  return [...ids];
}
