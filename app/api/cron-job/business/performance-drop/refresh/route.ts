import { NextResponse, type NextRequest } from "next/server";
import { runPerformanceDropBatch } from "@/lib/performance-drop/run-performance-drop-batch";

export const maxDuration = 300;

/**
 * Daily performance-drop evaluation: last_7d vs previous 7d via Meta insights.
 * Uses stale-only semantics so mid-day retries skip users already checked today.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[performance-drop-cron] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET environment variable is not configured" },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
