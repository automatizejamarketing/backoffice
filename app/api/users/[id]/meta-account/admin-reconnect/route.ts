import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  createAdminOauthAttempt,
  createConsultantCredentialAttempt,
} from "@/lib/meta-business/admin-oauth";

/**
 * POST /api/users/[id]/meta-account/admin-reconnect
 *
 * Starts the same Facebook Login for Business (BISU) flow the client sees on
 * Connect. The consultant completes it; the token is stored on the target
 * customer. The Meta redirect URI is the customer frontend callback (the only
 * URI registered on the app); that handler sends the consultant back here
 * without falling through to /login.
 *
 * With `purpose: "consultant_credential"` the consultant only saves their own
 * personal Facebook token for the certification fallback; the customer's
 * connection is not changed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:write");
  if (!authz.ok) return authz.response;

  let confirmed = false;
  let consultantCredential = false;
  try {
    const body = (await request.json()) as {
      confirm?: boolean;
      purpose?: string;
    };
    confirmed = body.confirm === true;
    consultantCredential = body.purpose === "consultant_credential";
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
    if (consultantCredential) {
      const attempt = await createConsultantCredentialAttempt({
        targetUserId: id,
        actorAdminId: authz.actor.id,
        actorAdminEmail: authz.actor.email,
      });
      return NextResponse.json({
        authUrl: attempt.authUrl,
        attemptId: attempt.attemptId,
        authMode: "user",
      });
    }

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
