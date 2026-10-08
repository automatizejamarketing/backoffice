import type { PlanType, Subscription } from "@/lib/db/schema";
import {
  formatDateInSaoPaulo,
  formatNumericDateInSaoPaulo,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import { formatBRLFromCentavos } from "@/lib/backoffice/finance-format";
import {
  PIX_LINK_STATE_LABELS,
  PIX_LINK_STATE_TONES,
  pickLatestPixCharge,
  type PixLinkState,
} from "@/lib/backoffice/pix-link-view";
import { billingProviderLabel } from "@/lib/backoffice/subscription-panel-policy";
import {
  formatPlanLabel,
  getAccessBadgeProps,
  getAccessState,
  getStripeAccessMismatch,
  getStripeBillingBadgeProps,
  pickActiveSubscription,
  type StatusBadgeProps,
} from "@/lib/subscriptions/derive";

export type BillingSubscriptionView = Pick<
  Subscription,
  "provider" | "status" | "planType" | "cancelAtPeriodEnd" | "currentPeriodEnd"
>;

export type LatestPixCharge = {
  state: PixLinkState;
  link: {
    planType: PlanType;
    amount: number;
    createdAt: Date | string;
    expiresAt: Date | string;
  };
};

export type BillingDescription = {
  title: string;
  badge: StatusBadgeProps | null;
  empty?: string;
};

export type AccessNotice = { title: string; detail: string };

/**
 * What the billing side looks like: Stripe status, or the latest Pix charge.
 * Says nothing about access, which is the expiration date's job.
 */
export function describeBilling(
  subscription: BillingSubscriptionView | null,
  latestPixCharge: LatestPixCharge | null,
): BillingDescription {
  if (subscription?.provider === "stripe") {
    return {
      title: `${billingProviderLabel("stripe")} · ${formatPlanLabel(subscription.planType)}`,
      badge: getStripeBillingBadgeProps(subscription),
    };
  }

  const plan = subscription
    ? formatPlanLabel(subscription.planType)
    : latestPixCharge
      ? formatPlanLabel(latestPixCharge.link.planType)
      : null;
  const providerLabel =
    subscription?.provider === "manual"
      ? billingProviderLabel("manual")
      : `${billingProviderLabel("mercadopago")} · pré-pago`;
  const title = plan ? `${providerLabel} · ${plan}` : providerLabel;

  if (!latestPixCharge) {
    return {
      title: subscription ? title : "Sem cobrança registrada",
      badge: null,
      empty:
        subscription?.provider === "manual"
          ? "Acesso liberado manualmente."
          : "Nenhum Pix gerado para este cliente.",
    };
  }

  const { link, state } = latestPixCharge;
  const amount = formatBRLFromCentavos(link.amount);
  const hint =
    state === "awaiting"
      ? `${amount} · vence ${formatShortDateTimeInSaoPaulo(link.expiresAt)}`
      : `${amount} · gerado ${formatNumericDateInSaoPaulo(link.createdAt)}`;

  return {
    title,
    badge: {
      tone: PIX_LINK_STATE_TONES[state],
      label: `Pix: ${PIX_LINK_STATE_LABELS[state].toLowerCase()}`,
      hint,
    },
  };
}

/**
 * The warning worth an operator's attention, if any: Stripe charging an
 * account without access, or a Pix/manual account whose access ran out.
 */
export function describeAccessNotice(
  expirationDate: Date | string | null | undefined,
  subscription: BillingSubscriptionView | null,
  latestPixCharge: LatestPixCharge | null,
  now: Date = new Date(),
): AccessNotice | null {
  const mismatch = getStripeAccessMismatch(subscription, expirationDate, now);
  if (mismatch) {
    const detail =
      mismatch.kind === "expired" && mismatch.expirationDate
        ? `mas o acesso venceu em ${formatDateInSaoPaulo(mismatch.expirationDate)}.`
        : "mas o acesso não tem data definida.";
    return {
      title: "Cobrança e acesso divergentes",
      detail: `O Stripe ainda considera a assinatura ${mismatch.statusLabel.toLowerCase()}, ${detail} Confira o último pagamento e os webhooks antes de alterar a data manualmente.`,
    };
  }

  if (subscription?.provider === "stripe") return null;

  const access = getAccessState(expirationDate, now);
  if (access.kind !== "expired") return null;

  const since = formatDateInSaoPaulo(access.expirationDate);
  let detail: string;
  if (latestPixCharge?.state === "awaiting") {
    const { link } = latestPixCharge;
    detail = `Há um Pix de ${formatBRLFromCentavos(link.amount)} aguardando pagamento até ${formatShortDateTimeInSaoPaulo(link.expiresAt)}. O acesso volta assim que o pagamento for aprovado.`;
  } else if (latestPixCharge?.state === "expired_unpaid") {
    const { link } = latestPixCharge;
    detail = `O Pix de ${formatBRLFromCentavos(link.amount)} gerado em ${formatNumericDateInSaoPaulo(link.createdAt)} expirou sem pagamento. Gere um novo Pix para o cliente renovar.`;
  } else {
    detail = "Não há Pix em aberto. Gere um novo Pix para o cliente renovar.";
  }

  return {
    title: "Renovação pendente",
    detail: `O acesso venceu em ${since}. ${detail}`,
  };
}

export type AccessSummary = {
  access: StatusBadgeProps;
  billing: BillingDescription;
  notice: AccessNotice | null;
};

/**
 * The read-only access + billing summary shown outside the subscription tab
 * (the marketing page). Same facts as the tab's "Acesso e cobrança" block,
 * already reduced to display strings so the caller ships no raw billing data.
 */
export function buildAccessSummary(input: {
  expirationDate: Date | string | null | undefined;
  subscriptions: Array<BillingSubscriptionView & Pick<Subscription, "createdAt">>;
  pixLinks: Array<
    LatestPixCharge["link"] & { status: string }
  >;
  now?: Date;
}): AccessSummary {
  const now = input.now ?? new Date();
  const subscription = pickActiveSubscription(input.subscriptions);
  const latestPixCharge = pickLatestPixCharge(input.pixLinks, now);

  return {
    access: getAccessBadgeProps(input.expirationDate, now),
    billing: describeBilling(subscription, latestPixCharge),
    notice: describeAccessNotice(
      input.expirationDate,
      subscription,
      latestPixCharge,
      now,
    ),
  };
}
