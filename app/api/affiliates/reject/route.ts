import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  getAffiliateById,
  rejectAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const authz = await requireBackofficePermissionResponse("affiliates:manage");
    if (!authz.ok) return authz.response;

    const body = await request.json();
    const { affiliateId, reason } = body as {
      affiliateId: string;
      reason: string;
    };

    if (!affiliateId) {
      return NextResponse.json(
        { error: "Missing affiliateId" },
        { status: 400 },
      );
    }

    const aff = await getAffiliateById(affiliateId);
    if (!aff) {
      return NextResponse.json(
        { error: "Affiliate not found" },
        { status: 404 },
      );
    }

    await rejectAffiliate(affiliateId, authz.actor.email, reason || "");

    await createAffiliateActionLog(
      affiliateId,
      authz.actor.email,
      "rejected",
      { reason: reason || null },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error rejecting affiliate:", error);
    return NextResponse.json(
      { error: "Failed to reject affiliate" },
      { status: 500 },
    );
  }
}
