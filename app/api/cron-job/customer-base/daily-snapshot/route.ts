import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { captureCustomerBaseDailySnapshot } from "@/lib/backoffice/customer-base-snapshot";

export const maxDuration = 120;

/**
 * Daily snapshot of customer-base status (paying, trial, churn, scheduled cancel).
 * Idempotent per BRT calendar date — safe to retry the same day.
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[customer-base-snapshot-cron]");
  if (!auth.ok) return auth.response;

  try {
    const result = await captureCustomerBaseDailySnapshot();
    console.log("[customer-base-snapshot-cron] completed", {
      snapshotDate: result.snapshotDate,
      inserted: result.inserted,
      status: result.status,
    });

    return NextResponse.json({
      ok: true,
      snapshotDate: result.snapshotDate,
      inserted: result.inserted,
      status: result.status,
    });
  } catch (error) {
    console.error("[customer-base-snapshot-cron] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to capture customer base snapshot",
      },
      { status: 500 },
    );
  }
}
