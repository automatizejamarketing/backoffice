import "server-only";

export async function refundMercadoPagoProductPayment(
  paymentId: string,
  idempotencyKey: string,
) {
  const token =
    process.env.MERCADOPAGO_ACCESS_TOKEN ??
    process.env.MERCADO_PAGO_ACCESS_TOKEN;
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
    const body = await response.text().catch(() => "");
    throw new Error(`Mercado Pago recusou o reembolso (${response.status}): ${body}`);
  }
  return response.json() as Promise<{ id?: number | string; status?: string }>;
}
