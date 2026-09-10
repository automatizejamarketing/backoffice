import {
  buildGatewayNetV1OrderSnapshot,
  type GatewayNetV1OrderSnapshot,
} from "./gateway-net-v1";
import type { ProductFinancialModel, ProductOwnerType } from "@/lib/db/schema";

/**
 * Coprodução sobre o BRUTO.
 *
 * O Expert custeia integralmente a tarifa do provedor e o Automatize retira
 * apenas sua participação, calculada sobre o preço comercial da Aquisição.
 * Nenhuma tarifa entra na divisão, e é exatamente por isso que a regra não
 * depende de contrato de custo com o provedor — a diferença que separa este
 * modelo de `gateway_net_v1`, onde as duas partes rateavam a tarifa.
 *
 * O modelo anterior continua existindo, e não por gentileza: os pedidos já
 * gravados foram precificados sobre o líquido. Reetiquetá-los mudaria o
 * significado do passado e quebraria a conciliação deles.
 */
export type GatewayGrossV1OrderSnapshot = Omit<
  GatewayNetV1OrderSnapshot,
  | "financialModel"
  | "platformFeeBasisPoints"
  | "gatewayFeeEstimateBps"
  | "gatewayFeeEstimateFixedCentavos"
> & {
  /** Taxa de transação do Expert; zero em Produto próprio do Automatize. */
  platformFeeBasisPoints: number;
  financialModel: Extract<ProductFinancialModel, "gateway_gross_v1">;
  /** Sempre nulos: sem tarifa na divisão, não há estimativa a congelar. */
  gatewayFeeEstimateBps: null;
  gatewayFeeEstimateFixedCentavos: null;
};

export function buildGatewayGrossV1OrderSnapshot(input: {
  /** Taxa de transação do Expert, em basis points sobre o bruto. */
  platformFeeBasisPoints: number;
  ownerType: ProductOwnerType;
  ownerExpertShareBasisPoints: number;
  coproducerType: ProductOwnerType | null;
  coproducerShareBasisPoints: number;
  paymentMethod?: "card" | "pix" | "free";
}): GatewayGrossV1OrderSnapshot {
  // Reaproveita as validações de coprodução e de soma das participações, que
  // são idênticas nos dois modelos; só a base de cálculo mudou.
  const base = buildGatewayNetV1OrderSnapshot({
    ...input,
    paymentProvider: "mercadopago",
  });
  if (
    !Number.isInteger(input.platformFeeBasisPoints) ||
    input.platformFeeBasisPoints < 0 ||
    input.platformFeeBasisPoints > 10_000
  ) {
    throw new Error("Platform fee must be between 0 and 10000 basis points");
  }
  return {
    ...base,
    platformFeeBasisPoints: input.platformFeeBasisPoints,
    financialModel: "gateway_gross_v1",
    gatewayFeeEstimateBps: null,
    gatewayFeeEstimateFixedCentavos: null,
  };
}
