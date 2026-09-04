import {
  BILLING_PROVIDER_VALUES,
  type BillingProvider,
  type PaymentSettlementMethod,
} from "@/lib/db/schema";

export type FinanceProvider = "card" | "pix" | "manual";

export const UNCLASSIFIED_FINANCE_PROVIDER_LABEL = "sem classificação";

/**
 * `payments.provider` é varchar, não enum do banco: uma linha antiga pode trazer
 * qualquer string. Antes da M2 isso era o `vindi` explícito em cada mapa de
 * rótulo; agora é uma regra só — provedor fora do domínio não é classificado.
 */
export function isKnownBillingProvider(
  provider: string | null | undefined,
): provider is BillingProvider {
  return (BILLING_PROVIDER_VALUES as readonly string[]).includes(provider ?? "");
}

export function financeProvider(input: {
  provider: BillingProvider;
  paymentMethod?: PaymentSettlementMethod | null;
}): FinanceProvider | null {
  if (input.provider === "stripe") return "card";
  if (input.provider === "mercadopago") return "pix";
  if (input.provider === "manual") return "manual";
  return null;
}

export function financeProviderLabel(
  input: Parameters<typeof financeProvider>[0],
): string {
  const bucket = financeProvider(input);
  if (bucket === "card") return "Cartão";
  if (bucket === "pix") return "PIX";
  if (bucket === "manual") return "Manual";
  return UNCLASSIFIED_FINANCE_PROVIDER_LABEL;
}
