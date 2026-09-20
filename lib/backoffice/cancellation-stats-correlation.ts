import type { BillingProvider } from "@/lib/db/schema";

export type CancellationStatsBenefitCorrelation = {
  id: string;
  providerInvoiceId: string | null;
  providerPaymentId: string | null;
};

export type CancellationStatsPaymentCorrelation = {
  userId: string;
  subscriptionId: string | null;
  provider: BillingProvider | string;
  purpose: string | null;
  status: string;
  paidAt: Date | null;
  retentionBenefitId: string | null;
  mercadopagoPaymentId: string | null;
  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  externalId: string | null;
};

const BILLING_PURPOSES = new Set(["subscription", "legacy_renewal"]);

export function isConfirmedCancellationRenewalPayment(input: {
  provider: BillingProvider | string;
  subscriptionId: string | null;
  benefit: CancellationStatsBenefitCorrelation | undefined;
  payment: CancellationStatsPaymentCorrelation;
  asOf: Date;
}) {
  const { provider, subscriptionId, benefit, payment, asOf } = input;
  if (payment.provider !== provider) return false;
  if (payment.subscriptionId && payment.subscriptionId !== subscriptionId) return false;
  if (
    payment.status !== "succeeded" ||
    (payment.purpose !== null && !BILLING_PURPOSES.has(payment.purpose))
  ) {
    return false;
  }
  if (payment.paidAt == null || payment.paidAt > asOf) return false;
  if (!benefit) return false;

  if (provider === "mercadopago") {
    return (
      payment.retentionBenefitId === benefit.id ||
      (benefit.providerPaymentId !== null &&
        payment.mercadopagoPaymentId === benefit.providerPaymentId)
    );
  }
  if (provider === "stripe") {
    return Boolean(
      (benefit.providerInvoiceId && payment.stripeInvoiceId === benefit.providerInvoiceId) ||
        (benefit.providerPaymentId &&
          [payment.externalId, payment.stripePaymentIntentId, payment.stripeChargeId].includes(
            benefit.providerPaymentId,
          )),
    );
  }
  return payment.retentionBenefitId === benefit.id;
}
