import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import {
  getAffiliateById,
  approveAffiliate,
  updateAffiliateCode,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const authz = await requireBackofficePermissionResponse("affiliates:manage");
    if (!authz.ok) return authz.response;

    const body = await request.json();
    const { affiliateId, code } = body as {
      affiliateId: string;
      code?: string;
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

    if (aff.status === "approved") {
      return NextResponse.json(
        { error: "Affiliate already approved" },
        { status: 409 },
      );
    }

    if (!stripe) {
      return NextResponse.json(
        { error: "Stripe is not configured" },
        { status: 503 },
      );
    }

    const couponId = process.env.STRIPE_AFFILIATE_COUPON_ID;
    if (!couponId) {
      return NextResponse.json(
        { error: "STRIPE_AFFILIATE_COUPON_ID not configured" },
        { status: 503 },
      );
    }

    const finalCode = code?.trim() || aff.code;

    if (finalCode !== aff.code) {
      await updateAffiliateCode(affiliateId, finalCode);
      await createAffiliateActionLog(
        affiliateId,
        authz.actor.email,
        "code_edited",
        { old_code: aff.code, new_code: finalCode },
      );
    }

    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: finalCode.toUpperCase(),
      metadata: {
        affiliate_id: aff.id,
        affiliate_user_id: aff.userId,
      },
      active: true,
    });

    await approveAffiliate(
      affiliateId,
      authz.actor.email,
      promotionCode.id,
      couponId,
    );

    await createAffiliateActionLog(
      affiliateId,
      authz.actor.email,
      "approved",
      { stripe_promotion_code_id: promotionCode.id },
    );

    return NextResponse.json({ success: true, promotionCodeId: promotionCode.id });
  } catch (error) {
    console.error("Error approving affiliate:", error);
    return NextResponse.json(
      { error: "Failed to approve affiliate" },
      { status: 500 },
    );
  }
}
