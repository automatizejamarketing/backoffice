import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { createAdminOauthAttempt } from "@/lib/meta-business/admin-oauth";

/**
 * POST /api/users/[id]/meta-account/admin-reconnect
 *
 * Starts the same Facebook Login for Business (BISU) flow the client sees on
 * Connect. The consultant completes it; the token is stored on the target
 * customer. The Meta redirect URI is the customer frontend callback (the only
 * URI registered on the app); that handler sends the consultant back here
 * without falling through to /login.
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
