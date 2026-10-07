import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { metaPublishHold } from "@/lib/db/schema";
import { resolveConnectionTargets } from "@/lib/meta-business/access-grant-test";
import { runCertificationDiagnostic } from "@/lib/meta-business/certification-diagnostic";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";

export const maxDuration = 60;

/**
 * Backoffice "Testar certificação Meta". Runs `POST /ads` with
 * `validate_only` (nothing is created on Meta) with the client token and with
 * every stored consultant token, against the most recent held publish or,
 * without one, the client's first ad account.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:write");
  if (!authz.ok) return authz.response;

  const tokenResult = await getUserAccessTokenByUserId(id);
  if (!tokenResult.success) {
    return NextResponse.json(
      { error: tokenResult.error.error, message: tokenResult.error.message },
      { status: tokenResult.error.statusCode },
    );
  }

  const [hold] = await db
    .select({
      adAccountId: metaPublishHold.adAccountId,
      adSetId: metaPublishHold.draftAdSetId,
    })
    .from(metaPublishHold)
    .where(
      and(
        eq(metaPublishHold.userId, id),
        inArray(metaPublishHold.status, ["held", "publishing"]),
      ),
    )
    .orderBy(desc(metaPublishHold.createdAt))
    .limit(1);

  const targets = hold?.adAccountId
    ? null
    : await resolveConnectionTargets(tokenResult.accessToken, tokenResult.connection);
  const adAccountId = hold?.adAccountId ?? targets?.adAccountId ?? null;
  if (!adAccountId) {
    return NextResponse.json(
      { error: "no_ad_account", message: "O cliente não tem conta de anúncios conectada." },
      { status: 404 },
    );
  }

  try {
    const result = await runCertificationDiagnostic({
      clientToken: tokenResult.accessToken,
      adAccountId,
      adSetId: hold?.adSetId ?? null,
    });
    console.log("[certification-diagnostic]", {
      userId: id,
      actor: authz.actor.email,
      adAccountId: result.adAccountId,
      refused: result.tokens.map((t) => [t.label, t.certificationRefused, t.validateOnlyAd.subcode ?? null]),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[certification-diagnostic] failed", error);
    return NextResponse.json(
      { error: "diagnostic_failed", message: "Falha ao consultar a Meta." },
      { status: 502 },
    );
  }
}
