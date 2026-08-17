import type {
  BillingProvider,
  VindiConsentStatus,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";
import { vindiRecoveryRetryAllowed } from "./recovery";
import {
  canCancelVindiSubscription,
  decideVindiCancel,
  vindiPixAutomaticSchedulingWindowCopy,
  type VindiCancelMode,
} from "./subscription-cancel";

export const VINDI_PROVIDER_LABEL = "Vindi";

export const BILLING_PROVIDER_LABELS: Record<BillingProvider, string> = {
  stripe: "Stripe/cartão",
  mercadopago: "Mercado Pago Pix",
  manual: "Manual",
  vindi: VINDI_PROVIDER_LABEL,
};

export const VINDI_PAYMENT_METHOD_LABELS: Record<
  VindiSubscriptionPaymentMethod,
  string
> = {
  credit_card: "Cartão",
  pix_automatic: "Pix Automático",
  pix_qr: "Pix QR",
};

export const VINDI_CONSENT_STATUS_LABELS: Record<VindiConsentStatus, string> = {
  pending: "Pendente",
  awaiting: "Aguardando autorização do banco",
  authorized: "Autorizado",
  rejected: "Rejeitado",
  expired: "Expirado",
  canceled: "Cancelado",
};

export type BackofficeVindiCancelView = {
  canCancel: boolean;
  mode: VindiCancelMode;
  inSchedulingWindow: boolean;
  copy: {
    cancelUntil: string | null;
    inWindow: string | null;
    reopensOn: string | null;
    consentRemains: string | null;
  };
};

export type BackofficeVindiRecoveryView = {
  chargeId: string;
  billId: string | null;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  failedAt: Date;
  retryAllowed: boolean;
  reissueAllowed: boolean;
};

export type BackofficeVindiSubscriptionView = {
  providerLabel: typeof VINDI_PROVIDER_LABEL;
  paymentMethodLabel: string | null;
  consentLabel: string | null;
  installmentsLabel: string | null;
  nextChargeAt: Date | null;
  vindiSubscriptionId: string | null;
  showStripeIds: false;
  profileTitle: "Usuário";
  cancel: BackofficeVindiCancelView | null;
  recovery: BackofficeVindiRecoveryView | null;
};

export type BackofficeVindiFailedPayment = {
  vindiChargeId: string | null;
  vindiBillId: string | null;
  amount: number;
  currency: string;
  failureReason: string | null;
  createdAt: Date;
};

export function presentBackofficeVindiSubscription(input: {
  subscription: {
    provider: string;
    status: string;
    vindiPaymentMethod?: VindiSubscriptionPaymentMethod | null;
    vindiConsentStatus?: VindiConsentStatus | null;
    vindiSubscriptionId?: string | null;
    commitmentMonths: number;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  expirationDate: Date | null;
  failedPayment: BackofficeVindiFailedPayment | null;
  now?: Date;
}): BackofficeVindiSubscriptionView | null {
  const subscription = input.subscription;
  if (!subscription || subscription.provider !== "vindi") return null;

  const now = input.now ?? new Date();
  const method = subscription.vindiPaymentMethod ?? null;
  const dueAt = input.expirationDate ?? subscription.currentPeriodEnd;
  const decision = decideVindiCancel({
    paymentMethod: method,
    dueAt,
    now,
  });
  const windowCopy =
    method === "pix_automatic" && dueAt
      ? vindiPixAutomaticSchedulingWindowCopy({ dueAt, now })
      : null;
  const canCancel = canCancelVindiSubscription(subscription);

  return {
    providerLabel: VINDI_PROVIDER_LABEL,
    paymentMethodLabel: method ? VINDI_PAYMENT_METHOD_LABELS[method] : null,
    consentLabel:
      method === "pix_automatic" && subscription.vindiConsentStatus
        ? VINDI_CONSENT_STATUS_LABELS[subscription.vindiConsentStatus]
        : null,
    installmentsLabel:
      method === "credit_card" && subscription.commitmentMonths > 0
        ? `${subscription.commitmentMonths}×`
        : null,
    nextChargeAt: dueAt,
    vindiSubscriptionId: subscription.vindiSubscriptionId ?? null,
    showStripeIds: false,
    profileTitle: "Usuário",
    cancel:
      canCancel || subscription.cancelAtPeriodEnd
        ? {
            canCancel,
            mode: subscription.cancelAtPeriodEnd
              ? "cancel_requested"
              : decision.mode,
            inSchedulingWindow:
              subscription.cancelAtPeriodEnd ||
              decision.action === "register_intent",
            copy: {
              cancelUntil: windowCopy?.cancelUntil ?? null,
              inWindow: windowCopy?.inWindow ?? null,
              reopensOn: windowCopy?.reopensOn ?? null,
              consentRemains: windowCopy?.consentRemains ?? null,
            },
          }
        : null,
    recovery: presentVindiRecovery({
      status: subscription.status,
      method,
      failedPayment: input.failedPayment,
    }),
  };
}

function presentVindiRecovery(input: {
  status: string;
  method: VindiSubscriptionPaymentMethod | null;
  failedPayment: BackofficeVindiFailedPayment | null;
}): BackofficeVindiRecoveryView | null {
  if (input.status !== "past_due" && input.status !== "unpaid") return null;
  const failedPayment = input.failedPayment;
  const chargeId = failedPayment?.vindiChargeId;
  if (!failedPayment || !chargeId) return null;

  return {
    chargeId,
    billId: failedPayment.vindiBillId,
    amountCents: failedPayment.amount,
    currency: failedPayment.currency,
    failureReason: failedPayment.failureReason,
    failedAt: failedPayment.createdAt,
    retryAllowed: vindiRecoveryRetryAllowed(input.method),
    reissueAllowed: true,
  };
}

export function billingProviderLabel(
  provider: BillingProvider | string | null | undefined,
): string {
  if (!provider) return "—";
  return (
    BILLING_PROVIDER_LABELS[provider as BillingProvider] ?? provider
  );
}

export function providerExternalId(input: {
  provider: string | null | undefined;
  stripeId?: string | null;
  vindiId?: string | null;
  mercadopagoId?: string | null;
}): string | null {
  if (input.provider === "vindi") return input.vindiId ?? null;
  if (input.provider === "mercadopago") return input.mercadopagoId ?? null;
  return input.stripeId ?? null;
}
