import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { metaPublishHold } from "@/lib/db/schema";

/**
 * Open certification holds for this client. The publish routes write the row
 * when the client's token and the consultant token both fail; this is the
 * backoffice alert.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const rows = await db
    .select({
      id: metaPublishHold.id,
      flow: metaPublishHold.flow,
      status: metaPublishHold.status,
      adAccountId: metaPublishHold.adAccountId,
      campaignName: metaPublishHold.campaignName,
      reasonCode: metaPublishHold.reasonCode,
      createdAt: metaPublishHold.createdAt,
    })
    .from(metaPublishHold)
    .where(
      and(
        eq(metaPublishHold.userId, id),
        inArray(metaPublishHold.status, ["held", "publishing"]),
      ),
    )
    .orderBy(desc(metaPublishHold.createdAt));

  return NextResponse.json({
    holds: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
