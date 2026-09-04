import "server-only";

import { stripe } from "@/lib/stripe";
import type { StripeConnectRefundClient } from "./port";

export function createStripeConnectRefundClient(): StripeConnectRefundClient {
  const stripeClient = stripe;
  if (!stripeClient) {
    throw new Error("Stripe is not configured");
  }

  return {
    refunds: {
      create: async (params, options) => {
        const requestOptions = options?.stripeAccount
          ? { stripeAccount: options.stripeAccount }
          : undefined;
        const refund = await stripeClient.refunds.create(
          params,
          requestOptions,
        );
        return { id: refund.id };
      },
    },
  };
}
