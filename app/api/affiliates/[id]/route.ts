import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  getAffiliateById,
  getAffiliateMetrics,
  getAffiliateConversions,
  getAffiliateActionLogs,
} from "@/lib/affiliate/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("affiliates:manage");
    if (!authz.ok) return authz.response;

    const { id } = await params;
    const aff = await getAffiliateById(id);
    if (!aff) {
      return NextResponse.json(
        { error: "Affiliate not found" },
        { status: 404 },
      );
    }

    const [metrics, conversions, actionLogs] = await Promise.all([
      getAffiliateMetrics(id),
      getAffiliateConversions(id),
      getAffiliateActionLogs(id),
    ]);

    return NextResponse.json({ affiliate: aff, metrics, conversions, actionLogs });
  } catch (error) {
    console.error("Error fetching affiliate:", error);
    return NextResponse.json(
      { error: "Failed to fetch affiliate" },
      { status: 500 },
    );
  }
}
