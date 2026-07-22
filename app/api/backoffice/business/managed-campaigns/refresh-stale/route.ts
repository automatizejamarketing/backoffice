import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  refreshManagedCampaignCacheForUser,
  wasManagedCampaignCheckedToday,
} from "@/lib/business/managed-campaigns";
import { refreshManagedCampaignsBatch } from "@/lib/business/refresh-managed-campaigns-batch";
import {
  getBusinessOperatingRules,
  getBusinessPortfolio,
} from "@/lib/db/business-queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const consultantId =
    authz.actor.role === "admin"
      ? (searchParams.get("consultantId") ?? "all")
      : undefined;

  // Consultants keep the portfolio-scoped path (assigned accounts only).
  // Admins use the full Meta-connected batch with stale-today skipping.
  if (authz.actor.role !== "admin") {
    const [rules, portfolio] = await Promise.all([
      getBusinessOperatingRules(),
      getBusinessPortfolio(authz.actor, { consultantId }),
    ]);
    const now = new Date();
    const targets = portfolio.filter(
      (account) =>
        account.metaAccountName &&
        !wasManagedCampaignCheckedToday(account.managedCampaignCheckedAt, now),
    );
    const results = [];
    for (const account of targets) {
      const result = await refreshManagedCampaignCacheForUser(
        account.userId,
        rules,
      );
      results.push({
        userId: account.userId,
        email: account.userEmail,
        checkedAccounts: result.checkedAccounts,
        hasActiveManagedCampaign: result.hasActiveManagedCampaign,
        errorMessage: result.errorMessage,
      });
    }
    return NextResponse.json({
      totalVisible: portfolio.length,
      eligible: targets.length,
      refreshed: results.length,
      errors: results.filter((result) => result.errorMessage).length,
      results,
    });
  }

  const result = await refreshManagedCampaignsBatch({ onlyStale: true });

  return NextResponse.json({
    totalVisible: result.totalWithMeta,
    eligible: result.eligible,
    refreshed: result.refreshed,
    errors: result.errorCount,
    activeCount: result.activeCount,
    inactiveCount: result.inactiveCount,
    results: result.results,
  });
}
