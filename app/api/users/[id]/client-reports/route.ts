import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import {
  BackofficeAuthorizationError,
  requireMarketingUserAccess,
} from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { clientReportSnapshot } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: userId } = await context.params;
    await requireMarketingUserAccess(userId, "marketing:read");

    const snapshots = await db
      .select({
        id: clientReportSnapshot.id,
        periodType: clientReportSnapshot.periodType,
        periodStart: clientReportSnapshot.periodStart,
        periodEnd: clientReportSnapshot.periodEnd,
        status: clientReportSnapshot.status,
        headlineState: clientReportSnapshot.headlineState,
        monthsPaidBack: clientReportSnapshot.monthsPaidBack,
        isPersonalBest: clientReportSnapshot.isPersonalBest,
        builtAt: clientReportSnapshot.builtAt,
        deliveredAt: clientReportSnapshot.deliveredAt,
        payload: clientReportSnapshot.payload,
      })
      .from(clientReportSnapshot)
      .where(eq(clientReportSnapshot.userId, userId))
      .orderBy(desc(clientReportSnapshot.periodStart))
      .limit(12);

    return NextResponse.json({ snapshots });
  } catch (error) {
    if (error instanceof BackofficeAuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
