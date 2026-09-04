import "server-only";

import { stripe } from "@/lib/stripe";
import type { StripeConnectClient, StripeConnectRefundClient } from "./port";

export function createStripeConnectClient(): StripeConnectClient {
  const stripeClient = stripe;
  if (!stripeClient) {
    throw new Error("Stripe is not configured");
  }

  return {
    accounts: {
      retrieve: async (accountId) => {
        const account = await stripeClient.accounts.retrieve(accountId);
        return {
          id: account.id,
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          details_submitted: account.details_submitted ?? false,
        };
      },
    },
    accountLinks: {
      create: async (params) => {
        const link = await stripeClient.accountLinks.create(params);
        return { url: link.url };
      },
    },
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

export function createStripeConnectRefundClient(): StripeConnectRefundClient {
  return { refunds: createStripeConnectClient().refunds };
}
