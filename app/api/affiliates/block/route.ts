import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { stripe } from "@/lib/stripe";
import { createStripeLogger } from "@/lib/observability/stripe-logger";
import {
  getAffiliateById,
  blockAffiliate,
  createAffiliateActionLog,
} from "@/lib/affiliate/queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  const log = createStripeLogger({
    route: "/api/affiliates/block",
    op: "affiliate.block",
    actor: {
      id: authz.actor.id,
      email: authz.actor.email,
      role: authz.actor.role,
    },
  });

  let affiliateId: string | undefined;

  try {
    const body = await request.json();
    const parsed = body as { affiliateId: string; reason?: string };
    affiliateId = parsed.affiliateId;
    const reason = parsed.reason;

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

    if (aff.status !== "approved") {
      log.step("not_blockable", { affiliateId, status: aff.status });
      return NextResponse.json(
        {
          error: "Only approved affiliates can be blocked",
          correlationId: log.correlationId,
        },
        { status: 409 },
      );
    }

    let stripeDeactivated = false;
    if (stripe && aff.stripePromotionCodeId) {
      log.step("deactivating_promotion_code", {
        affiliateId,
        promotionCodeId: aff.stripePromotionCodeId,
      });
      await stripe.promotionCodes.update(aff.stripePromotionCodeId, {
        active: false,
      });
      stripeDeactivated = true;
    } else {
      log.step("promotion_code_deactivation_skipped", {
        affiliateId,
        hasStripe: Boolean(stripe),
        hasPromotionCodeId: Boolean(aff.stripePromotionCodeId),
      });
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

    log.success({ affiliateId, stripeDeactivated });
    return NextResponse.json({ success: true, correlationId: log.correlationId });
  } catch (error) {
    const stripeError = log.error(error, { affiliateId });
    return NextResponse.json(
      {
        error: "Failed to block affiliate",
        correlationId: log.correlationId,
        ...(stripeError
          ? { stripeErrorCode: stripeError.code, message: stripeError.message }
          : {}),
      },
      { status: 500 },
    );
  }
}
