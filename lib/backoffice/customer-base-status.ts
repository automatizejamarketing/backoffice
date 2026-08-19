import type { BillingProvider } from "@/lib/db/schema";

export const CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS = [
  "gabriel06apereira@icloud.com",
  "junqueira.tiago@gmail.com",
  "karolina.santos@rioquality.com.br",
  "lucashaddad@infinitegrowth.com.br",
  "lucashaddadm@gmail.com",
  "mariana.grupobastos@gmail.com",
] as const;

const excludedTrialEmails = new Set(
  CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS.map((email) => email.toLowerCase()),
);

export function isExcludedFromCustomerBaseTrial(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return excludedTrialEmails.has(email.trim().toLowerCase());
}

export type CustomerBaseRow = {
  email?: string | null;
  expirationDate: Date | null;
  hasApprovedPayment: boolean;
  scheduledCancel: boolean;
  lastPaymentProvider: BillingProvider | null;
};

export type CustomerBaseChurn = {
  total: number;
  card: number;
  pix: number;
};

export type CustomerBaseStatus = {
  activePaying: number;
  trial: number;
  churn: CustomerBaseChurn;
  scheduledCancel: number;
};

export type CustomerBaseCategory =
  | "activePaying"
  | "trial"
  | "churn"
  | "scheduledCancel";

export type CustomerBaseUserRow = CustomerBaseRow & {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  totalPaidCentavos: number;
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

export function matchesCustomerBaseCategory(
  customer: CustomerBaseRow,
  category: CustomerBaseCategory,
  referenceDate: Date,
): boolean {
  const { hasActiveAccess, hasExpiredAccess } = accessFlags(
    customer,
    referenceDate,
  );

  switch (category) {
    case "activePaying":
      return customer.hasApprovedPayment && hasActiveAccess;
    case "trial":
      return (
        !customer.hasApprovedPayment &&
        hasActiveAccess &&
        !isExcludedFromCustomerBaseTrial(customer.email)
      );
    case "churn":
      return customer.hasApprovedPayment && hasExpiredAccess;
    case "scheduledCancel":
      return (
        customer.scheduledCancel &&
        hasActiveAccess &&
        customer.hasApprovedPayment
      );
    default: {
      const exhaustiveCheck: never = category;
      return exhaustiveCheck;
    }
  }
}

export function listCustomerBaseStatusUsers(
  customers: CustomerBaseUserRow[],
  category: CustomerBaseCategory,
  referenceDate: Date,
): CustomerBaseUserRow[] {
  return customers
    .filter((customer) =>
      matchesCustomerBaseCategory(customer, category, referenceDate),
    )
    .sort((left, right) =>
      left.email.localeCompare(right.email, "pt-BR", { sensitivity: "base" }),
    );
}

function churnProviderBucket(
  provider: BillingProvider | null,
): keyof Pick<CustomerBaseChurn, "card" | "pix"> | null {
  if (provider === "stripe") return "card";
  if (provider === "mercadopago") return "pix";
  return null;
}

export function summarizeCustomerBaseStatus(
  customers: CustomerBaseRow[],
  referenceDate: Date,
): CustomerBaseStatus {
  const summary: CustomerBaseStatus = {
    activePaying: 0,
    trial: 0,
    churn: { total: 0, card: 0, pix: 0 },
    scheduledCancel: 0,
  };
  for (const customer of customers) {
    const { hasActiveAccess, hasExpiredAccess } = accessFlags(
      customer,
      referenceDate,
    );

    if (customer.hasApprovedPayment && hasActiveAccess) {
      summary.activePaying += 1;
    } else if (
      !customer.hasApprovedPayment &&
      hasActiveAccess &&
      !isExcludedFromCustomerBaseTrial(customer.email)
    ) {
      summary.trial += 1;
    } else if (customer.hasApprovedPayment && hasExpiredAccess) {
      summary.churn.total += 1;
      const bucket = churnProviderBucket(customer.lastPaymentProvider);
      if (bucket) {
        summary.churn[bucket] += 1;
      }
    }

    if (
      customer.scheduledCancel &&
      hasActiveAccess &&
      customer.hasApprovedPayment
    ) {
      summary.scheduledCancel += 1;
    }
  }

  return summary;
}
