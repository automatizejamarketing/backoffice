import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { refreshManagedCampaignsBatch } from "@/lib/business/refresh-managed-campaigns-batch";

// 800, igual ao coletor diário: 300 s vinha estourando (504) com a base atual.
export const maxDuration = 800;

/**
 * Margem para o batch parar SOZINHO antes do maxDuration: o soft deadline
 * devolve um 200 parcial com `stoppedForBudget` em vez de um 504. O tick
 * seguinte do cron retoma via `onlyStale`.
 */
const SOFT_DEADLINE_MS = 750_000;

/**
 * Daily refresh of managed-campaign ([AM]) cache for every user with Meta.
 * Prefer `--stale` semantics so a retry mid-day does not re-hit Meta for
 * accounts already checked today.
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[managed-campaigns-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await refreshManagedCampaignsBatch({
      onlyStale: true,
      softDeadlineAt: Date.now() + SOFT_DEADLINE_MS,
    });
    console.log("[managed-campaigns-cron] completed", {
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      refreshed: result.refreshed,
      activeCount: result.activeCount,
      errorCount: result.errorCount,
      stoppedForBudget: result.stoppedForBudget,
      skippedForBudget: result.skippedForBudget,
    });

    return NextResponse.json({
      ok: true,
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      refreshed: result.refreshed,
      activeCount: result.activeCount,
      inactiveCount: result.inactiveCount,
      errorCount: result.errorCount,
      stoppedForBudget: result.stoppedForBudget,
      skippedForBudget: result.skippedForBudget,
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
