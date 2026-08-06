import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { runPlaybookInsightsBatch } from "@/lib/playbook-insights/run-playbook-insights-batch";

export const maxDuration = 300;

/**
 * Playbook optimization suggestions for account consultants.
 * Writes performance_insights with ruleId prefix playbook.*
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[playbook-insights-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await runPlaybookInsightsBatch({
      triggeredBy: "cron",
    });

    console.log("[playbook-insights-cron] completed", {
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      evaluated: result.evaluated,
      insightsCreated: result.insightsCreated,
      errorCount: result.errorCount,
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      evaluated: result.evaluated,
      insightsCreated: result.insightsCreated,
      campaignsEvaluated: result.campaignsEvaluated,
      errorCount: result.errorCount,
      // First failures help diagnose Graph rejects without dumping full batch.
      sampleErrors: result.results
        .filter((row) => row.errorMessage)
        .slice(0, 5)
        .map((row) => ({
          email: row.email,
          errorMessage: row.errorMessage,
        })),
    });
  } catch (error) {
    console.error("[playbook-insights-cron] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to evaluate playbook insights",
      },
      { status: 500 },
    );
  }
}
