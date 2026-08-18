import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";
import type { BillingProvider, SubscriptionStatus } from "@/lib/db/schema";

const LIVE_STRIPE_STATUSES: readonly SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
];

export const PIX_RENEWAL_STRIPE_BLOCK_MESSAGE =
  "Pix bloqueado: este usuário possui assinatura Stripe ativa.";

export class BackofficePixStripeBlockError extends Error {
  readonly code = "stripe_active" as const;

  constructor() {
    super("Usuário tem assinatura Stripe ativa.");
    this.name = "BackofficePixStripeBlockError";
  }
}

function billingProviderOf(
  provider: BillingProvider | string | null | undefined,
): BillingProvider | string {
  return provider ?? "stripe";
}

export function stripeBlocksPixRenewal(subscription: {
  provider?: BillingProvider | string | null;
  status?: SubscriptionStatus | string | null;
}): boolean {
  if (billingProviderOf(subscription.provider) !== "stripe") return false;
  return LIVE_STRIPE_STATUSES.includes(
    subscription.status as SubscriptionStatus,
  );
}

export function subscriptionsBlockPixRenewal(
  subscriptions: Array<{
    provider?: BillingProvider | string | null;
    status?: SubscriptionStatus | string | null;
  }>,
): boolean {
  return subscriptions.some(stripeBlocksPixRenewal);
}

export function getPixRenewalDisabledReason(
  activeSubscription: ActiveSubscriptionSummary,
): string | null {
  if (!activeSubscription) return null;
  if (stripeBlocksPixRenewal(activeSubscription)) {
    return PIX_RENEWAL_STRIPE_BLOCK_MESSAGE;
  }
  return null;
}

export function assertPixRenewalAllowed(
  subscriptions: Array<{
    provider?: BillingProvider | string | null;
    status?: SubscriptionStatus | string | null;
  }>,
): void {
  if (subscriptionsBlockPixRenewal(subscriptions)) {
    throw new BackofficePixStripeBlockError();
  }
}
