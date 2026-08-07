import { sql, type SQL } from "drizzle-orm";
import { user } from "@/lib/db/schema";
import type { CustomerBaseRow } from "@/lib/backoffice/customer-base-status";

export const ACCOUNT_STATUS_FILTER_VALUES = [
  "all",
  "no_card_no_payment",
  "trial_no_payment",
  "subscribed_expired",
  "active_plan",
  "active_plan_canceled",
  "active_plan_pix",
] as const;

export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTER_VALUES)[number];

export const ACCOUNT_STATUS_FILTER_LABELS: Record<
  Exclude<AccountStatusFilter, "all">,
  string
> = {
  no_card_no_payment: "Não botou cartão nem pagou",
  trial_no_payment: "Entrou em trial mas não pagou",
  subscribed_expired: "Assinou e expirou",
  active_plan: "Plano ativo",
  active_plan_canceled: "Plano ativo mas cancelado",
  active_plan_pix: "Plano ativo com pix",
};

export type AccountStatusCustomer = CustomerBaseRow & {
  hasTrialingSubscription?: boolean;
};

function accessFlags(customer: CustomerBaseRow, referenceDate: Date) {
  const referenceTime = referenceDate.getTime();
  const expirationTime = customer.expirationDate?.getTime();

  return {
    hasActiveAccess:
      expirationTime !== undefined && expirationTime > referenceTime,
    hasExpiredAccess:
      expirationTime !== undefined && expirationTime < referenceTime,
  };
}

export function matchesAccountStatusFilter(
  customer: AccountStatusCustomer,
  filter: Exclude<AccountStatusFilter, "all">,
  referenceDate: Date,
): boolean {
  const { hasActiveAccess, hasExpiredAccess } = accessFlags(
    customer,
    referenceDate,
  );
  const hasTrialingSubscription = customer.hasTrialingSubscription ?? false;

  switch (filter) {
    case "no_card_no_payment":
      return !customer.hasApprovedPayment && !hasTrialingSubscription;
    case "trial_no_payment":
      return !customer.hasApprovedPayment && hasTrialingSubscription;
    case "subscribed_expired":
      return customer.hasApprovedPayment && hasExpiredAccess;
    case "active_plan":
      return (
        customer.hasApprovedPayment &&
        hasActiveAccess &&
        !customer.scheduledCancel
      );
    case "active_plan_canceled":
      return (
        customer.scheduledCancel &&
        hasActiveAccess &&
        customer.hasApprovedPayment
      );
    case "active_plan_pix":
      return (
        customer.hasApprovedPayment &&
        hasActiveAccess &&
        customer.lastPaymentProvider === "mercadopago"
      );
    default: {
      const exhaustiveCheck: never = filter;
      return exhaustiveCheck;
    }
  }
}

const hasApprovedPaymentSql = sql`EXISTS (
  SELECT 1
  FROM payments p
  WHERE p.user_id = ${user.id}
    AND p.status = 'succeeded'
)`;

const hasTrialingSubscriptionSql = sql`EXISTS (
  SELECT 1
  FROM subscriptions s
  WHERE s.user_id = ${user.id}
    AND s.status = 'trialing'
)`;

const hasActiveAccessSql = sql`(
  ${user.expirationDate} IS NOT NULL
  AND ${user.expirationDate} > NOW()
)`;

const hasExpiredAccessSql = sql`(
  ${user.expirationDate} IS NOT NULL
  AND ${user.expirationDate} < NOW()
)`;

const scheduledCancelSql = sql`COALESCE((
  SELECT s.cancel_at_period_end = true OR s.status = 'canceled'
  FROM subscriptions s
  WHERE s.user_id = ${user.id}
  ORDER BY s.created_at DESC
  LIMIT 1
), false)`;

const lastPaymentProviderIsPixSql = sql`(
  SELECT p.provider
  FROM payments p
  WHERE p.user_id = ${user.id}
    AND p.status = 'succeeded'
  ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
  LIMIT 1
) = 'mercadopago'`;

export function buildAccountStatusFilterSql(
  filter: Exclude<AccountStatusFilter, "all">,
): SQL {
  switch (filter) {
    case "no_card_no_payment":
      return sql`NOT ${hasApprovedPaymentSql} AND NOT ${hasTrialingSubscriptionSql}`;
    case "trial_no_payment":
      return sql`NOT ${hasApprovedPaymentSql} AND ${hasTrialingSubscriptionSql}`;
    case "subscribed_expired":
      return sql`${hasApprovedPaymentSql} AND ${hasExpiredAccessSql}`;
    case "active_plan":
      return sql`${hasApprovedPaymentSql} AND ${hasActiveAccessSql} AND NOT ${scheduledCancelSql}`;
    case "active_plan_canceled":
      return sql`${hasApprovedPaymentSql} AND ${hasActiveAccessSql} AND ${scheduledCancelSql}`;
    case "active_plan_pix":
      return sql`${hasApprovedPaymentSql} AND ${hasActiveAccessSql} AND ${lastPaymentProviderIsPixSql}`;
    default: {
      const exhaustiveCheck: never = filter;
      return exhaustiveCheck;
    }
  }
}
