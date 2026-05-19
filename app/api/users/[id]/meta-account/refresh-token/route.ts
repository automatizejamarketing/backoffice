import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { refreshUserMetaToken } from "@/lib/meta-business/refresh-user-token";
import { buildReconnectInfo } from "@/lib/meta-business/reconnect-link";

/**
 * POST /api/users/[id]/meta-account/refresh-token
 *
 * Admin-initiated best-effort renewal of a user's Meta Business long-lived
 * token. Requires `marketing:write` (this MUTATES the stored token, unlike the
 * rest of the backoffice Meta surface — see backoffice/CLAUDE.md). A
 * 190/460-invalidated token cannot be renewed; the response then carries
 * `needsReconnect`/reconnect info so the admin can ask the user to reconnect.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:write");
  if (!authz.ok) return authz.response;

  const result = await refreshUserMetaToken({
    userId: id,
    adminEmail: authz.actor.email,
  });

  const reconnect = buildReconnectInfo();
  const status = result.ok
    ? 200
    : result.status === "needs_reconnect"
      ? 409
      : 502;

  console.info("backoffice.metaToken.refresh", {
    targetUserId: id,
    adminEmail: authz.actor.email,
    status: result.status,
  });

  return NextResponse.json({ ...result, reconnect }, { status });
}
