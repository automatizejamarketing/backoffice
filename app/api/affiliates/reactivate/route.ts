import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import {
  getAffiliateById,
  reactivateAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const authz = await requireBackofficePermissionResponse("affiliates:manage");
    if (!authz.ok) return authz.response;

    const body = await request.json();
    const { affiliateId } = body as { affiliateId: string };

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

    if (aff.status !== "blocked") {
      return NextResponse.json(
        { error: "Only blocked affiliates can be reactivated" },
        { status: 409 },
      );
    }

    let stripeReactivated = false;
    if (stripe && aff.stripePromotionCodeId) {
      await stripe.promotionCodes.update(aff.stripePromotionCodeId, {
        active: true,
      });
      stripeReactivated = true;
    }

    await reactivateAffiliate(affiliateId, authz.actor.email);

    await createAffiliateActionLog(
      affiliateId,
      authz.actor.email,
      "reactivated",
      { stripe_promotion_code_reactivated: stripeReactivated },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reactivating affiliate:", error);
    return NextResponse.json(
      { error: "Failed to reactivate affiliate" },
      { status: 500 },
    );
  }
}
