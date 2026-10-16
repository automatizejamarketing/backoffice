import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { refreshWeeklyBenchmarks } from "@/lib/client-reports/benchmarks";
import {
  runClientCampaignReportBatch,
  runClientReportSnapshotBatch,
} from "@/lib/client-reports/run-batch";

export const maxDuration = 800;

const SOFT_DEADLINE_MS = 740_000;

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[client-reports-weekly]");
  if (!auth.ok) return auth.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || null;
  try {
    const softDeadlineAt = Date.now() + SOFT_DEADLINE_MS;
    const weekly = await runClientReportSnapshotBatch({
      periodType: "weekly",
      userIds: userId ? [userId] : undefined,
      softDeadlineAt,
    });
    const campaigns = await runClientCampaignReportBatch({
      userIds: userId ? [userId] : undefined,
      softDeadlineAt,
    });
    const benchmarks = await refreshWeeklyBenchmarks();

    return NextResponse.json({
      ok: true,
      weekly,
      campaigns,
      benchmarks,
    });
  } catch (error) {
    console.error("[client-reports-weekly] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to build reports",
      },
      { status: 500 },
    );
  }
}
