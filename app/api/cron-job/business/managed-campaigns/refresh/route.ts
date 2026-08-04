import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { refreshManagedCampaignsBatch } from "@/lib/business/refresh-managed-campaigns-batch";

export const maxDuration = 300;

/**
 * Daily refresh of managed-campaign ([AM]) cache for every user with Meta.
 * Prefer `--stale` semantics so a retry mid-day does not re-hit Meta for
 * accounts already checked today.
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[managed-campaigns-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await refreshManagedCampaignsBatch({ onlyStale: true });
    console.log("[managed-campaigns-cron] completed", {
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      refreshed: result.refreshed,
      activeCount: result.activeCount,
      errorCount: result.errorCount,
    });

    return NextResponse.json({
      ok: true,
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      refreshed: result.refreshed,
      activeCount: result.activeCount,
      inactiveCount: result.inactiveCount,
      errorCount: result.errorCount,
    });
  } catch (error) {
    console.error("[managed-campaigns-cron] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to refresh managed campaigns",
      },
      { status: 500 },
    );
  }
}
