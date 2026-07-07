import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import { createStripeLogger } from "@/lib/observability/stripe-logger";
import {
  getAffiliateById,
  reactivateAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  const log = createStripeLogger({
    route: "/api/affiliates/reactivate",
    op: "affiliate.reactivate",
    actor: {
      id: authz.actor.id,
      email: authz.actor.email,
      role: authz.actor.role,
    },
  });

  let affiliateId: string | undefined;

  try {
    const body = await request.json();
    affiliateId = (body as { affiliateId: string }).affiliateId;

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

    if (aff.status !== "blocked") {
      log.step("not_reactivatable", { affiliateId, status: aff.status });
      return NextResponse.json(
        {
          error: "Only blocked affiliates can be reactivated",
          correlationId: log.correlationId,
        },
        { status: 409 },
      );
    }

    let stripeReactivated = false;
    if (stripe && aff.stripePromotionCodeId) {
      log.step("reactivating_promotion_code", {
        affiliateId,
        promotionCodeId: aff.stripePromotionCodeId,
      });
      await stripe.promotionCodes.update(aff.stripePromotionCodeId, {
        active: true,
      });
      stripeReactivated = true;
    } else {
      log.step("promotion_code_reactivation_skipped", {
        affiliateId,
        hasStripe: Boolean(stripe),
        hasPromotionCodeId: Boolean(aff.stripePromotionCodeId),
      });
    }

    await reactivateAffiliate(affiliateId, authz.actor.email);

    await createAffiliateActionLog(
      affiliateId,
      authz.actor.email,
      "reactivated",
      { stripe_promotion_code_reactivated: stripeReactivated },
    );

    log.success({ affiliateId, stripeReactivated });
    return NextResponse.json({ success: true, correlationId: log.correlationId });
  } catch (error) {
    const stripeError = log.error(error, { affiliateId });
    return NextResponse.json(
      {
        error: "Failed to reactivate affiliate",
        correlationId: log.correlationId,
        ...(stripeError
          ? { stripeErrorCode: stripeError.code, message: stripeError.message }
          : {}),
      },
      { status: 500 },
    );
  }
}
