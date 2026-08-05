import type { BillingProvider, PlanType, ProductOwnerType } from "@/lib/db/schema";
import {
  calculateAutomatizeNetRevenueCentavos,
  calculateExpertShare,
} from "@/lib/products/finance";
import type { StripeSettlement } from "./finance-dashboard";

export type FinanceAutomatizePaymentRow = {
  id: string;
  paidAt: Date | null;
  userId: string;
  userEmail: string;
  planType: PlanType;
  provider: BillingProvider;
  amount: number;
  grossAmount: number | null;
  netAmount: number | null;
  feeAmount: number | null;
  currency: string;
  stripeInvoiceId: string | null;
  mercadopagoPaymentId: string | null;
  description: string | null;
};

export type FinanceProductPaymentRow = {
  id: string;
  orderId: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  approvedAt: Date | null;
  createdAt: Date;
  providerPaymentId: string | null;
  grossAmountCentavos: number | null;
  netAmountCentavos: number | null;
  feeAmountCentavos: number | null;
  priceCentavos: number;
  ownerType: ProductOwnerType;
  expertShareBasisPoints: number;
  expertRevenueCentavos: number | null;
};

export type FinanceProductPaymentAmounts = {
  grossCentavos: number;
  feeCentavos: number | null;
  gatewayNetCentavos: number;
  expertRevenueCentavos: number;
  automatizeNetCentavos: number;
  revenueKind: "coproducao" | "taxa";
};

export type FinancePaymentsSummary = {
  count: number;
  grossCentavos: number;
  netCentavos: number;
  feeCentavos: number;
  netCoveragePayments: number;
};

export type FinancePaymentNetGapReason =
  | "stripe_settlement_unavailable"
  | "mercadopago_fees_pending"
  | "mercadopago_payment_not_found";

export type FinancePaymentNetGap = {
  paymentId: string;
  userEmail: string;
  paidAt: Date | null;
  provider: FinanceAutomatizePaymentRow["provider"];
  grossCentavos: number;
  reason: FinancePaymentNetGapReason;
  reference: string | null;
};

export function listAutomatizePaymentNetGaps(
  rows: FinanceAutomatizePaymentRow[],
  stripeSettlements: StripeSettlement[],
): FinancePaymentNetGap[] {
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );

  return rows.flatMap((row) => {
    const stripeSettlement = row.stripeInvoiceId
      ? settlementsByInvoice.get(row.stripeInvoiceId)
      : undefined;
    const amounts = resolveAutomatizePaymentAmounts(row, stripeSettlement);
    if (amounts.hasNetCoverage || !amounts.missingNetReason) {
      return [];
    }

    return [
      {
        paymentId: row.id,
        userEmail: row.userEmail,
        paidAt: row.paidAt,
        provider: row.provider,
        grossCentavos: amounts.gross,
        reason: amounts.missingNetReason,
        reference:
          row.mercadopagoPaymentId ??
          row.stripeInvoiceId ??
          row.description ??
          null,
      },
    ];
  });
}

export function resolveAutomatizePaymentAmounts(
  payment: Pick<
    FinanceAutomatizePaymentRow,
    | "amount"
    | "grossAmount"
    | "netAmount"
    | "feeAmount"
    | "provider"
    | "stripeInvoiceId"
  >,
  stripeSettlement?: StripeSettlement,
) {
  const gross =
    stripeSettlement?.grossAmount ??
    payment.grossAmount ??
    payment.amount;
  const fee = stripeSettlement?.feeAmount ?? payment.feeAmount;
  const net =
    stripeSettlement?.netAmount ??
    payment.netAmount ??
    (fee !== null ? gross - fee : payment.provider === "manual" ? gross : null);
  const hasNetCoverage = net !== null;
  let missingNetReason: FinancePaymentNetGapReason | null = null;

  if (!hasNetCoverage) {
    if (payment.provider === "stripe") {
      missingNetReason = "stripe_settlement_unavailable";
    } else if (payment.provider === "mercadopago") {
      missingNetReason = "mercadopago_fees_pending";
    }
  }

  return { gross, fee, net, hasNetCoverage, missingNetReason };
}

export function summarizeAutomatizePayments(
  payments: FinanceAutomatizePaymentRow[],
  stripeSettlements: StripeSettlement[],
): FinancePaymentsSummary {
  const settlementsByInvoice = new Map(
    stripeSettlements.map((settlement) => [settlement.invoiceId, settlement]),
  );

  const summary: FinancePaymentsSummary = {
    count: 0,
    grossCentavos: 0,
    netCentavos: 0,
    feeCentavos: 0,
    netCoveragePayments: 0,
  };

  for (const payment of payments) {
    const stripeSettlement = payment.stripeInvoiceId
      ? settlementsByInvoice.get(payment.stripeInvoiceId)
      : undefined;
    const { gross, fee, net } = resolveAutomatizePaymentAmounts(
      payment,
      stripeSettlement,
    );

    summary.count += 1;
    summary.grossCentavos += gross;
    if (fee !== null) summary.feeCentavos += fee;
    if (net !== null) {
      summary.netCentavos += net;
      summary.netCoveragePayments += 1;
    }
  }

  return summary;
}

export function resolveProductPaymentAmounts(
  payment: FinanceProductPaymentRow,
): FinanceProductPaymentAmounts {
  const gross =
    payment.grossAmountCentavos ?? payment.priceCentavos ?? 0;
  const fee = payment.feeAmountCentavos;
  const gatewayNet =
    payment.netAmountCentavos ?? (fee !== null ? gross - fee : gross);
  const expertRevenue =
    payment.expertRevenueCentavos ??
    (payment.expertShareBasisPoints > 0
      ? calculateExpertShare(gatewayNet, payment.expertShareBasisPoints)
      : 0);
  const automatizeNet = calculateAutomatizeNetRevenueCentavos(
    gatewayNet,
    expertRevenue,
  );

  return {
    grossCentavos: gross,
    feeCentavos: fee,
    gatewayNetCentavos: gatewayNet,
    expertRevenueCentavos: expertRevenue,
    automatizeNetCentavos: automatizeNet,
    revenueKind: payment.ownerType === "automatize" ? "coproducao" : "taxa",
  };
}

export function summarizeProductPayments(
  payments: FinanceProductPaymentRow[],
): FinancePaymentsSummary {
  const summary: FinancePaymentsSummary = {
    count: 0,
    grossCentavos: 0,
    netCentavos: 0,
    feeCentavos: 0,
    netCoveragePayments: 0,
  };

  for (const payment of payments) {
    const amounts = resolveProductPaymentAmounts(payment);

    summary.count += 1;
    summary.grossCentavos += amounts.grossCentavos;
    if (amounts.feeCentavos !== null) summary.feeCentavos += amounts.feeCentavos;
    summary.netCentavos += amounts.automatizeNetCentavos;
    summary.netCoveragePayments += 1;
  }

  return summary;
}
