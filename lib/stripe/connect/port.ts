/** Porta mínima do Stripe Connect usada pelo backoffice na Cobrança Direta. */
export type StripeConnectRefundClient = {
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
