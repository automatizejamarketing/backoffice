import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import { createStripeLogger } from "@/lib/observability/stripe-logger";
import {
  getAffiliateById,
  approveAffiliate,
  updateAffiliateCode,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  const log = createStripeLogger({
    route: "/api/affiliates/approve",
    op: "affiliate.approve",
    actor: {
      id: authz.actor.id,
      email: authz.actor.email,
      role: authz.actor.role,
    },
  });

  let affiliateId: string | undefined;

  try {
    const body = await request.json();
    const parsed = body as { affiliateId: string; code?: string };
    affiliateId = parsed.affiliateId;
    const code = parsed.code;

    if (!affiliateId) {
      log.step("validation_failed", { reason: "missing_affiliateId" });
      return NextResponse.json(
        { error: "Missing affiliateId", correlationId: log.correlationId },
        { status: 400 },
      );
    }

    log.step("loading_affiliate", { affiliateId });
    const aff = await getAffiliateById(affiliateId);
    if (!aff) {
      log.step("affiliate_not_found", { affiliateId });
      return NextResponse.json(
        { error: "Affiliate not found", correlationId: log.correlationId },
        { status: 404 },
      );
    }

    if (aff.status === "approved") {
      log.step("already_approved", { affiliateId });
      return NextResponse.json(
        { error: "Affiliate already approved", correlationId: log.correlationId },
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

    const finalCode = code?.trim() || aff.code;

    if (finalCode !== aff.code) {
      log.step("updating_code", {
        affiliateId,
        oldCode: aff.code,
        newCode: finalCode,
      });
      await updateAffiliateCode(affiliateId, finalCode);
      await createAffiliateActionLog(
        affiliateId,
        authz.actor.email,
        "code_edited",
        { old_code: aff.code, new_code: finalCode },
      );
    }

    log.step("creating_promotion_code", {
      affiliateId,
      code: finalCode.toUpperCase(),
      couponId,
    });
    const promotionCode = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: couponId },
      code: finalCode.toUpperCase(),
      metadata: {
        affiliate_id: aff.id,
        affiliate_user_id: aff.userId,
      },
      active: true,
    });
    log.step("promotion_code_created", { promotionCodeId: promotionCode.id });

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

    log.success({ affiliateId, promotionCodeId: promotionCode.id });
    return NextResponse.json({
      success: true,
      promotionCodeId: promotionCode.id,
      correlationId: log.correlationId,
    });
  } catch (error) {
    const stripeError = log.error(error, { affiliateId });
    return NextResponse.json(
      {
        error: "Failed to approve affiliate",
        correlationId: log.correlationId,
        ...(stripeError
          ? { stripeErrorCode: stripeError.code, message: stripeError.message }
          : {}),
      },
      { status: 500 },
    );
  }
}
