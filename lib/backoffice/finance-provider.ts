import type {
  BillingProvider,
  PaymentSettlementMethod,
  VindiSubscriptionPaymentMethod,
} from "@/lib/db/schema";

export type FinanceProvider = "card" | "pix" | "manual";

export function financeProvider(input: {
  provider: BillingProvider;
  paymentMethod?: PaymentSettlementMethod | null;
  vindiPaymentMethod?: VindiSubscriptionPaymentMethod | null;
}): FinanceProvider | null {
  if (input.provider === "stripe") return "card";
  if (input.provider === "mercadopago") return "pix";
  if (input.provider === "manual") return "manual";
  if (input.provider === "vindi") {
    const method =
      input.paymentMethod ??
      (input.vindiPaymentMethod === "credit_card"
        ? "credit_card"
        : input.vindiPaymentMethod === "pix_automatic" ||
            input.vindiPaymentMethod === "pix_qr"
          ? "pix"
          : null);
    if (method === "credit_card") return "card";
    if (method === "pix") return "pix";
    return null;
  }
  return null;
}

export function financeProviderLabel(
  input: Parameters<typeof financeProvider>[0],
): string {
  const bucket = financeProvider(input);
  if (bucket === "card") return "Cartão";
  if (bucket === "pix") return "PIX";
  if (bucket === "manual") return "Manual";
  return input.provider === "vindi" ? "Vindi" : input.provider;
}
