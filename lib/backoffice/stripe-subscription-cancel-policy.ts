import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";

const CANCELABLE_STRIPE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

export function canCancelStripeSubscriptionAtPeriodEnd(
  activeSubscription: ActiveSubscriptionSummary,
): boolean {
  if (!activeSubscription) return false;
  if (activeSubscription.provider !== "stripe") return false;
  if (!activeSubscription.stripeSubscriptionId) return false;
  if (activeSubscription.cancelAtPeriodEnd) return false;

  return CANCELABLE_STRIPE_STATUSES.has(activeSubscription.status);
}

export function getStripeCancellationExpirationDate(
  activeSubscription: ActiveSubscriptionSummary,
): Date | null {
  return activeSubscription?.currentPeriodEnd ?? null;
}
