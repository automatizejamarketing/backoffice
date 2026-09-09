import type {
  PendingPlanChange,
  PlanType,
  Subscription,
  SubscriptionStatus,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";

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

export type StatusTone = "success" | "warning" | "destructive" | "neutral";

export interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  hint?: string;
}

export type AccessState =
  | { kind: "active"; expirationDate: Date; daysLeft: number }
  | { kind: "expired"; expirationDate: Date; daysAgo: number }
  | { kind: "missing"; expirationDate: null };

/**
 * Whether the account can use the product. This is decided ONLY by
 * `users.expiration_date`: Pix and manual grants have no "subscription status"
 * (each Pix is a one-off charge that extends the date), and for Stripe the
 * provider decides whether it keeps charging, not whether the user gets in.
 */
export function getAccessState(
  expirationDate: Date | string | null | undefined,
  now: Date = new Date(),
): AccessState {
  if (!expirationDate) return { kind: "missing", expirationDate: null };
  const exp = new Date(expirationDate);
  if (Number.isNaN(exp.getTime())) return { kind: "missing", expirationDate: null };
  const days = calendarDaysBetween(now, exp);
  if (exp.getTime() <= now.getTime()) {
    return { kind: "expired", expirationDate: exp, daysAgo: Math.abs(days) };
  }
  return { kind: "active", expirationDate: exp, daysLeft: days };
}

export function getAccessBadgeProps(
  expirationDate: Date | string | null | undefined,
  now: Date = new Date(),
): StatusBadgeProps {
  const state = getAccessState(expirationDate, now);
  if (state.kind === "missing") {
    return { tone: "neutral", label: "Sem data de acesso" };
  }
  if (state.kind === "expired") {
    return {
      tone: "destructive",
      label: `Vencido em ${formatShortDate(state.expirationDate)}`,
      hint:
        state.daysAgo === 0 ? "venceu hoje" : `há ${state.daysAgo} ${pluralDays(state.daysAgo)}`,
    };
  }
  return {
    tone: state.daysLeft <= 3 ? "warning" : "success",
    label: `Ativo até ${formatShortDate(state.expirationDate)}`,
    hint:
      state.daysLeft === 0
        ? "vence hoje"
        : `em ${state.daysLeft} ${pluralDays(state.daysLeft)}`,
  };
}

const STRIPE_STATUS_LABELS: Record<SubscriptionStatus, string> = {
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
 * Billing state as Stripe sees it. Only meaningful for Stripe rows: it says
 * whether Stripe still charges the card, never whether the user has access.
 */
export function getStripeBillingBadgeProps(
  subscription: Pick<
    Subscription,
    "status" | "cancelAtPeriodEnd" | "currentPeriodEnd"
  >,
): StatusBadgeProps {
  const { status, cancelAtPeriodEnd, currentPeriodEnd } = subscription;
  const label = STRIPE_STATUS_LABELS[status] ?? status;
  let tone: StatusTone = "neutral";
  if (status === "active") tone = "success";
  else if (status === "trialing") tone = "success";
  else if (status === "past_due" || status === "unpaid") tone = "destructive";

  let hint: string | undefined;
  if (cancelAtPeriodEnd && currentPeriodEnd) {
    hint = `cancela em ${formatShortDate(currentPeriodEnd)}`;
    tone = "warning";
  } else if (status === "trialing" && currentPeriodEnd) {
    hint = `trial até ${formatShortDate(currentPeriodEnd)}`;
  } else if (status === "active" && currentPeriodEnd) {
    hint = `próxima cobrança ${formatShortDate(currentPeriodEnd)}`;
  }
  return { tone, label, hint };
}

/**
 * One badge for lists and exports: access first, Stripe billing as a hint.
 * Pix/manual rows add nothing, their subscription status is not information.
 */
export function getAccountStatusBadge(
  expirationDate: Date | string | null | undefined,
  subscription:
    | Pick<
        Subscription,
        "provider" | "status" | "cancelAtPeriodEnd" | "currentPeriodEnd"
      >
    | null
    | undefined,
  now: Date = new Date(),
): StatusBadgeProps {
  const access = getAccessBadgeProps(expirationDate, now);
  if (!subscription || subscription.provider !== "stripe") return access;
  const billing = getStripeBillingBadgeProps(subscription);
  const stripeHint =
    subscription.cancelAtPeriodEnd && billing.hint
      ? `Stripe: ${billing.label.toLowerCase()}, ${billing.hint}`
      : `Stripe: ${billing.label.toLowerCase()}`;
  return {
    ...access,
    hint: [access.hint, stripeHint].filter(Boolean).join(" · "),
  };
}

export type StripeAccessMismatch = {
  kind: "expired" | "missing";
  statusLabel: string;
  expirationDate: Date | null;
};

/**
 * Stripe keeps charging (or trialing) but the user has no access. That is a
 * real inconsistency worth a webhook check. Pix/manual never produce it: their
 * subscription row is not a source of truth for anything.
 */
export function getStripeAccessMismatch(
  subscription: Pick<Subscription, "provider" | "status"> | null | undefined,
  expirationDate: Date | string | null | undefined,
  now: Date = new Date(),
): StripeAccessMismatch | null {
  if (!subscription || subscription.provider !== "stripe") return null;
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return null;
  }
  const access = getAccessState(expirationDate, now);
  if (access.kind === "active") return null;
  return {
    kind: access.kind,
    statusLabel: STRIPE_STATUS_LABELS[subscription.status],
    expirationDate: access.expirationDate,
  };
}

function calendarDaysBetween(from: Date, to: Date): number {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const [fy, fm, fd] = key(from).split("-").map(Number);
  const [ty, tm, td] = key(to).split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

function pluralDays(n: number): string {
  return n === 1 ? "dia" : "dias";
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
  return formatNumericDateInSaoPaulo(value);
}
