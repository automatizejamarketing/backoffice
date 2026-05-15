import type {
  PendingPlanChange,
  PlanType,
  Subscription,
  SubscriptionStatus,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";

const STATUS_PRIORITY: Record<SubscriptionStatus, number> = {
  active: 6,
  trialing: 5,
  past_due: 4,
  incomplete: 3,
  unpaid: 2,
  canceled: 1,
  incomplete_expired: 0,
  expired: 0,
};

/**
 * Picks the most relevant subscription for a user from a list. Priority:
 * active > trialing > past_due > incomplete > unpaid > canceled > incomplete_expired.
 * Within the same status, prefers the most recently created.
 */
export function pickActiveSubscription<
  T extends Pick<Subscription, "status" | "createdAt">,
>(subscriptions: T[]): T | null {
  if (!subscriptions || subscriptions.length === 0) return null;
  const sorted = [...subscriptions].sort((a, b) => {
    const diff = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
    if (diff !== 0) return diff;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
  return sorted[0] ?? null;
}

export type StatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  label: string;
  hint?: string;
  className?: string;
}

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Ativa",
  trialing: "Em trial",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
  unpaid: "Não paga",
  incomplete: "Incompleta",
  incomplete_expired: "Incompleta expirada",
  expired: "Expirada",
};

/**
 * Returns props for a status badge given subscription state. The optional
 * expirationDate is consulted to flag access-expired users when no live
 * subscription is present (status === "canceled" + expired access).
 */
export function getStatusBadgeProps(
  status: SubscriptionStatus | null | undefined,
  expirationDate: Date | string | null | undefined,
  cancelAtPeriodEnd: boolean | null | undefined,
  currentPeriodEnd?: Date | string | null,
): StatusBadgeProps {
  const exp = expirationDate ? new Date(expirationDate) : null;
  const accessExpired = exp ? exp.getTime() < Date.now() : false;

  if (!status) {
    return {
      variant: accessExpired ? "destructive" : "outline",
      label: accessExpired ? "Acesso expirado" : "Sem assinatura",
    };
  }

  const label = STATUS_LABELS[status] ?? status;
  let variant: StatusBadgeVariant;
  switch (status) {
    case "active":
      variant = "default";
      break;
    case "trialing":
      variant = "secondary";
      break;
    case "past_due":
    case "unpaid":
      variant = "destructive";
      break;
    case "incomplete":
    case "incomplete_expired":
    case "expired":
      variant = "outline";
      break;
    case "canceled":
      variant = accessExpired ? "destructive" : "secondary";
      break;
    default:
      variant = "outline";
  }

  let hint: string | undefined;
  if (cancelAtPeriodEnd && currentPeriodEnd) {
    hint = `Cancelará em ${formatShortDate(currentPeriodEnd)}`;
  } else if (status === "trialing" && currentPeriodEnd) {
    hint = `Trial até ${formatShortDate(currentPeriodEnd)}`;
  } else if (status === "canceled" && exp && !accessExpired) {
    hint = `Acesso até ${formatShortDate(exp)}`;
  }

  return { variant, label, hint };
}

export function formatPlanLabel(planType: PlanType | null | undefined): string {
  if (!planType) return "—";
  return PLAN_DEFINITIONS[planType]?.name ?? planType;
}

/**
 * Describes the upcoming subscription change for the admin viewer.
 *
 * Cases:
 *  - pendingPlanChange (status="pending"): explicit scheduled change wins.
 *  - status="trialing": after trial ends, the same subscription's planType
 *    becomes the paid plan (frontend stores future paid plan on the trial row).
 *  - cancelAtPeriodEnd: subscription will end at currentPeriodEnd.
 *  - otherwise: null (no upcoming change).
 */
export function describeUpcomingChange(
  subscription:
    | (Pick<
        Subscription,
        "status" | "planType" | "currentPeriodEnd" | "cancelAtPeriodEnd"
      > & {
        currentPeriodEnd: Date | string | null;
      })
    | null,
  pendingPlanChange: Pick<
    PendingPlanChange,
    "newPlanType" | "currentPlanType" | "effectiveDate" | "changeType"
  > | null,
): {
  kind: "pending_change" | "trial_to_paid" | "cancel_at_period_end";
  label: string;
  detail: string;
} | null {
  if (pendingPlanChange) {
    const verb =
      pendingPlanChange.changeType === "upgrade"
        ? "Upgrade"
        : pendingPlanChange.changeType === "downgrade"
          ? "Downgrade"
          : "Mudança";
    return {
      kind: "pending_change",
      label: `${verb} agendado para ${formatPlanLabel(pendingPlanChange.newPlanType)}`,
      detail: `Em ${formatShortDate(pendingPlanChange.effectiveDate)} (saindo de ${formatPlanLabel(pendingPlanChange.currentPlanType)}).`,
    };
  }

  if (!subscription) return null;

  if (subscription.status === "trialing" && subscription.currentPeriodEnd) {
    return {
      kind: "trial_to_paid",
      label: `Após o trial: ${formatPlanLabel(subscription.planType)}`,
      detail: `Cobrança agendada para ${formatShortDate(subscription.currentPeriodEnd)}.`,
    };
  }

  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
    return {
      kind: "cancel_at_period_end",
      label: "Cancelamento agendado",
      detail: `A assinatura será encerrada em ${formatShortDate(subscription.currentPeriodEnd)}.`,
    };
  }

  return null;
}

function formatShortDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
