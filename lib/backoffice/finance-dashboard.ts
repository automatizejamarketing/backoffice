import type {
  BillingProvider,
  PaymentPurpose,
  PaymentSettlementMethod,
  PlanType,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import {
  financeProvider,
  type FinanceProvider,
} from "./finance-provider";
import { isBillingPaymentPurpose } from "./finance-purpose";

export type ActivePlanForMrr = {
  provider: BillingProvider;
  planType: PlanType;
  vindiPaymentMethod?: VindiSubscriptionPaymentMethod | null;
};

export type PaymentForFinance = {
  id: string;
  provider: BillingProvider;
  amount: number;
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number | null;
  stripeInvoiceId: string | null;
  paymentMethod?: PaymentSettlementMethod | null;
  purpose?: PaymentPurpose | null;
};

export type StripeSettlement = {
  invoiceId: string;
  grossAmount: number;
  netAmount: number;
  feeAmount: number;
};

export type CustomerLifetimeRevenue = {
  grossCentavos: number;
  payingCustomers: number;
};

export type FinanceProviderSummary = {
  provider: FinanceProvider;
  payments: number;
  grossCentavos: number;
  feeCentavos: number;
  netCentavos: number;
  netCoveragePayments: number;
};

export type FinanceDashboardSummary = {
  mrrCentavos: number;
  activeSubscriptions: number;
  realizedLtvCentavos: number;
  lifetimePayingCustomers: number;
  mrrByProvider: Record<FinanceProvider, number>;
  receipts: {
    payments: number;
    grossCentavos: number;
    feeCentavos: number;
    netCentavos: number;
    netCoveragePayments: number;
    averageNetTicketCentavos: number;
    providers: Record<FinanceProvider, FinanceProviderSummary>;
  };
};

function emptyProviderSummary(
  provider: FinanceProvider,
): FinanceProviderSummary {
  return {
    provider,
    payments: 0,
    grossCentavos: 0,
    feeCentavos: 0,
    netCentavos: 0,
    netCoveragePayments: 0,
  };
}

export function summarizeFinanceDashboard(
  activePlans: ActivePlanForMrr[],
  payments: PaymentForFinance[],
  stripeSettlements: StripeSettlement[],
  customerLifetimeRevenue: CustomerLifetimeRevenue,
): FinanceDashboardSummary {
  const mrrByProvider: Record<FinanceProvider, number> = {
    card: 0,
    pix: 0,
    manual: 0,
  };
  let mrrCentavos = 0;

  for (const plan of activePlans) {
    const monthly = PLAN_DEFINITIONS[plan.planType].monthlyPriceCentavos;
    mrrCentavos += monthly;
    const provider = financeProvider(plan);
    if (provider) mrrByProvider[provider] += monthly;
  }

  const providers: Record<FinanceProvider, FinanceProviderSummary> = {
    card: emptyProviderSummary("card"),
    pix: emptyProviderSummary("pix"),
    manual: emptyProviderSummary("manual"),
  };
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );
  let paymentsCount = 0;
  let grossCentavos = 0;
  let feeCentavos = 0;
  let netCentavos = 0;
  let netCoveragePayments = 0;

  for (const payment of payments) {
    if (!isBillingPaymentPurpose(payment.purpose)) continue;

    const provider = financeProvider(payment);
    const stripeSettlement = payment.stripeInvoiceId
      ? settlementsByInvoice.get(payment.stripeInvoiceId)
      : undefined;
    const gross =
      stripeSettlement?.grossAmount ?? payment.grossAmount ?? payment.amount;
    const fee = stripeSettlement?.feeAmount ?? payment.feeAmount;
    const net =
      stripeSettlement?.netAmount ??
      payment.netAmount ??
      (fee !== null ? gross - fee : provider === "manual" ? gross : null);

    paymentsCount += 1;
    grossCentavos += gross;
    if (fee !== null) feeCentavos += fee;
    if (net !== null) {
      netCentavos += net;
      netCoveragePayments += 1;
    }

    if (!provider) continue;

    const providerSummary = providers[provider];
    providerSummary.payments += 1;
    providerSummary.grossCentavos += gross;
    if (fee !== null) providerSummary.feeCentavos += fee;
    if (net !== null) {
      providerSummary.netCentavos += net;
      providerSummary.netCoveragePayments += 1;
    }
  }

  return {
    mrrCentavos,
    activeSubscriptions: activePlans.length,
    realizedLtvCentavos:
      customerLifetimeRevenue.payingCustomers === 0
        ? 0
        : Math.round(
            customerLifetimeRevenue.grossCentavos /
              customerLifetimeRevenue.payingCustomers,
          ),
    lifetimePayingCustomers: customerLifetimeRevenue.payingCustomers,
    mrrByProvider,
    receipts: {
      payments: paymentsCount,
      grossCentavos,
      feeCentavos,
      netCentavos,
      netCoveragePayments,
      averageNetTicketCentavos:
        netCoveragePayments === 0
          ? 0
          : Math.round(netCentavos / netCoveragePayments),
      providers,
    },
  };
}
