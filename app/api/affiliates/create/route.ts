import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/app/(auth)/auth";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/db";
import { user, affiliate } from "@/lib/db/schema";
import {
  createAffiliateForUser,
  generateAffiliateCode,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, code: customCode } = body as {
      userId: string;
      code?: string;
    };

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 },
      );
    }

    // Check user exists
    const [targetUser] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    // Check if user already has an affiliate record
    const [existing] = await db
      .select({ id: affiliate.id })
      .from(affiliate)
      .where(eq(affiliate.userId, userId))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "User already has an affiliate record" },
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

    const code = customCode || generateAffiliateCode(targetUser.name || targetUser.email);

    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: code.toUpperCase(),
      metadata: {
        affiliate_user_id: userId,
      },
      active: true,
    });

    const aff = await createAffiliateForUser(
      userId,
      code,
      session.user.email,
      promotionCode.id,
      couponId,
    );

    // Update promotion code metadata with affiliate ID
    await stripe.promotionCodes.update(promotionCode.id, {
      metadata: {
        affiliate_id: aff.id,
        affiliate_user_id: userId,
      },
    });

    return NextResponse.json({ affiliate: aff });
  } catch (error) {
    console.error("Error creating affiliate:", error);
    return NextResponse.json(
      { error: "Failed to create affiliate" },
      { status: 500 },
    );
  }
}
