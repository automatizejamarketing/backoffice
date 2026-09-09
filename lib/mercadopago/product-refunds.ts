import "server-only";

export class MercadoPagoRefundError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(`Mercado Pago refund failed (${status})`);
    this.name = "MercadoPagoRefundError";
  }
}

/** Only the provider's explicit insufficient-money response creates a
 * balance case. A generic 4xx must remain a normal refund failure. */
export function isMercadoPagoInsufficientBalanceError(error: unknown): boolean {
  if (!(error instanceof MercadoPagoRefundError) || error.status !== 428) {
    return false;
  }
  const body = JSON.stringify(error.responseBody).toLowerCase();
  return body.includes("insufficient_money_for_refund") ||
    (body.includes("insufficient") && (body.includes("balance") || body.includes("fund")));
}

export async function refundMercadoPagoProductPayment(
  paymentId: string,
  idempotencyKey: string,
  accessToken?: string,
) {
  const token =
    accessToken?.trim() ||
    (process.env.MERCADOPAGO_ACCESS_TOKEN ??
      process.env.MERCADO_PAGO_ACCESS_TOKEN);
  if (!token) throw new Error("Mercado Pago não configurado");
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: "{}",
    },
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let responseBody: unknown = bodyText;
    try {
      responseBody = JSON.parse(bodyText);
    } catch {
      // Keep the raw body for diagnostics when the provider does not return JSON.
    }
    throw new MercadoPagoRefundError(response.status, responseBody);
  }
  return response.json() as Promise<{ id?: number | string; status?: string }>;
}
