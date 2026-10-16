import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { metaConsultantCredential, metaPublishHold } from "@/lib/db/schema";

/** A consultant reconnects their personal Facebook once this old (or never). */
const CONSULTANT_CREDENTIAL_MAX_AGE_DAYS = 50;

/**
 * Open certification holds for this client. The publish routes write the row
 * when the client's token and the consultant token both fail; this is the
 * backoffice alert.
 *
 * Also says whether the signed-in consultant should (re)connect their personal
 * Facebook: no stored token, or the last one is 50+ days old. That token is
 * shared by every client, so it can be saved from a client with no holds —
 * nothing gets republished there.
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

  const [credential] = await db
    .select({ connectedAt: metaConsultantCredential.updatedAt })
    .from(metaConsultantCredential)
    .where(eq(metaConsultantCredential.actorAdminId, authz.actor.id))
    .orderBy(desc(metaConsultantCredential.updatedAt))
    .limit(1);
  const connectedAt = credential?.connectedAt ?? null;
  const maxAgeMs = CONSULTANT_CREDENTIAL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const consultantNeedsConnect =
    !connectedAt || Date.now() - connectedAt.getTime() >= maxAgeMs;

  return NextResponse.json({
    consultantCredential: {
      connectedAt: connectedAt?.toISOString() ?? null,
      needsConnect: consultantNeedsConnect,
    },
    holds: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
