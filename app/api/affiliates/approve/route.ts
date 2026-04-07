import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { stripe } from "@/lib/stripe";
import { getAffiliateById, approveAffiliate } from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: aff.code.toUpperCase(),
      metadata: {
        affiliate_id: aff.id,
        affiliate_user_id: aff.userId,
      },
      active: true,
    });

    await approveAffiliate(
      affiliateId,
      session.user.email,
      promotionCode.id,
      couponId,
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
