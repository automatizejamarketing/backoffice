import type {
  BillingProvider,
  ExpertSettlement,
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
import {
  calculateGatewayNetV1PixSettlement,
  isGatewayNetV1Model,
} from "@/lib/products/gateway-net-v1";
import type { StripeSettlement } from "./finance-dashboard";
import { UNCLASSIFIED_FINANCE_PROVIDER_LABEL } from "./finance-provider";
import { isBillingPaymentPurpose } from "./finance-purpose";

export type ExpertSettlementRail = ExpertSettlement;

const REPASSE_PELO_GATEWAY_LABEL = "Repasse pelo Gateway";
const REPASSE_MANUAL_LABEL = "Repasse Manual";

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
  coproducerShareBasisPoints: number;
  coproducerTypeSnapshot: ProductOwnerType | null;
  expertSettlement: ExpertSettlement | null;
  ownerExpertReceivableCentavos: number | null;
  gatewayFeeEstimateBps: number | null;
  gatewayFeeEstimateFixedCentavos: number | null;
  expertRevenueCentavos: number | null;
};

export type FinanceProductPaymentAmounts = {
  grossCentavos: number;
  feeCentavos: number | null;
  gatewayNetCentavos: number;
  expertRevenueCentavos: number;
  platformFeeGrossCentavos: number | null;
  automatizeNetCentavos: number | null;
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
  | "coproducerShareBasisPoints"
  | "coproducerTypeSnapshot"
  | "expertSettlement"
  | "ownerExpertReceivableCentavos"
  | "gatewayFeeEstimateBps"
  | "gatewayFeeEstimateFixedCentavos"
  | "provider"
  | "expertRevenueCentavos"
>;

export type FinanceProductPaymentNetAmounts = FinanceProductPaymentAmounts & {
  netCentavos: number;
  automatizeRevenueCentavos: number | null;
  expertSettlementRail: ExpertSettlementRail | null;
  expertSettlementLabel: string | null;
  gatewayFeeEstimateLabel: string | null;
  countsTowardExpertPayableBalance: boolean;
};

export type FinanceProductSettlementRailTotals = {
  count: number;
  grossCentavos: number;
  feeCentavos: number;
  netCentavos: number;
  expertRevenueCentavos: number;
  automatizeRevenueCentavos: number;
};

export type FinanceProductSettlementSummary = {
  gateway: FinanceProductSettlementRailTotals;
  ledger: FinanceProductSettlementRailTotals;
  expertPayableCentavos: number;
};

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
  productSettlement?: FinanceProductSettlementSummary;
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
    return {
      methodLabel: UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
      referenceLabel: payment.providerPaymentId,
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

function emptySettlementRailTotals(): FinanceProductSettlementRailTotals {
  return {
    count: 0,
    grossCentavos: 0,
    feeCentavos: 0,
    netCentavos: 0,
    expertRevenueCentavos: 0,
    automatizeRevenueCentavos: 0,
  };
}

export function describeExpertSettlementRail(
  rail: ExpertSettlementRail | null,
): string | null {
  if (rail === "gateway") return REPASSE_PELO_GATEWAY_LABEL;
  if (rail === "ledger") return REPASSE_MANUAL_LABEL;
  return null;
}

export function formatGatewayFeeEstimateLabel(input: {
  financialModel: ProductFinancialModel;
  provider: string;
  gatewayFeeEstimateBps: number | null;
  gatewayFeeEstimateFixedCentavos: number | null;
}): string | null {
  if (!isGatewayNetV1Model(input.financialModel)) {
    return null;
  }
  if (input.provider !== "stripe") {
    return null;
  }
  if (
    input.gatewayFeeEstimateBps === null ||
    input.gatewayFeeEstimateFixedCentavos === null
  ) {
    return null;
  }
  const percent = (input.gatewayFeeEstimateBps / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const fixed = (input.gatewayFeeEstimateFixedCentavos / 100).toLocaleString(
    "pt-BR",
    { style: "currency", currency: "BRL" },
  );
  return `${percent}% + ${fixed}`;
}

const LEGACY_VINDI_SPLIT_MODEL = "vindi_split_v1" as const;

function isLegacyVindiSplitModel(
  financialModel: ProductFinancialModel | null | undefined,
): boolean {
  return (financialModel as string | null | undefined) === LEGACY_VINDI_SPLIT_MODEL;
}

export function resolveExpertSettlementRail(
  payment: Pick<
    FinanceProductPaymentAmountRow,
    | "expertSettlement"
    | "expertRevenueCentavos"
    | "financialModel"
    | "ownerType"
  >,
): ExpertSettlementRail | null {
  if (payment.expertSettlement === "gateway") return "gateway";
  if (payment.expertSettlement === "ledger") return "ledger";
  if (payment.ownerType === "automatize") return null;
  if (
    payment.expertRevenueCentavos !== null &&
    payment.expertRevenueCentavos > 0
  ) {
    return "ledger";
  }
  return null;
}

function resolveGatewayNetV1ExpertRevenueCentavos(
  payment: FinanceProductPaymentAmountRow,
): number {
  if (payment.ownerExpertReceivableCentavos !== null) {
    return payment.ownerExpertReceivableCentavos;
  }
  if (payment.expertRevenueCentavos !== null) {
    return payment.expertRevenueCentavos;
  }
  if (
    payment.expertSettlement === "gateway" ||
    payment.provider === "stripe"
  ) {
    const gross = payment.grossAmountCentavos ?? payment.priceCentavos;
    const fee = payment.feeAmountCentavos ?? 0;
    const netCentavos = payment.netAmountCentavos ?? gross - fee;
    const automatizeRevenue =
      resolveGatewayNetV1AutomatizeRevenueCentavos(payment);
    return Math.max(0, netCentavos - automatizeRevenue);
  }
  const coproducerType =
    payment.coproducerTypeSnapshot === "automatize" ? "automatize" : null;
  return calculateGatewayNetV1PixSettlement({
    grossAmountCentavos: payment.grossAmountCentavos ?? payment.priceCentavos,
    providerFeeAmountCentavos: payment.feeAmountCentavos ?? 0,
    ownerExpertShareBasisPoints: payment.expertShareBasisPoints,
    coproducerShareBasisPoints: payment.coproducerShareBasisPoints,
    coproducerType,
  }).ownerExpertReceivableCentavos;
}

function resolveGatewayNetV1AutomatizeRevenueCentavos(
  payment: FinanceProductPaymentAmountRow,
): number {
  if (payment.automatizeTotalNetRevenueCentavos !== null) {
    return payment.automatizeTotalNetRevenueCentavos;
  }
  return (
    (payment.automatizeCoproductionRevenueCentavos ?? 0) +
    (payment.automatizeProductRevenueCentavos ?? 0)
  );
}

export function resolveProductPaymentNetAmounts<
  T extends FinanceProductPaymentAmountRow,
>(payment: T): FinanceProductPaymentNetAmounts {
  const base = resolveProductPaymentAmounts(payment);
  const gross =
    payment.grossAmountCentavos ?? payment.priceCentavos ?? 0;
  const fee = payment.feeAmountCentavos;
  const netCentavos =
    fee !== null ? gross - fee : (payment.netAmountCentavos ?? gross);

  let expertRevenueCentavos = base.expertRevenueCentavos;
  let automatizeRevenueCentavos = base.automatizeNetCentavos;

  if (isGatewayNetV1Model(payment.financialModel)) {
    expertRevenueCentavos = resolveGatewayNetV1ExpertRevenueCentavos(payment);
    automatizeRevenueCentavos =
      resolveGatewayNetV1AutomatizeRevenueCentavos(payment);
  } else if (payment.ownerType === "automatize") {
    expertRevenueCentavos = 0;
    automatizeRevenueCentavos = netCentavos;
  } else {
    automatizeRevenueCentavos = base.automatizeNetCentavos;
  }

  const expertSettlementRail = resolveExpertSettlementRail(payment);
  const expertSettlementLabel =
    describeExpertSettlementRail(expertSettlementRail);
  const gatewayFeeEstimateLabel = formatGatewayFeeEstimateLabel({
    financialModel: payment.financialModel,
    provider: payment.provider,
    gatewayFeeEstimateBps: payment.gatewayFeeEstimateBps,
    gatewayFeeEstimateFixedCentavos: payment.gatewayFeeEstimateFixedCentavos,
  });

  return {
    ...base,
    expertRevenueCentavos,
    automatizeNetCentavos: automatizeRevenueCentavos,
    automatizeRevenueCentavos,
    netCentavos,
    expertSettlementRail,
    expertSettlementLabel,
    gatewayFeeEstimateLabel,
    countsTowardExpertPayableBalance: expertSettlementRail === "ledger",
  };
}

export function summarizeProductPaymentsBySettlementRail<
  T extends FinanceProductPaymentAmountRow,
>(payments: T[]): FinanceProductSettlementSummary {
  const summary: FinanceProductSettlementSummary = {
    gateway: emptySettlementRailTotals(),
    ledger: emptySettlementRailTotals(),
    expertPayableCentavos: 0,
  };

  for (const payment of payments) {
    const amounts = resolveProductPaymentNetAmounts(payment);
    const rail = amounts.expertSettlementRail;
    if (!rail) continue;

    const bucket = summary[rail];
    bucket.count += 1;
    bucket.grossCentavos += amounts.grossCentavos;
    if (amounts.feeCentavos !== null) bucket.feeCentavos += amounts.feeCentavos;
    bucket.netCentavos += amounts.netCentavos;
    bucket.expertRevenueCentavos += amounts.expertRevenueCentavos;
    if (amounts.automatizeRevenueCentavos !== null) {
      bucket.automatizeRevenueCentavos += amounts.automatizeRevenueCentavos;
    }

    if (amounts.countsTowardExpertPayableBalance) {
      summary.expertPayableCentavos += amounts.expertRevenueCentavos;
    }
  }

  return summary;
}

export function resolveProductOrderNetAmounts(
  order: FinanceProductPaymentAmountRow,
): FinanceProductPaymentNetAmounts {
  return resolveProductPaymentNetAmounts(order);
}

function resolveLegacyVindiSplitAutomatizeNetCentavos(
  payment: Pick<
    FinanceProductPaymentRow,
    | "automatizeCoproductionRevenueCentavos"
    | "automatizeProductRevenueCentavos"
    | "expertShareBasisPoints"
    | "expertRevenueCentavos"
  >,
  gatewayNet: number,
): number | null {
  const coproduction = payment.automatizeCoproductionRevenueCentavos;
  const product = payment.automatizeProductRevenueCentavos;
  if (coproduction !== null || product !== null) {
    return (coproduction ?? 0) + (product ?? 0);
  }
  if (payment.expertRevenueCentavos !== null) {
    return calculateAutomatizeNetRevenueCentavos(
      gatewayNet,
      Math.min(payment.expertRevenueCentavos, gatewayNet),
    );
  }
  if (payment.expertShareBasisPoints > 0) {
    const expertRevenue = calculateExpertShare(
      gatewayNet,
      payment.expertShareBasisPoints,
    );
    return calculateAutomatizeNetRevenueCentavos(gatewayNet, expertRevenue);
  }
  return null;
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
  >,
  gatewayNet: number,
): number | null {
  if (payment.automatizeTotalNetRevenueCentavos !== null) {
    return payment.automatizeTotalNetRevenueCentavos;
  }

  if (payment.ownerType === "automatize") {
    return gatewayNet;
  }

  if (isLegacyVindiSplitModel(payment.financialModel)) {
    return resolveLegacyVindiSplitAutomatizeNetCentavos(payment, gatewayNet);
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
    payment.expertShareBasisPoints > 0
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
    productSettlement: summarizeProductPaymentsBySettlementRail(payments),
  };

  for (const payment of payments) {
    const amounts = resolveProductPaymentNetAmounts(payment);

    summary.count += 1;
    summary.grossCentavos += amounts.grossCentavos;
    if (amounts.feeCentavos !== null) summary.feeCentavos += amounts.feeCentavos;
    if (amounts.automatizeRevenueCentavos !== null) {
      summary.netCentavos += amounts.automatizeRevenueCentavos;
    }
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
    if (amounts.automatizeNetCentavos !== null) {
      summary.automatizeNetRevenueCentavos += amounts.automatizeNetCentavos;
    }
    summaries.set(payment.productId, summary);
  }

  return summaries;
}
