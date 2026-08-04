import { desc, eq } from "drizzle-orm";
import {
  refreshManagedCampaignCacheForUser,
  wasManagedCampaignCheckedToday,
} from "@/lib/business/managed-campaigns";
import { db } from "@/lib/db";
import { getUsersWithMetaBusinessAccount } from "@/lib/db/admin-queries";
import { getBusinessOperatingRules } from "@/lib/db/business-queries";
import { businessManagedCampaignCache } from "@/lib/db/schema";

export type ManagedCampaignBatchRefreshItem = {
  userId: string;
  email: string;
  checkedAccounts: number;
  hasActiveManagedCampaign: boolean;
  managedCampaignNames: string[];
  errorMessage: string | null;
};

export type ManagedCampaignBatchRefreshResult = {
  totalWithMeta: number;
  eligible: number;
  refreshed: number;
  activeCount: number;
  inactiveCount: number;
  errorCount: number;
  results: ManagedCampaignBatchRefreshItem[];
};

export type RefreshManagedCampaignsBatchOptions = {
  /** When true, skip users already checked today (America/Sao_Paulo). */
  onlyStale?: boolean;
  pageSize?: number;
  onProgress?: (progress: {
    done: number;
    total: number;
    currentEmail: string;
  }) => void;
};

/**
 * Refreshes the managed-campaign cache for every user with a connected Meta
 * account. Intended for cron + one-off scripts — not for request handlers that
 * must stay under Vercel timeouts when the portfolio is large.
 */
export async function refreshManagedCampaignsBatch(
  options: RefreshManagedCampaignsBatchOptions = {},
): Promise<ManagedCampaignBatchRefreshResult> {
  const onlyStale = options.onlyStale ?? false;
  const pageSize = Math.max(1, options.pageSize ?? 100);
  const rules = await getBusinessOperatingRules();
  const now = new Date();

  const allUsers: Array<{ id: string; email: string }> = [];
  let page = 1;
  let totalWithMeta = 0;

  for (;;) {
    const batch = await getUsersWithMetaBusinessAccount({
      page,
      limit: pageSize,
    });
    totalWithMeta = batch.total;
    allUsers.push(
      ...batch.users.map((row) => ({ id: row.id, email: row.email })),
    );
    if (allUsers.length >= batch.total || batch.users.length === 0) break;
    page += 1;
  }

  const results: ManagedCampaignBatchRefreshItem[] = [];
  let eligible = 0;

  for (let index = 0; index < allUsers.length; index += 1) {
    const target = allUsers[index];
    options.onProgress?.({
      done: index,
      total: allUsers.length,
      currentEmail: target.email,
    });

    if (onlyStale) {
      const [latest] = await db
        .select({ checkedAt: businessManagedCampaignCache.checkedAt })
        .from(businessManagedCampaignCache)
        .where(eq(businessManagedCampaignCache.userId, target.id))
        .orderBy(desc(businessManagedCampaignCache.checkedAt))
        .limit(1);

      if (wasManagedCampaignCheckedToday(latest?.checkedAt ?? null, now)) {
        continue;
      }
    }

    eligible += 1;
    const result = await refreshManagedCampaignCacheForUser(target.id, rules);
    results.push({
      userId: target.id,
      email: target.email,
      checkedAccounts: result.checkedAccounts,
      hasActiveManagedCampaign: result.hasActiveManagedCampaign,
      managedCampaignNames: result.managedCampaignNames,
      errorMessage: result.errorMessage,
    });
  }

  options.onProgress?.({
    done: allUsers.length,
    total: allUsers.length,
    currentEmail: "",
  });

  return {
    totalWithMeta,
    eligible,
    refreshed: results.length,
    activeCount: results.filter((row) => row.hasActiveManagedCampaign).length,
    inactiveCount: results.filter(
      (row) => !row.hasActiveManagedCampaign && !row.errorMessage,
    ).length,
    errorCount: results.filter((row) => row.errorMessage).length,
    results,
  };
}
