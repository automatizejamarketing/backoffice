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

  constructor(message = "Usuário tem assinatura Stripe ativa.") {
    super(message);
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
  return subscriptions.some((row) => stripeBlocksPixRenewal(row) ||
    (row.provider === "efi" && LIVE_STRIPE_STATUSES.includes(row.status as SubscriptionStatus)));
}

export function getPixRenewalDisabledReason(
  activeSubscription: ActiveSubscriptionSummary,
): string | null {
  if (!activeSubscription) return null;
  if (activeSubscription.provider === "efi" && LIVE_STRIPE_STATUSES.includes(activeSubscription.status)) return "Pix avulso bloqueado: este usuário possui Pix Automático ativo.";
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
    throw new BackofficePixStripeBlockError(subscriptions.some(stripeBlocksPixRenewal)
      ? "Usuário tem assinatura Stripe ativa." : "Usuário tem Pix Automático ativo. Cancele a autorização antes de gerar Pix avulso.");
  }
}
