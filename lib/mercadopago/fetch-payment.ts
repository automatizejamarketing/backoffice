import "server-only";

export type MercadoPagoPayment = {
  id: number | string;
  transaction_amount?: number;
  transaction_details?: {
    net_received_amount?: number;
  };
  fee_details?: Array<{ amount?: number }>;
};

export class MercadoPagoPaymentNotFoundError extends Error {
  paymentId: string;

  constructor(paymentId: string) {
    super(`Mercado Pago payment ${paymentId} not found`);
    this.name = "MercadoPagoPaymentNotFoundError";
    this.paymentId = paymentId;
  }
}

function collectMercadoPagoAccessTokens(): string[] {
  const tokens = [
    process.env.MERCADOPAGO_SUBSCRIPTION_ACCESS_TOKEN,
    process.env.MERCADOPAGO_FRONTEND_ACCESS_TOKEN,
    process.env.MERCADOPAGO_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_ACCESS_TOKEN,
    process.env.MERCADOPAGO_LEGACY_ACCESS_TOKEN,
  ].filter((token): token is string => Boolean(token?.trim()));

  return [...new Set(tokens)];
}

async function fetchMercadoPagoPaymentWithToken(
  paymentId: string,
  accessToken: string,
): Promise<MercadoPagoPayment | null> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Mercado Pago payment ${paymentId} fetch failed (${response.status}): ${body}`,
    );
  }

  return (await response.json()) as MercadoPagoPayment;
}

export async function getMercadoPagoPayment(
  paymentId: string,
): Promise<MercadoPagoPayment> {
  const tokens = collectMercadoPagoAccessTokens();
  if (tokens.length === 0) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
  }

  let lastNotFound = false;
  for (const token of tokens) {
    const payment = await fetchMercadoPagoPaymentWithToken(paymentId, token);
    if (payment) {
      return payment;
    }
    lastNotFound = true;
  }

  if (lastNotFound) {
    throw new MercadoPagoPaymentNotFoundError(paymentId);
  }

  throw new Error(`Mercado Pago payment ${paymentId} could not be fetched`);
}
