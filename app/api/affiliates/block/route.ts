import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import {
  getAffiliateById,
  blockAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const authz = await requireBackofficePermissionResponse("affiliates:manage");
    if (!authz.ok) return authz.response;

    const body = await request.json();
    const { affiliateId, reason } = body as {
      affiliateId: string;
      reason?: string;
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

    if (aff.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved affiliates can be blocked" },
        { status: 409 },
      );
    }

    let stripeDeactivated = false;
    if (stripe && aff.stripePromotionCodeId) {
      await stripe.promotionCodes.update(aff.stripePromotionCodeId, {
        active: false,
      });
      stripeDeactivated = true;
    }

    await blockAffiliate(affiliateId, authz.actor.email);

    await createAffiliateActionLog(
      affiliateId,
      authz.actor.email,
      "blocked",
      {
        reason: reason || null,
        stripe_promotion_code_deactivated: stripeDeactivated,
      },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error blocking affiliate:", error);
    return NextResponse.json(
      { error: "Failed to block affiliate" },
      { status: 500 },
    );
  }
}
