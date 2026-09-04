import type { BillingProvider } from "@/lib/db/schema";
import {
  UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  isKnownBillingProvider,
} from "./finance-provider";
import { getPixRenewalDisabledReason } from "./pix-renewal-policy";
import { canCancelStripeSubscriptionAtPeriodEnd } from "./stripe-subscription-cancel-policy";
import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";

export const BILLING_PROVIDER_LABELS: Record<BillingProvider, string> = {
  stripe: "Stripe/cartão",
  mercadopago: "Mercado Pago Pix",
  manual: "Manual",
};

export function billingProviderLabel(
  provider: BillingProvider | string | null | undefined,
): string {
  if (!provider) return "—";
  if (!isKnownBillingProvider(provider)) {
    return UNCLASSIFIED_FINANCE_PROVIDER_LABEL;
  }
  return BILLING_PROVIDER_LABELS[provider];
}

export function providerExternalId(input: {
  provider: string | null | undefined;
  stripeId?: string | null;
  mercadopagoId?: string | null;
  historicalProviderId?: string | null;
}): string | null {
  if (input.provider === "mercadopago") return input.mercadopagoId ?? null;
  if (input.provider === "stripe") return input.stripeId ?? null;
  return input.historicalProviderId ?? null;
}

export type StripePaymentRecovery = {
  invoiceId: string;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  failedAt: Date;
};

export function decideStripePaymentRecovery(input: {
  subscription: {
    id: string;
    status: string;
    provider?: string | null;
  } | null;
  payments: Array<{
    status: string;
    stripeInvoiceId: string | null;
    subscriptionId: string | null;
    amount: number;
    currency: string;
    failureReason: string | null;
    createdAt: Date;
  }>;
}): StripePaymentRecovery | null {
  const subscription = input.subscription;
  if (!subscription) return null;
  if (subscription.provider && subscription.provider !== "stripe") return null;
  if (subscription.status !== "past_due" && subscription.status !== "unpaid") {
    return null;
  }

  const candidate = input.payments.find(
    (payment) =>
      payment.status === "failed" &&
      payment.stripeInvoiceId !== null &&
      payment.subscriptionId === subscription.id,
  );
  if (!candidate?.stripeInvoiceId) return null;

  return {
    invoiceId: candidate.stripeInvoiceId,
    amountCents: candidate.amount,
    currency: candidate.currency,
    failureReason: candidate.failureReason,
    failedAt: candidate.createdAt,
  };
}

export type SubscriptionPanelActions = {
  stripeRecovery: boolean;
  stripeCancel: boolean;
  pixRenewalAllowed: boolean;
};

export function decideSubscriptionPanelActions(input: {
  subscription: NonNullable<ActiveSubscriptionSummary>;
  payments: Array<{
    status: string;
    stripeInvoiceId: string | null;
    subscriptionId: string | null;
    amount: number;
    currency: string;
    failureReason: string | null;
    createdAt: Date;
  }>;
}): SubscriptionPanelActions {
  return {
    stripeRecovery: decideStripePaymentRecovery(input) !== null,
    stripeCancel: canCancelStripeSubscriptionAtPeriodEnd(input.subscription),
    pixRenewalAllowed: getPixRenewalDisabledReason(input.subscription) === null,
  };
}
