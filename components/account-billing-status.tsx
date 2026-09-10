import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadgeWithHint } from "@/components/status-badge";
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
  type PixLinkState,
} from "@/lib/backoffice/pix-link-view";
import { billingProviderLabel } from "@/lib/backoffice/subscription-panel-policy";
import {
  formatPlanLabel,
  getAccessBadgeProps,
  getAccessState,
  getStripeAccessMismatch,
  getStripeBillingBadgeProps,
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

interface Props {
  expirationDate: Date | string | null | undefined;
  subscription: BillingSubscriptionView | null;
  latestPixCharge: LatestPixCharge | null;
  now?: Date;
}

/**
 * Two independent facts, side by side: whether the account can use the product
 * (expiration date only) and what the billing side looks like (Stripe status,
 * or the latest Pix charge). The old "status no provedor" badge mixed the two
 * and read "Ativa" for expired Pix customers.
 */
export function AccountBillingStatus({
  expirationDate,
  subscription,
  latestPixCharge,
  now = new Date(),
}: Props) {
  const access = getAccessBadgeProps(expirationDate, now);

  return (
    <div className="space-y-4">
      <AccountAccessNotice
        expirationDate={expirationDate}
        subscription={subscription}
        latestPixCharge={latestPixCharge}
        now={now}
      />
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Field label="Acesso">
          <StatusBadgeWithHint badge={access} />
        </Field>
        <BillingStatusField
          subscription={subscription}
          latestPixCharge={latestPixCharge}
        />
      </div>
    </div>
  );
}

export function BillingStatusField({
  subscription,
  latestPixCharge,
}: {
  subscription: BillingSubscriptionView | null;
  latestPixCharge: LatestPixCharge | null;
}) {
  const billing = describeBilling(subscription, latestPixCharge);
  return (
    <Field label="Cobrança">
      <p className="text-sm font-medium text-foreground">{billing.title}</p>
      {billing.badge ? (
        <StatusBadgeWithHint badge={billing.badge} className="mt-1" />
      ) : (
        <p className="text-xs text-muted-foreground">{billing.empty}</p>
      )}
    </Field>
  );
}

function describeBilling(
  subscription: BillingSubscriptionView | null,
  latestPixCharge: LatestPixCharge | null,
): { title: string; badge: StatusBadgeProps | null; empty?: string } {
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

export function AccountAccessNotice({
  expirationDate,
  subscription,
  latestPixCharge,
  now = new Date(),
}: Props) {
  const mismatch = getStripeAccessMismatch(subscription, expirationDate, now);
  if (mismatch) {
    const detail =
      mismatch.kind === "expired" && mismatch.expirationDate
        ? `mas o acesso venceu em ${formatDateInSaoPaulo(mismatch.expirationDate)}.`
        : "mas o acesso não tem data definida.";
    return (
      <Alert variant="warning">
        <TriangleAlert className="size-4" />
        <AlertTitle>Cobrança e acesso divergentes</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          O Stripe ainda considera a assinatura {mismatch.statusLabel.toLowerCase()},{" "}
          {detail} Confira o último pagamento e os webhooks antes de alterar a
          data manualmente.
        </AlertDescription>
      </Alert>
    );
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

  return (
    <Alert variant="warning">
      <TriangleAlert className="size-4" />
      <AlertTitle>Renovação pendente</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        O acesso venceu em {since}. {detail}
      </AlertDescription>
    </Alert>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
