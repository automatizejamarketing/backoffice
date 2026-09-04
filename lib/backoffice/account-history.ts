import type {
  BillingProvider,
  PaymentStatus,
  PlanType,
  SubscriptionEventType,
  SubscriptionStatus,
} from "@/lib/db/schema";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { formatPlanLabel } from "@/lib/subscriptions/derive";

const PAYMENT_NEAR_EVENT_MS = 5 * 60 * 1000;
const SIGNUP_VERIFY_MS = 60 * 1000;

const SUBSCRIPTION_EVENT_TITLES: Record<SubscriptionEventType, string> = {
  subscribed: "Assinatura iniciada",
  renewed: "Assinatura renovada",
  upgraded: "Upgrade de plano",
  downgraded: "Downgrade de plano",
  plan_changed: "Mudança de plano",
  canceled: "Cancelou a assinatura",
  reactivated: "Assinatura reativada",
  expired: "Assinatura expirada",
  payment_failed: "Pagamento falhou",
  payment_recovered: "Pagamento recuperado",
};

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe/cartão",
  mercadopago: "Mercado Pago Pix",
  manual: "Manual",
  vindi: "sem classificação",
};

export type AccountHistoryKind =
  | "created"
  | "trial"
  | "email_verified"
  | "payment"
  | "subscription_event"
  | "admin_expiration";

export type AccountHistoryItem =
  | { id: string; kind: "created"; at: Date }
  | { id: string; kind: "trial"; at: Date }
  | { id: string; kind: "email_verified"; at: Date }
  | {
      id: string;
      kind: "payment";
      at: Date;
      planType: PlanType;
      amount: number;
      currency: string;
      provider: BillingProvider | string;
      status: PaymentStatus;
    }
  | {
      id: string;
      kind: "subscription_event";
      at: Date;
      eventType: SubscriptionEventType;
      fromPlan: PlanType | null;
      toPlan: PlanType | null;
    }
  | {
      id: string;
      kind: "admin_expiration";
      at: Date;
      adminEmail: string;
      oldValue: string | null;
      newValue: string;
    };

export type AccountHistoryInput = {
  userId: string;
  createdAt: Date | string | null;
  emailVerified: Date | string | null;
  trialGrants: Array<{ id: string; createdAt: Date | string }>;
  payments: Array<{
    id: string;
    status: PaymentStatus;
    paidAt: Date | string | null;
    createdAt: Date | string;
    planType: PlanType;
    amount: number;
    currency: string;
    provider: BillingProvider | string;
  }>;
  events: Array<{
    id: string;
    eventType: SubscriptionEventType;
    fromPlan: PlanType | null;
    toPlan: PlanType | null;
    createdAt: Date | string;
  }>;
  expirationAudits: Array<{
    id: string;
    adminEmail: string;
    oldValue: string | null;
    newValue: string;
    createdAt: Date | string;
  }>;
  subscriptions?: Array<{
    id: string;
    status: SubscriptionStatus;
    planType: PlanType;
    createdAt: Date | string;
    canceledAt: Date | string | null;
  }>;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function buildAccountHistory(
  input: AccountHistoryInput,
): AccountHistoryItem[] {
  const items: AccountHistoryItem[] = [];
  const subscriptions = input.subscriptions ?? [];
  const createdAt = input.createdAt
    ? toDate(input.createdAt)
    : input.emailVerified
      ? toDate(input.emailVerified)
      : null;

  if (createdAt && isValidDate(createdAt)) {
    items.push({
      id: `created:${input.userId}`,
      kind: "created",
      at: createdAt,
    });
  }

  if (input.emailVerified) {
    const verifiedAt = toDate(input.emailVerified);
    const tooCloseToSignup =
      createdAt !== null &&
      Math.abs(verifiedAt.getTime() - createdAt.getTime()) < SIGNUP_VERIFY_MS;
    if (!tooCloseToSignup && isValidDate(verifiedAt)) {
      items.push({
        id: `verified:${input.userId}`,
        kind: "email_verified",
        at: verifiedAt,
      });
    }
  }

  for (const grant of input.trialGrants) {
    const at = toDate(grant.createdAt);
    if (!isValidDate(at)) continue;
    items.push({
      id: `trial:${grant.id}`,
      kind: "trial",
      at,
    });
  }

  if (input.trialGrants.length === 0) {
    for (const sub of subscriptions) {
      if (sub.status !== "trialing") continue;
      const at = toDate(sub.createdAt);
      if (!isValidDate(at)) continue;
      items.push({
        id: `trial:${sub.id}`,
        kind: "trial",
        at,
      });
    }
  }

  const paymentTimes: number[] = [];
  for (const payment of input.payments) {
    if (payment.status === "pending") continue;
    const at = toDate(payment.paidAt ?? payment.createdAt);
    if (!isValidDate(at)) continue;
    if (payment.status === "succeeded") {
      paymentTimes.push(at.getTime());
    }
    items.push({
      id: `payment:${payment.id}`,
      kind: "payment",
      at,
      planType: payment.planType,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      status: payment.status,
    });
  }

  for (const event of input.events) {
    const at = toDate(event.createdAt);
    if (!isValidDate(at)) continue;
    const nearPayment =
      (event.eventType === "subscribed" || event.eventType === "renewed") &&
      paymentTimes.some(
        (time) => Math.abs(time - at.getTime()) <= PAYMENT_NEAR_EVENT_MS,
      );
    if (nearPayment) continue;
    items.push({
      id: `event:${event.id}`,
      kind: "subscription_event",
      at,
      eventType: event.eventType,
      fromPlan: event.fromPlan,
      toPlan: event.toPlan,
    });
  }

  const hasCanceledEvent = input.events.some(
    (event) => event.eventType === "canceled",
  );
  if (!hasCanceledEvent) {
    for (const sub of subscriptions) {
      if (!sub.canceledAt) continue;
      const at = toDate(sub.canceledAt);
      if (!isValidDate(at)) continue;
      items.push({
        id: `event:sub-cancel:${sub.id}`,
        kind: "subscription_event",
        at,
        eventType: "canceled",
        fromPlan: sub.planType,
        toPlan: null,
      });
    }
  }

  for (const audit of input.expirationAudits) {
    const at = toDate(audit.createdAt);
    if (!isValidDate(at)) continue;
    items.push({
      id: `audit:${audit.id}`,
      kind: "admin_expiration",
      at,
      adminEmail: audit.adminEmail,
      oldValue: audit.oldValue,
      newValue: audit.newValue,
    });
  }

  return items
    .filter((item) => isValidDate(item.at))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function describeAccountHistoryItem(item: AccountHistoryItem): {
  title: string;
  detail: string | null;
} {
  switch (item.kind) {
    case "created":
      return { title: "Criou a conta", detail: null };
    case "trial":
      return { title: "Ativou o trial", detail: null };
    case "email_verified":
      return { title: "Ativou a conta", detail: "E-mail verificado" };
    case "payment": {
      const plan = formatPlanLabel(item.planType);
      const money = formatMoney(item.amount, item.currency);
      const provider = PROVIDER_LABELS[item.provider] ?? item.provider;
      if (item.status === "succeeded") {
        return {
          title: "Pagamento realizado — aumento da data de expiração",
          detail: `${plan} · ${money} · ${provider}`,
        };
      }
      if (item.status === "failed") {
        return {
          title: "Pagamento falhou",
          detail: `${plan} · ${money} · ${provider}`,
        };
      }
      return {
        title: "Pagamento reembolsado",
        detail: `${plan} · ${money} · ${provider}`,
      };
    }
    case "subscription_event": {
      const title = SUBSCRIPTION_EVENT_TITLES[item.eventType];
      if (item.fromPlan || item.toPlan) {
        const from = item.fromPlan ? formatPlanLabel(item.fromPlan) : "—";
        const to = item.toPlan ? formatPlanLabel(item.toPlan) : "—";
        return { title, detail: `${from} → ${to}` };
      }
      return { title, detail: null };
    }
    case "admin_expiration": {
      const from = item.oldValue
        ? formatNumericDateInSaoPaulo(item.oldValue)
        : "sem data";
      const to = formatNumericDateInSaoPaulo(item.newValue);
      return {
        title: `${item.adminEmail} alterou a data de expiração para ${to}`,
        detail: `Antes: ${from}`,
      };
    }
    default: {
      const _never: never = item;
      return _never;
    }
  }
}

export type SerializedAccountHistoryItem = {
  id: string;
  kind: AccountHistoryKind;
  at: string;
  title: string;
  detail: string | null;
};

export function serializeAccountHistory(
  items: AccountHistoryItem[],
): SerializedAccountHistoryItem[] {
  return items.flatMap((item) => {
    if (!isValidDate(item.at)) return [];
    const copy = describeAccountHistoryItem(item);
    return [
      {
        id: item.id,
        kind: item.kind,
        at: item.at.toISOString(),
        title: copy.title,
        detail: copy.detail,
      },
    ];
  });
}
