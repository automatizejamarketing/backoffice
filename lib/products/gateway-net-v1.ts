import type { ProductFinancialModel, ProductOwnerType } from "@/lib/db/schema";

const DEFAULT_STRIPE_BR_CARD_FEE_BPS = 399;
const DEFAULT_STRIPE_BR_CARD_FEE_FIXED_CENTAVOS = 40;

export type GatewayNetV1PixSettlement = {
  netAmountCentavos: number;
  ownerExpertReceivableCentavos: number;
  automatizeCoproductionRevenueCentavos: number;
};

export type GatewayNetV1StripeApplicationFee = {
  gatewayFeeEstimateCentavos: number;
  applicationFeeCentavos: number;
};

export type GatewayNetV1OrderSnapshot = {
  financialModel: Extract<ProductFinancialModel, "gateway_net_v1">;
  platformFeeBasisPoints: 0;
  platformFeeFixedCentavos: 0;
  marketplaceFeeBasisPoints: 0;
  ownerExpertShareBasisPoints: number;
  coproducerType: "automatize" | null;
  coproducerShareBasisPoints: number;
  gatewayFeeEstimateBps: number | null;
  gatewayFeeEstimateFixedCentavos: number | null;
};

function assertCentavos(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertBasisPoints(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${name} must be between 0 and 10000 basis points`);
  }
}

/** Tarifa Estimada do Gateway for Cobrança Direta (conservative defaults until
 * production values are configured). */
export function readStripeBrCardFeeEstimate(): {
  bps: number;
  fixedCentavos: number;
} {
  const rawBps = process.env.STRIPE_BR_CARD_FEE_BPS;
  const rawFixed = process.env.STRIPE_BR_CARD_FEE_FIXED_CENTAVOS;
  const bps =
    rawBps === undefined || rawBps === ""
      ? DEFAULT_STRIPE_BR_CARD_FEE_BPS
      : Number(rawBps);
  const fixedCentavos =
    rawFixed === undefined || rawFixed === ""
      ? DEFAULT_STRIPE_BR_CARD_FEE_FIXED_CENTAVOS
      : Number(rawFixed);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error("STRIPE_BR_CARD_FEE_BPS must be between 0 and 10000");
  }
  if (!Number.isInteger(fixedCentavos) || fixedCentavos < 0) {
    throw new Error(
      "STRIPE_BR_CARD_FEE_FIXED_CENTAVOS must be a non-negative integer",
    );
  }
  return { bps, fixedCentavos };
}

export function validateGatewayNetV1Coproducer(input: {
  coproducerType: ProductOwnerType | null;
  coproducerExpertId: string | null;
  coproducerShareBasisPoints: number;
}) {
  if (input.coproducerType === "expert") {
    throw new Error(
      "Coprodutor Expert não é permitido no modelo gateway_net_v1",
    );
  }
  if (
    (input.coproducerType === null) !==
    (input.coproducerShareBasisPoints === 0)
  ) {
    throw new Error("Coproducer type and share must be provided together");
  }
  if (input.coproducerType === "automatize" && input.coproducerExpertId) {
    throw new Error("Coprodução do Automatize cannot reference an expert id");
  }
}

export function buildGatewayNetV1OrderSnapshot(input: {
  ownerType: ProductOwnerType;
  ownerExpertShareBasisPoints: number;
  coproducerType: ProductOwnerType | null;
  coproducerShareBasisPoints: number;
  paymentMethod?: "card" | "pix" | "free";
  gatewayFeeEstimateBps?: number;
  gatewayFeeEstimateFixedCentavos?: number;
}): GatewayNetV1OrderSnapshot {
  validateGatewayNetV1Coproducer({
    coproducerType: input.coproducerType,
    coproducerExpertId: null,
    coproducerShareBasisPoints: input.coproducerShareBasisPoints,
  });
  assertBasisPoints(
    input.ownerExpertShareBasisPoints,
    "Owner expert share",
  );
  assertBasisPoints(
    input.coproducerShareBasisPoints,
    "Coproducer share",
  );
  if (input.ownerType === "automatize") {
    if (
      input.ownerExpertShareBasisPoints !== 0 ||
      input.coproducerType !== null ||
      input.coproducerShareBasisPoints !== 0
    ) {
      throw new Error("Automatize products cannot have expert coproduction");
    }
  } else if (
    input.ownerExpertShareBasisPoints + input.coproducerShareBasisPoints !==
    10_000
  ) {
    throw new Error("Owner and coproducer shares must sum to 100%");
  }

  const snapshotBase = {
    financialModel: "gateway_net_v1" as const,
    platformFeeBasisPoints: 0 as const,
    platformFeeFixedCentavos: 0 as const,
    marketplaceFeeBasisPoints: 0 as const,
    ownerExpertShareBasisPoints: input.ownerExpertShareBasisPoints,
    coproducerType:
      input.coproducerType === "automatize" ? ("automatize" as const) : null,
    coproducerShareBasisPoints: input.coproducerShareBasisPoints,
  };

  if (input.paymentMethod !== "card") {
    return {
      ...snapshotBase,
      gatewayFeeEstimateBps: null,
      gatewayFeeEstimateFixedCentavos: null,
    };
  }

  const estimate =
    input.gatewayFeeEstimateBps === undefined &&
    input.gatewayFeeEstimateFixedCentavos === undefined
      ? readStripeBrCardFeeEstimate()
      : {
          bps: input.gatewayFeeEstimateBps ?? 0,
          fixedCentavos: input.gatewayFeeEstimateFixedCentavos ?? 0,
        };
  assertBasisPoints(estimate.bps, "Gateway fee estimate bps");
  assertCentavos(estimate.fixedCentavos, "Gateway fee estimate fixed");

  return {
    ...snapshotBase,
    gatewayFeeEstimateBps: estimate.bps,
    gatewayFeeEstimateFixedCentavos: estimate.fixedCentavos,
  };
}

/** Pix MP: líquido real, Expert share half-up, Automatize gets the remainder. */
export function calculateGatewayNetV1PixSettlement(input: {
  grossAmountCentavos: number;
  providerFeeAmountCentavos: number;
  ownerExpertShareBasisPoints: number;
  coproducerShareBasisPoints: number;
  coproducerType: "automatize" | null;
}): GatewayNetV1PixSettlement {
  assertCentavos(input.grossAmountCentavos, "Gross amount");
  assertCentavos(input.providerFeeAmountCentavos, "Provider fee");
  assertBasisPoints(
    input.ownerExpertShareBasisPoints,
    "Owner expert share",
  );
  assertBasisPoints(
    input.coproducerShareBasisPoints,
    "Coproducer share",
  );
  if (input.providerFeeAmountCentavos > input.grossAmountCentavos) {
    throw new Error("Provider fee cannot exceed the gross amount");
  }
  validateGatewayNetV1Coproducer({
    coproducerType: input.coproducerType,
    coproducerExpertId: null,
    coproducerShareBasisPoints: input.coproducerShareBasisPoints,
  });

  const netAmountCentavos =
    input.grossAmountCentavos - input.providerFeeAmountCentavos;
  const ownerExpertReceivableCentavos =
    input.ownerExpertShareBasisPoints === 0
      ? 0
      : Math.round(
          (netAmountCentavos * input.ownerExpertShareBasisPoints) / 10_000,
        );
  const automatizeCoproductionRevenueCentavos =
    netAmountCentavos - ownerExpertReceivableCentavos;

  return {
    netAmountCentavos,
    ownerExpertReceivableCentavos,
    automatizeCoproductionRevenueCentavos,
  };
}

/** Cartão Stripe: Tarifa Estimada do Gateway → application_fee da Coprodução. */
export function calculateGatewayNetV1StripeApplicationFee(input: {
  grossAmountCentavos: number;
  gatewayFeeEstimateBps: number;
  gatewayFeeEstimateFixedCentavos: number;
  coproducerShareBasisPoints: number;
  coproducerType: "automatize" | null;
}): GatewayNetV1StripeApplicationFee {
  assertCentavos(input.grossAmountCentavos, "Gross amount");
  assertBasisPoints(input.gatewayFeeEstimateBps, "Gateway fee estimate bps");
  assertCentavos(
    input.gatewayFeeEstimateFixedCentavos,
    "Gateway fee estimate fixed",
  );
  validateGatewayNetV1Coproducer({
    coproducerType: input.coproducerType,
    coproducerExpertId: null,
    coproducerShareBasisPoints: input.coproducerShareBasisPoints,
  });

  const gatewayFeeEstimateCentavos =
    Math.round(
      (input.grossAmountCentavos * input.gatewayFeeEstimateBps) / 10_000,
    ) + input.gatewayFeeEstimateFixedCentavos;
  const applicationFeeCentavos =
    input.coproducerType === "automatize" && input.coproducerShareBasisPoints > 0
      ? Math.round(
          ((input.grossAmountCentavos - gatewayFeeEstimateCentavos) *
            input.coproducerShareBasisPoints) /
            10_000,
        )
      : 0;

  return { gatewayFeeEstimateCentavos, applicationFeeCentavos };
}

export function allocateGatewayNetV1ApplicationFeeAcrossOrders({
  orderPricesCentavos,
  totalApplicationFeeCentavos,
}: {
  orderPricesCentavos: number[];
  totalApplicationFeeCentavos: number;
}): number[] {
  if (orderPricesCentavos.length === 0) {
    throw new Error("checkout has no orders");
  }
  assertCentavos(totalApplicationFeeCentavos, "Total application fee");
  for (const price of orderPricesCentavos) {
    assertCentavos(price, "Order price");
  }

  const totalWeight = orderPricesCentavos.reduce(
    (sum, price) => sum + price,
    0,
  );
  if (totalWeight <= 0) {
    throw new Error("checkout total mismatch");
  }

  let allocated = 0;
  return orderPricesCentavos.map((price, index) => {
    if (index === orderPricesCentavos.length - 1) {
      return totalApplicationFeeCentavos - allocated;
    }
    const share = Math.floor(
      (totalApplicationFeeCentavos * price) / totalWeight,
    );
    allocated += share;
    return share;
  });
}

export function isGatewayNetV1Model(
  financialModel: ProductFinancialModel,
): financialModel is Extract<ProductFinancialModel, "gateway_net_v1"> {
  return financialModel === "gateway_net_v1";
}
