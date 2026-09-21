import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { runClientReportSnapshotBatch } from "@/lib/client-reports/run-batch";

export const maxDuration = 800;

const SOFT_DEADLINE_MS = 740_000;

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[client-reports-monthly]");
  if (!auth.ok) return auth.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || null;
  try {
    const monthly = await runClientReportSnapshotBatch({
      periodType: "monthly",
      userIds: userId ? [userId] : undefined,
      softDeadlineAt: Date.now() + SOFT_DEADLINE_MS,
    });
    return NextResponse.json({ ok: true, monthly });
  } catch (error) {
    console.error("[client-reports-monthly] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to build reports",
      },
      { status: 500 },
    );
  }
}
