import { NextResponse, type NextRequest } from "next/server";
import { runAccountAlertsBatch } from "@/lib/account-alerts/run-batch";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";

export const maxDuration = 300;

/**
 * Account-state alerts for the assigned consultant: no active campaign,
 * PIX near expiration, failed card charge, recent cancellation.
 * Writes performance_insights with ruleId prefix account.* and posts new
 * rows to the proactivity Slack webhook.
 *
 * Daily, after the managed-campaign check (11:00 UTC).
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[account-alerts-cron]");
  if (!auth.ok) return auth.response;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || null;

  try {
    const result = await runAccountAlertsBatch({
      triggeredBy: userId ? "manual" : "cron",
      userId,
    });

    console.log("[account-alerts-cron] completed", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "account_alerts_failed";
    console.error("[account-alerts-cron] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
