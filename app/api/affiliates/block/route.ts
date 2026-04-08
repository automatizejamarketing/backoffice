import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { stripe } from "@/lib/stripe";
import {
  getAffiliateById,
  blockAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    await blockAffiliate(affiliateId, session.user.email);

    await createAffiliateActionLog(
      affiliateId,
      session.user.email,
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
