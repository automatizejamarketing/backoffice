import type { BillingProvider, PaymentSettlementMethod } from "@/lib/db/schema";

export type FinanceProvider = "card" | "pix" | "manual";

export const UNCLASSIFIED_FINANCE_PROVIDER_LABEL = "sem classificação";

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
