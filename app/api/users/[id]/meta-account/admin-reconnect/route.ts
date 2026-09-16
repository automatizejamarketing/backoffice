import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { createAdminOauthAttempt } from "@/lib/meta-business/admin-oauth";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";

/**
 * POST /api/users/[id]/meta-account/admin-reconnect
 *
 * Starts a short-lived consultant OAuth attempt. The callback lives on the
 * customer frontend (same Meta redirect URI) and persists the token under
 * the target customer — never under the consultant's Automatize login.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:write");
  if (!authz.ok) return authz.response;

  let confirmed = false;
  try {
    const body = (await request.json()) as { confirm?: boolean };
    confirmed = body.confirm === true;
  } catch {
    confirmed = false;
  }

  if (!confirmed) {
    return NextResponse.json(
      { error: "confirmation_required" },
      { status: 400 },
    );
  }

  const account = await getUserMetaBusinessAccount(id);
  if (!account) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const attempt = await createAdminOauthAttempt({
      targetUserId: id,
      actorAdminId: authz.actor.id,
      actorAdminEmail: authz.actor.email,
    });

    return NextResponse.json({
      authUrl: attempt.authUrl,
      attemptId: attempt.attemptId,
      authMode: attempt.authMode,
    });
  } catch (error) {
    console.error("admin_reconnect.start_failed", error);
    return NextResponse.json(
      { error: "failed_to_start_admin_reconnect" },
      { status: 500 },
    );
  }
}
