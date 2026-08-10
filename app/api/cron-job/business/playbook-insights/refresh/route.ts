import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { runPlaybookInsightsBatch } from "@/lib/playbook-insights/run-playbook-insights-batch";
import { resolveUserIdForMockSeed } from "@/lib/playbook-insights/seed-mock-insights";

export const maxDuration = 300;

/**
 * Playbook optimization suggestions for account consultants.
 * Writes performance_insights with ruleId prefix playbook.*
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[playbook-insights-cron]");
  if (!auth.ok) return auth.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || null;
  const email = request.nextUrl.searchParams.get("email")?.trim() || null;

  try {
    let userIds: string[] | undefined;
    if (userId) {
      userIds = [userId];
    } else if (email) {
      const target = await resolveUserIdForMockSeed({ email });
      if (!target) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      userIds = [target.userId];
    }

    const result = await runPlaybookInsightsBatch({
      triggeredBy: userIds ? "manual" : "cron",
      userIds,
      maxUsers: userIds ? 1 : undefined,
    });

    console.log("[playbook-insights-cron] completed", {
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      evaluated: result.evaluated,
      insightsCreated: result.insightsCreated,
      errorCount: result.errorCount,
      targeted: Boolean(userIds),
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      totalWithMeta: result.totalWithMeta,
      evaluated: result.evaluated,
      insightsCreated: result.insightsCreated,
      campaignsEvaluated: result.campaignsEvaluated,
      errorCount: result.errorCount,
      results: result.results.map((row) => ({
        email: row.email,
        userId: row.userId,
        insightsCreated: row.insightsCreated,
        campaignsEvaluated: row.campaignsEvaluated,
        errorMessage: row.errorMessage,
      })),
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
