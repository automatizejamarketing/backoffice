import { z } from "zod";
import type { ProductOwnerType, ProductStatus } from "@/lib/db/schema";

/** The platform participation is a percentage, stored as basis points. */
export const MAX_PLATFORM_PARTICIPATION_BPS = 9_999;
export const PRODUCT_PARTICIPATION_RULE_VERSION = "product_participation_v1" as const;

const participationPercentSchema = z
  .number({ invalid_type_error: "Informe a participação do Automatize." })
  .finite("Informe uma participação válida.")
  .refine((value) => value >= 0, "A participação não pode ser negativa.")
  .refine(
    (value) => value <= MAX_PLATFORM_PARTICIPATION_BPS / 100,
    "A participação deve ser menor que 100%.",
  )
  .refine(
    (value) => Number.isInteger(value * 100),
    "A participação pode ter no máximo duas casas decimais.",
  );

export function parsePlatformParticipationPercent(value: unknown): number {
  return participationPercentSchema.parse(value);
}

export function platformParticipationPercentToBps(value: number): number {
  return Math.round(parsePlatformParticipationPercent(value) * 100);
}

export function platformParticipationBpsToPercent(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PLATFORM_PARTICIPATION_BPS) {
    throw new Error("A participação deve estar entre 0% e 99,99%.");
  }
  return value / 100;
}

export type ProductEligibilityReason =
  | "eligible"
  | "not_published"
  | "sales_disabled"
  | "expert_missing"
  | "participation_missing"
  | "participation_invalid"
  | "expert_connection_required"
  | "expert_connection_not_eligible"
  | "expert_card_contract_required";

export type ProductCommercialEligibility = {
  eligible: boolean;
  reason: ProductEligibilityReason;
  message: string;
  platformParticipationBps: number | null;
  expertParticipationBps: number | null;
};

export type ProductParticipationSnapshot = {
  platformParticipationBps: number;
  ownerExpertShareBasisPoints: number;
  coproducerType: "automatize" | null;
  coproducerShareBasisPoints: number;
  participationRuleVersion: typeof PRODUCT_PARTICIPATION_RULE_VERSION;
};

/**
 * Converts the explicit Product agreement into the fields consumed by the
 * existing gateway settlement model. The old coproduction fields are inputs
 * only for backwards-compatible parsing; they never win over the new
 * per-Product agreement for a newly issued order.
 */
export function resolveProductParticipationSnapshot(input: {
  ownerType: ProductOwnerType;
  expertParticipationBps: number | null;
  coproducerType?: ProductOwnerType | null;
  coproducerShareBasisPoints?: number;
}): ProductParticipationSnapshot {
  if (input.ownerType === "automatize") {
    return {
      platformParticipationBps: 0,
      ownerExpertShareBasisPoints: 0,
      coproducerType: null,
      coproducerShareBasisPoints: 0,
      participationRuleVersion: PRODUCT_PARTICIPATION_RULE_VERSION,
    };
  }

  if (
    input.expertParticipationBps === null ||
    !Number.isInteger(input.expertParticipationBps) ||
    input.expertParticipationBps < 0 ||
    input.expertParticipationBps > MAX_PLATFORM_PARTICIPATION_BPS
  ) {
    throw new Error(
      "Defina explicitamente a participação do Automatize entre 0% e 99,99% antes de vender.",
    );
  }

  return {
    platformParticipationBps: input.expertParticipationBps,
    ownerExpertShareBasisPoints: 10_000 - input.expertParticipationBps,
    coproducerType: input.expertParticipationBps > 0 ? "automatize" : null,
    coproducerShareBasisPoints: input.expertParticipationBps,
    participationRuleVersion: PRODUCT_PARTICIPATION_RULE_VERSION,
  };
}

/**
 * Shared read-side contract for checkout and catalog surfaces. Connection
 * aptitude is an explicit input so callers cannot accidentally treat a
 * connected-but-unknown account as eligible.
 */
export function getProductCommercialEligibility(input: {
  ownerType: ProductOwnerType;
  expertId: string | null;
  expertParticipationBps: number | null;
  status: ProductStatus;
  salesEnabled: boolean;
  expertConnection?: "not_connected" | "not_eligible" | "eligible";
}): ProductCommercialEligibility {
  const calculatedShares = {
    platformParticipationBps: input.expertParticipationBps,
    expertParticipationBps:
      input.expertParticipationBps === null
        ? null
        : 10_000 - input.expertParticipationBps,
  };

  if (input.status !== "published") {
    return {
      ...calculatedShares,
      eligible: false,
      reason: "not_published",
      message: "O produto precisa estar publicado para ser vendido.",
    };
  }
  if (!input.salesEnabled) {
    return {
      ...calculatedShares,
      eligible: false,
      reason: "sales_disabled",
      message: "As vendas deste produto estão pausadas.",
    };
  }
  if (input.ownerType === "automatize") {
    return {
      ...calculatedShares,
      eligible: true,
      reason: "eligible",
      message: "Produto próprio elegível para venda.",
      platformParticipationBps: 0,
      expertParticipationBps: 0,
    };
  }
  if (!input.expertId) {
    return {
      ...calculatedShares,
      eligible: false,
      reason: "expert_missing",
      message: "Informe o proprietário Expert antes de habilitar as vendas.",
    };
  }
  if (
    input.expertParticipationBps === null
  ) {
    return {
      ...calculatedShares,
      eligible: false,
      reason: "participation_missing",
      message:
        "Defina explicitamente a participação do Automatize entre 0% e 99,99% antes de vender.",
    };
  }

  if (
    !Number.isInteger(input.expertParticipationBps) ||
    input.expertParticipationBps < 0 ||
    input.expertParticipationBps > MAX_PLATFORM_PARTICIPATION_BPS
  ) {
    return {
      ...calculatedShares,
      eligible: false,
      reason: "participation_invalid",
      message:
        "A participação do Automatize deve estar entre 0% e 99,99%, com no máximo duas casas decimais.",
    };
  }

  if (input.expertConnection !== "eligible") {
    return {
      ...calculatedShares,
      eligible: false,
      reason:
        input.expertConnection === "not_eligible"
          ? "expert_connection_not_eligible"
          : "expert_connection_required",
      message:
        input.expertConnection === "not_eligible"
          ? "A conta Mercado Pago do Expert não está apta para receber esta venda."
          : "Conecte e habilite a conta Mercado Pago do Expert antes de vender.",
    };
  }

  return {
    ...calculatedShares,
    eligible: true,
    reason: "eligible",
    message: "Produto de Expert elegível para venda.",
  };
}

export function assertProductCommercialEligibility(input: Parameters<typeof getProductCommercialEligibility>[0]) {
  const eligibility = getProductCommercialEligibility(input);
  if (!eligibility.eligible) throw new Error(eligibility.message);
  return eligibility;
}

/** Both positive participants must receive at least one centavo per item. */
export function assertMinimumParticipationAmounts({
  commercialAmountCentavos,
  platformParticipationBps,
}: {
  commercialAmountCentavos: number;
  platformParticipationBps: number;
}) {
  if (!Number.isSafeInteger(commercialAmountCentavos) || commercialAmountCentavos <= 0) {
    throw new Error("O valor comercial deve ser positivo.");
  }
  const platformAmount = Math.round(
    (commercialAmountCentavos * platformParticipationBps) / 10_000,
  );
  const expertAmount = commercialAmountCentavos - platformAmount;
  if (platformParticipationBps > 0 && platformAmount < 1) {
    throw new Error("A participação do Automatize precisa receber pelo menos R$0,01 por item.");
  }
  if (
    10_000 - platformParticipationBps > 0 &&
    expertAmount < 1
  ) {
    throw new Error("A participação do Expert precisa receber pelo menos R$0,01 por item.");
  }
}
