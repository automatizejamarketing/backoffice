import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import { createStripeLogger } from "@/lib/observability/stripe-logger";
import { db } from "@/lib/db";
import { user, affiliate } from "@/lib/db/schema";
import {
  createAffiliateForUser,
  generateAffiliateCode,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  const log = createStripeLogger({
    route: "/api/affiliates/create",
    op: "affiliate.create",
    actor: {
      id: authz.actor.id,
      email: authz.actor.email,
      role: authz.actor.role,
    },
  });

  let userId: string | undefined;

  try {
    const body = await request.json();
    const parsed = body as { userId: string; code?: string };
    userId = parsed.userId;
    const customCode = parsed.code;

    if (!userId) {
      log.step("validation_failed", { reason: "missing_userId" });
      return NextResponse.json(
        { error: "Missing userId", correlationId: log.correlationId },
        { status: 400 },
      );
    }

    // Check user exists
    log.step("loading_user", { userId });
    const [targetUser] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!targetUser) {
      log.step("user_not_found", { userId });
      return NextResponse.json(
        { error: "User not found", correlationId: log.correlationId },
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
      log.step("affiliate_already_exists", { userId, affiliateId: existing.id });
      return NextResponse.json(
        {
          error: "User already has an affiliate record",
          correlationId: log.correlationId,
        },
        { status: 409 },
      );
    }

    if (!stripe) {
      log.step("stripe_not_configured");
      return NextResponse.json(
        { error: "Stripe is not configured", correlationId: log.correlationId },
        { status: 503 },
      );
    }

    const couponId = process.env.STRIPE_AFFILIATE_COUPON_ID;
    if (!couponId) {
      log.step("missing_coupon_env");
      return NextResponse.json(
        {
          error: "STRIPE_AFFILIATE_COUPON_ID not configured",
          correlationId: log.correlationId,
        },
        { status: 503 },
      );
    }

    const code =
      customCode || generateAffiliateCode(targetUser.name || targetUser.email);

    log.step("creating_promotion_code", {
      userId,
      code: code.toUpperCase(),
      couponId,
    });
    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: code.toUpperCase(),
      metadata: {
        affiliate_user_id: userId,
      },
      active: true,
    });
    log.step("promotion_code_created", { promotionCodeId: promotionCode.id });

    const aff = await createAffiliateForUser(
      userId,
      code,
      authz.actor.email,
      promotionCode.id,
      couponId,
    );

    // Update promotion code metadata with affiliate ID
    log.step("updating_promotion_code_metadata", {
      promotionCodeId: promotionCode.id,
      affiliateId: aff.id,
    });
    await stripe.promotionCodes.update(promotionCode.id, {
      metadata: {
        affiliate_id: aff.id,
        affiliate_user_id: userId,
      },
    });

    log.success({ userId, affiliateId: aff.id, promotionCodeId: promotionCode.id });
    return NextResponse.json({ affiliate: aff, correlationId: log.correlationId });
  } catch (error) {
    const stripeError = log.error(error, { userId });
    return NextResponse.json(
      {
        error: "Failed to create affiliate",
        correlationId: log.correlationId,
        ...(stripeError
          ? { stripeErrorCode: stripeError.code, message: stripeError.message }
          : {}),
      },
      { status: 500 },
    );
  }
}
