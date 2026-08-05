import type { ActiveSubscriptionSummary } from "@/lib/db/admin-queries";

export function getPixRenewalDisabledReason(
  activeSubscription: ActiveSubscriptionSummary,
): string | null {
  if (
    activeSubscription?.provider === "stripe" &&
    ["active", "trialing", "past_due"].includes(activeSubscription.status)
  ) {
    return "Pix bloqueado: este usuário possui assinatura Stripe ativa.";
  }

  return null;
}
