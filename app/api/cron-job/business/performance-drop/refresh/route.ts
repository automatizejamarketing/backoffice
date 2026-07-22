import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { runPerformanceDropBatch } from "@/lib/performance-drop/run-performance-drop-batch";

export const maxDuration = 300;

/**
 * Daily performance-drop evaluation: last_7d vs previous 7d via Meta insights.
 * Uses stale-only semantics so mid-day retries skip users already checked today.
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[performance-drop-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await runPerformanceDropBatch({
      onlyStale: true,
      triggeredBy: "cron",
    });

    console.log("[performance-drop-cron] completed", {
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      evaluated: result.evaluated,
      dropCount: result.dropCount,
      errorCount: result.errorCount,
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      eligible: result.eligible,
      evaluated: result.evaluated,
      dropCount: result.dropCount,
      warningCount: result.warningCount,
      criticalCount: result.criticalCount,
      errorCount: result.errorCount,
    });
  } catch (error) {
    console.error("[performance-drop-cron] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to evaluate performance drops",
      },
      { status: 500 },
    );
  }
}
