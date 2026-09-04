import type { ProductFinancialModel, ProductOwnerType } from "@/lib/db/schema";

/** Cópia local de `automatize-frontend/lib/products/gateway-net-v1.ts` — os repos
 * não se importam; mantém paridade das fórmulas do modelo `gateway_net_v1`. */

export type GatewayNetV1PixSettlement = {
  netAmountCentavos: number;
  ownerExpertReceivableCentavos: number;
  automatizeCoproductionRevenueCentavos: number;
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
}

/** Pix MP: líquido real, parte do Expert half-up, Coprodução do Automatize fica com o resto. */
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

/** Cartão Stripe: Tarifa Estimada do Gateway → `application_fee` da Coprodução do Automatize. */
export function calculateGatewayNetV1StripeApplicationFee(input: {
  grossAmountCentavos: number;
  gatewayFeeEstimateBps: number;
  gatewayFeeEstimateFixedCentavos: number;
  coproducerShareBasisPoints: number;
  coproducerType: "automatize" | null;
}): {
  gatewayFeeEstimateCentavos: number;
  applicationFeeCentavos: number;
} {
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

export function isGatewayNetV1Model(
  financialModel: ProductFinancialModel,
): financialModel is Extract<ProductFinancialModel, "gateway_net_v1"> {
  return financialModel === "gateway_net_v1";
}
