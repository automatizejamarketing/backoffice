import type {
  BillingProvider,
  PaymentPurpose,
  PaymentSettlementMethod,
  PlanType,
  ProductFinancialModel,
  ProductOwnerType,
} from "@/lib/db/schema";
import {
  calculateAutomatizeNetRevenueCentavos,
  calculateExpertShare,
} from "@/lib/products/finance";
import type { StripeSettlement } from "./finance-dashboard";
import { isBillingPaymentPurpose } from "./finance-purpose";

export type FinanceAutomatizePaymentRow = {
  id: string;
  paidAt: Date | null;
  createdAt: Date;
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
  vindiChargeId?: string | null;
  paymentMethod?: PaymentSettlementMethod | null;
  purpose?: PaymentPurpose | null;
  description: string | null;
  paymentNumber: number;
};

export type AutomatizePaymentSequenceKind = "new_subscription" | "renewal";

export function describeAutomatizePaymentSequence(paymentNumber: number): {
  paymentNumber: number;
  kind: AutomatizePaymentSequenceKind;
  badgeLabel: string;
} {
  if (paymentNumber <= 1) {
    return {
      paymentNumber: 1,
      kind: "new_subscription",
      badgeLabel: "Assinatura nova",
    };
  }

  return {
    paymentNumber,
    kind: "renewal",
    badgeLabel: "Renovação",
  };
}

export type { ProductFinancialModel };

export type FinanceProductPaymentRow = {
  id: string;
  orderId: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  approvedAt: Date | null;
  createdAt: Date;
  provider: string;
  providerPaymentId: string | null;
  paymentMethodId: string | null;
  paymentTypeId: string | null;
  grossAmountCentavos: number | null;
  netAmountCentavos: number | null;
  feeAmountCentavos: number | null;
  priceCentavos: number;
  ownerType: ProductOwnerType;
  financialModel: ProductFinancialModel;
  platformFeeBasisPoints: number | null;
  platformFeeFixedCentavos: number | null;
  platformFeeGrossCentavos: number | null;
  automatizeCoproductionRevenueCentavos: number | null;
  automatizeProductRevenueCentavos: number | null;
  automatizeTotalNetRevenueCentavos: number | null;
  expertShareBasisPoints: number;
  expertRevenueCentavos: number | null;
  /** Split Vindi (`vindi_split_v1`), congelado na venda. */
  expertAmountCentavos: number | null;
  platformTheoreticalAmountCentavos: number | null;
};

export type FinanceProductPaymentAmounts = {
  grossCentavos: number;
  feeCentavos: number | null;
  gatewayNetCentavos: number;
  expertRevenueCentavos: number;
  platformFeeGrossCentavos: number | null;
  automatizeNetCentavos: number;
  revenueKind: "coproducao" | "taxa";
};

export type FinanceProductPaymentAmountRow = Pick<
  FinanceProductPaymentRow,
  | "grossAmountCentavos"
  | "netAmountCentavos"
  | "feeAmountCentavos"
  | "priceCentavos"
  | "ownerType"
  | "financialModel"
  | "platformFeeBasisPoints"
  | "platformFeeFixedCentavos"
  | "platformFeeGrossCentavos"
  | "automatizeCoproductionRevenueCentavos"
  | "automatizeProductRevenueCentavos"
  | "automatizeTotalNetRevenueCentavos"
  | "expertShareBasisPoints"
  | "expertRevenueCentavos"
  | "expertAmountCentavos"
  | "platformTheoreticalAmountCentavos"
>;

export type FinancePaymentsNetBreakdown = {
  newSubscriptionNetCentavos: number;
  renewalNetCentavos: number;
  newSubscriptionCount: number;
  renewalCount: number;
};

export type FinancePaymentsSummary = {
  count: number;
  grossCentavos: number;
  netCentavos: number;
  feeCentavos: number;
  netCoveragePayments: number;
  netBreakdown?: FinancePaymentsNetBreakdown;
};

export type FinancePaymentNetGapReason =
  | "stripe_settlement_unavailable"
  | "mercadopago_fees_pending"
  | "mercadopago_payment_not_found"
  | "vindi_settlement_unavailable";

export type FinancePaymentNetGap = {
  paymentId: string;
  userEmail: string;
  paidAt: Date | null;
  provider: FinanceAutomatizePaymentRow["provider"];
  paymentMethod?: PaymentSettlementMethod | null;
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
    if (!isBillingPaymentPurpose(row.purpose)) return [];

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
        paymentMethod: row.paymentMethod ?? null,
        grossCentavos: amounts.gross,
        reason: amounts.missingNetReason,
        reference:
          row.vindiChargeId ??
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
    } else if (payment.provider === "vindi") {
      missingNetReason = "vindi_settlement_unavailable";
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
    netBreakdown: {
      newSubscriptionNetCentavos: 0,
      renewalNetCentavos: 0,
      newSubscriptionCount: 0,
      renewalCount: 0,
    },
  };

  for (const payment of payments) {
    if (!isBillingPaymentPurpose(payment.purpose)) continue;

    const stripeSettlement = payment.stripeInvoiceId
      ? settlementsByInvoice.get(payment.stripeInvoiceId)
      : undefined;
    const { gross, fee, net } = resolveAutomatizePaymentAmounts(
      payment,
      stripeSettlement,
    );
    const isNewSubscription = payment.paymentNumber <= 1;

    summary.count += 1;
    summary.grossCentavos += gross;
    if (fee !== null) summary.feeCentavos += fee;
    if (net !== null) {
      summary.netCentavos += net;
      summary.netCoveragePayments += 1;

      if (isNewSubscription) {
        summary.netBreakdown!.newSubscriptionNetCentavos += net;
        summary.netBreakdown!.newSubscriptionCount += 1;
      } else {
        summary.netBreakdown!.renewalNetCentavos += net;
        summary.netBreakdown!.renewalCount += 1;
      }
    } else if (isNewSubscription) {
      summary.netBreakdown!.newSubscriptionCount += 1;
    } else {
      summary.netBreakdown!.renewalCount += 1;
    }
  }

  return summary;
}

function usesPlatformFeeFinancialModel(
  financialModel: ProductFinancialModel,
): boolean {
  return (
    financialModel === "platform_fee_coproduction" ||
    financialModel === "platform_fee_coproduction_v2" ||
    financialModel === "platform_fee_coproduction_v3"
  );
}

export function resolveProductPlatformFeeGrossCentavos(
  payment: Pick<
    FinanceProductPaymentRow,
    | "grossAmountCentavos"
    | "priceCentavos"
    | "financialModel"
    | "platformFeeBasisPoints"
    | "platformFeeFixedCentavos"
    | "platformFeeGrossCentavos"
  >,
): number | null {
  if (!usesPlatformFeeFinancialModel(payment.financialModel)) {
    return null;
  }

  if (payment.platformFeeGrossCentavos !== null) {
    return payment.platformFeeGrossCentavos;
  }

  if (payment.platformFeeBasisPoints === null) {
    return null;
  }

  const gross = payment.grossAmountCentavos ?? payment.priceCentavos ?? 0;
  const fixedFee =
    payment.financialModel === "platform_fee_coproduction_v3"
      ? (payment.platformFeeFixedCentavos ?? 0)
      : 0;
  return Math.min(
    gross,
    Math.round((gross * payment.platformFeeBasisPoints) / 10_000) + fixedFee,
  );
}

export function describeProductPaymentProvider(
  payment: Pick<
    FinanceProductPaymentRow,
    "provider" | "paymentMethodId" | "paymentTypeId" | "providerPaymentId"
  >,
): { methodLabel: string; referenceLabel: string | null } {
  const isPix =
    payment.paymentMethodId?.toLowerCase() === "pix" ||
    payment.paymentTypeId?.toLowerCase() === "bank_transfer";

  if (payment.provider === "stripe") {
    return {
      methodLabel: "Cartão",
      referenceLabel: payment.providerPaymentId
        ? `Stripe ${payment.providerPaymentId}`
        : null,
    };
  }

  if (payment.provider === "vindi") {
    const methodLabel =
      isPix || payment.paymentMethodId === "pix"
        ? "PIX"
        : payment.paymentMethodId === "credit_card"
          ? "Cartão"
          : "Vindi";
    return {
      methodLabel,
      referenceLabel: payment.providerPaymentId
        ? `Vindi ${payment.providerPaymentId}`
        : null,
    };
  }

  if (payment.provider === "mercadopago" || isPix) {
    return {
      methodLabel: "PIX",
      referenceLabel: payment.providerPaymentId
        ? `MP ${payment.providerPaymentId}`
        : null,
    };
  }

  if (payment.paymentTypeId === "credit_card") {
    return {
      methodLabel: "Cartão",
      referenceLabel: payment.providerPaymentId ?? null,
    };
  }

  return {
    methodLabel: payment.paymentMethodId ?? payment.provider ?? "—",
    referenceLabel: payment.providerPaymentId,
  };
}

export function resolveAutomatizeProductNetCentavos(
  payment: Pick<
    FinanceProductPaymentRow,
    | "grossAmountCentavos"
    | "priceCentavos"
    | "feeAmountCentavos"
    | "ownerType"
    | "financialModel"
    | "platformFeeBasisPoints"
    | "platformFeeFixedCentavos"
    | "platformFeeGrossCentavos"
    | "automatizeCoproductionRevenueCentavos"
    | "automatizeProductRevenueCentavos"
    | "automatizeTotalNetRevenueCentavos"
    | "expertShareBasisPoints"
    | "expertRevenueCentavos"
    | "netAmountCentavos"
    | "expertAmountCentavos"
    | "platformTheoreticalAmountCentavos"
  >,
  gatewayNet: number,
): number {
  if (payment.automatizeTotalNetRevenueCentavos !== null) {
    return payment.automatizeTotalNetRevenueCentavos;
  }

  if (payment.ownerType === "automatize") {
    return gatewayNet;
  }

  // `vindi_split_v1` não entra em nenhum dos ramos abaixo: o modelo zera
  // `expert_share_basis_points` (a participação real mora em
  // `expert_participation_bps`) e não preenche as colunas do v3. Sem este
  // desvio, a conta caía no ramo legado, derivava participação zero e
  // atribuía a venda INTEIRA à Automatize — a parte do expert virava receita
  // nossa em todo relatório. Os dois valores já vêm congelados da venda.
  if (payment.financialModel === "vindi_split_v1") {
    if (payment.platformTheoreticalAmountCentavos !== null) {
      return payment.platformTheoreticalAmountCentavos;
    }
    if (payment.expertAmountCentavos !== null) {
      return calculateAutomatizeNetRevenueCentavos(
        gatewayNet,
        Math.min(payment.expertAmountCentavos, gatewayNet),
      );
    }
  }

  if (usesPlatformFeeFinancialModel(payment.financialModel)) {
    const gross = payment.grossAmountCentavos ?? payment.priceCentavos ?? 0;
    const platformFee =
      payment.platformFeeGrossCentavos ??
      (payment.platformFeeBasisPoints !== null
        ? Math.min(
            gross,
            Math.round((gross * payment.platformFeeBasisPoints) / 10_000) +
              (payment.financialModel === "platform_fee_coproduction_v3"
                ? (payment.platformFeeFixedCentavos ?? 0)
                : 0),
          )
        : 0);
    const automatizeGross =
      platformFee +
      (payment.automatizeCoproductionRevenueCentavos ?? 0) +
      (payment.automatizeProductRevenueCentavos ?? 0);

    return automatizeGross - (payment.feeAmountCentavos ?? 0);
  }

  const derivedExpertRevenue =
    payment.expertShareBasisPoints > 0
      ? calculateExpertShare(gatewayNet, payment.expertShareBasisPoints)
      : 0;
  const ledgerExpertRevenue = payment.expertRevenueCentavos;
  const expertRevenue =
    ledgerExpertRevenue !== null && ledgerExpertRevenue <= gatewayNet
      ? ledgerExpertRevenue
      : derivedExpertRevenue;

  return calculateAutomatizeNetRevenueCentavos(
    gatewayNet,
    Math.min(expertRevenue, gatewayNet),
  );
}

export function resolveProductPaymentAmounts<
  T extends FinanceProductPaymentAmountRow,
>(
  payment: T,
): FinanceProductPaymentAmounts {
  const gross =
    payment.grossAmountCentavos ?? payment.priceCentavos ?? 0;
  const fee = payment.feeAmountCentavos;
  const gatewayNet =
    payment.netAmountCentavos ?? (fee !== null ? gross - fee : gross);
  const revenueKind = payment.ownerType === "automatize" ? "coproducao" : "taxa";
  const derivedExpertRevenue =
    payment.financialModel === "vindi_split_v1" &&
    payment.expertAmountCentavos !== null
      ? payment.expertAmountCentavos
      : payment.expertShareBasisPoints > 0
        ? calculateExpertShare(gatewayNet, payment.expertShareBasisPoints)
        : 0;
  const ledgerExpertRevenue = payment.expertRevenueCentavos;
  const expertRevenue =
    ledgerExpertRevenue !== null &&
    ledgerExpertRevenue <= gatewayNet
      ? ledgerExpertRevenue
      : derivedExpertRevenue;
  const automatizeNet = resolveAutomatizeProductNetCentavos(
    payment,
    gatewayNet,
  );
  const platformFeeGrossCentavos =
    resolveProductPlatformFeeGrossCentavos(payment);

  return {
    grossCentavos: gross,
    feeCentavos: fee,
    gatewayNetCentavos: gatewayNet,
    expertRevenueCentavos: expertRevenue,
    platformFeeGrossCentavos,
    automatizeNetCentavos: automatizeNet,
    revenueKind,
  };
}

export function summarizeProductPayments<
  T extends FinanceProductPaymentAmountRow,
>(
  payments: T[],
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

export function summarizeProductPaymentsByProduct<
  T extends FinanceProductPaymentAmountRow & { productId: string },
>(
  payments: T[],
): Map<
  string,
  {
    grossRevenueCentavos: number;
    automatizeNetRevenueCentavos: number;
  }
> {
  const summaries = new Map<
    string,
    {
      grossRevenueCentavos: number;
      automatizeNetRevenueCentavos: number;
    }
  >();

  for (const payment of payments) {
    const amounts = resolveProductPaymentAmounts(payment);
    const summary = summaries.get(payment.productId) ?? {
      grossRevenueCentavos: 0,
      automatizeNetRevenueCentavos: 0,
    };

    summary.grossRevenueCentavos += amounts.grossCentavos;
    summary.automatizeNetRevenueCentavos += amounts.automatizeNetCentavos;
    summaries.set(payment.productId, summary);
  }

  return summaries;
}
