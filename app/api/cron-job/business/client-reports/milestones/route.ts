import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { runClientReportMilestonesBatch } from "@/lib/client-reports/run-batch";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[client-reports-milestones]");
  if (!auth.ok) return auth.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || null;

  try {
    const result = await runClientReportMilestonesBatch({
      userIds: userId ? [userId] : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[client-reports-milestones] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to evaluate report milestones",
      },
      { status: 500 },
    );
  }
}
