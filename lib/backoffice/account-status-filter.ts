import { sql, type SQL } from "drizzle-orm";
import { user } from "@/lib/db/schema";
import type { CustomerBaseRow } from "@/lib/backoffice/customer-base-status";
import { billingPaymentPurposeSql } from "@/lib/backoffice/finance-purpose";

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

export const ACCOUNT_STATUS_FILTER_DESCRIPTIONS: Record<
  Exclude<AccountStatusFilter, "all">,
  string
> = {
  no_card_no_payment:
    "Nunca teve pagamento aprovado e nunca teve registro de assinatura Stripe (trial, cancelada ou pendente).",
  trial_no_payment:
    "Tem ou teve assinatura Stripe, mas nunca teve pagamento aprovado — inclui trial cancelado ou expirado sem cobrança.",
  subscribed_expired:
    "Já teve pelo menos um pagamento aprovado e o acesso expirou (data de expiração no passado).",
  active_plan:
    "Pagamento aprovado, acesso vigente e sem cancelamento Stripe agendado.",
  active_plan_canceled:
    "Pagamento aprovado, acesso ainda vigente, mas pediu cancelamento no Stripe até o fim do período.",
  active_plan_pix:
    "Pagamento aprovado, acesso vigente e o último pagamento aprovado foi via Pix (Mercado Pago ou Vindi).",
};

export type AccountStatusCustomer = CustomerBaseRow & {
  hasSubscription?: boolean;
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
  const hasSubscription = customer.hasSubscription ?? false;

  switch (filter) {
    case "no_card_no_payment":
      return !customer.hasApprovedPayment && !hasSubscription;
    case "trial_no_payment":
      return !customer.hasApprovedPayment && hasSubscription;
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
        (customer.lastPaymentProvider === "mercadopago" ||
          (customer.lastPaymentProvider === "vindi" &&
            customer.lastPaymentMethod === "pix"))
      );
    default: {
      const exhaustiveCheck: never = filter;
      return exhaustiveCheck;
    }
  }
}

const billingPurposeSql = billingPaymentPurposeSql();

const hasApprovedPaymentSql = sql`EXISTS (
  SELECT 1
  FROM payments p
  WHERE p.user_id = ${user.id}
    AND p.status = 'succeeded'
    AND ${billingPurposeSql}
)`;

const hasSubscriptionSql = sql`EXISTS (
  SELECT 1
  FROM subscriptions s
  WHERE s.user_id = ${user.id}
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

const lastPaymentProviderIsPixSql = sql`COALESCE((
  SELECT
    p.provider = 'mercadopago'
    OR (p.provider = 'vindi' AND p.payment_method = 'pix')
  FROM payments p
  WHERE p.user_id = ${user.id}
    AND p.status = 'succeeded'
    AND ${billingPurposeSql}
  ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
  LIMIT 1
), false)`;

export function buildAccountStatusFilterSql(
  filter: Exclude<AccountStatusFilter, "all">,
): SQL {
  switch (filter) {
    case "no_card_no_payment":
      return sql`NOT ${hasApprovedPaymentSql} AND NOT ${hasSubscriptionSql}`;
    case "trial_no_payment":
      return sql`NOT ${hasApprovedPaymentSql} AND ${hasSubscriptionSql}`;
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
