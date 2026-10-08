import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserAccessSummary } from "@/lib/db/access-summary-queries";

export const dynamic = "force-dynamic";

/**
 * Read-only access + billing summary for the marketing page. Same guard as the
 * rest of that page, so a consultant sees it for the clients they can open
 * there — not the full subscription tab, which stays behind users:read.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  try {
    const summary = await getUserAccessSummary(id);
    if (!summary) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[access-summary] GET failed", error);
    return NextResponse.json(
      { error: "Failed to load access summary" },
      { status: 500 },
    );
  }
}
