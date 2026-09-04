/** Visão mínima de uma Conta Stripe do Expert usada pelo espelho local. */
export type StripeConnectAccountView = {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export type StripeConnectAccountLinkCreateParams = {
  account: string;
  type: "account_onboarding";
  return_url: string;
  refresh_url: string;
};

/** Porta mínima do Stripe Connect usada pelo backoffice. */
export type StripeConnectClient = {
  accounts: {
    retrieve: (accountId: string) => Promise<StripeConnectAccountView>;
  };
  accountLinks: {
    create: (
      params: StripeConnectAccountLinkCreateParams,
    ) => Promise<{ url: string }>;
  };
  refunds: {
    create: (
      params: {
        payment_intent: string;
        amount?: number;
        refund_application_fee?: boolean;
      },
      options?: { stripeAccount: string },
    ) => Promise<{ id: string }>;
  };
};

export type StripeConnectRefundClient = Pick<StripeConnectClient, "refunds">;
