import type { BillingProvider, PlanType } from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";

export type ActivePlanForMrr = {
  provider: BillingProvider;
  planType: PlanType;
};

export type PaymentForFinance = {
  id: string;
  provider: BillingProvider;
  amount: number;
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number | null;
  stripeInvoiceId: string | null;
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

export type FinanceProvider = "card" | "pix" | "manual";

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

function financeProvider(provider: BillingProvider): FinanceProvider {
  if (provider === "stripe") return "card";
  if (provider === "mercadopago") return "pix";
  return "manual";
}

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

  for (const plan of activePlans) {
    mrrByProvider[financeProvider(plan.provider)] +=
      PLAN_DEFINITIONS[plan.planType].monthlyPriceCentavos;
  }

  const providers: Record<FinanceProvider, FinanceProviderSummary> = {
    card: emptyProviderSummary("card"),
    pix: emptyProviderSummary("pix"),
    manual: emptyProviderSummary("manual"),
  };
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );

  for (const payment of payments) {
    const provider = financeProvider(payment.provider);
    const providerSummary = providers[provider];
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

    providerSummary.payments += 1;
    providerSummary.grossCentavos += gross;
    if (fee !== null) providerSummary.feeCentavos += fee;
    if (net !== null) {
      providerSummary.netCentavos += net;
      providerSummary.netCoveragePayments += 1;
    }
  }

  const providerValues = Object.values(providers);
  const netCentavos = providerValues.reduce(
    (sum, item) => sum + item.netCentavos,
    0,
  );
  const netCoveragePayments = providerValues.reduce(
    (sum, item) => sum + item.netCoveragePayments,
    0,
  );

  return {
    mrrCentavos: Object.values(mrrByProvider).reduce(
      (sum, amount) => sum + amount,
      0,
    ),
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
      payments: providerValues.reduce((sum, item) => sum + item.payments, 0),
      grossCentavos: providerValues.reduce(
        (sum, item) => sum + item.grossCentavos,
        0,
      ),
      feeCentavos: providerValues.reduce(
        (sum, item) => sum + item.feeCentavos,
        0,
      ),
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
