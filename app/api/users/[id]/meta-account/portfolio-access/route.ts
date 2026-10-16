import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { checkPortfolioAccess } from "@/lib/meta-business/portfolio-access-server";

/**
 * GET /api/users/[id]/meta-account/portfolio-access
 *
 * Says whether a saved consultant Facebook already has full control of the
 * client's Meta portfolio, so "Conectar pelo portfólio" can run the BISU
 * login without the client. Read-only on our side and on Meta's.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  try {
    const report = await checkPortfolioAccess({
      userId: id,
      viewerAdminId: authz.actor.id,
    });
    return NextResponse.json(report);
  } catch (error) {
    console.error("portfolio_access.check_failed", error);
    return NextResponse.json(
      { error: "portfolio_access_check_failed" },
      { status: 500 },
    );
  }
}
