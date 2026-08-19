import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";

const LIVE_STRIPE_STATUSES = ["active", "trialing", "past_due"] as const;

export function stripeBlocksPixRenewal(subscription: {
  provider?: string | null;
  status?: string | null;
} | null | undefined): boolean {
  if (!subscription) return false;
  if (subscription.provider !== "stripe") return false;
  return LIVE_STRIPE_STATUSES.some((status) => status === subscription.status);
}

export function getPixRenewalDisabledReason(
  activeSubscription: ActiveSubscriptionSummary,
): string | null {
  if (stripeBlocksPixRenewal(activeSubscription)) {
    return "Pix bloqueado: este usuário possui assinatura Stripe ativa.";
  }

  return null;
}
