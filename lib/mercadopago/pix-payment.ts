import "server-only";

import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import type { MercadoPagoPaymentLink, PlanType } from "@/lib/db/schema";
import { extractPixCopyPasteCode } from "@/lib/mercadopago/pix-payment-utils";
import {
  isPayableMercadoPagoPixStatus,
  isTerminalMercadoPagoPixStatus,
} from "./pix-retention-contract";
export { isPayableMercadoPagoPixStatus, isTerminalMercadoPagoPixStatus } from "./pix-retention-contract";

type MercadoPagoPixPaymentResponse = {
  id?: number | string;
  status?: string;
  transaction_amount?: number | string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      ticket_url?: string;
    };
  };
};

export type MercadoPagoPixPayment = MercadoPagoPixPaymentResponse;

export type PixCopyPasteDetails = {
  paymentId: string;
  pixCopyPasteCode: string;
};

function collectPixPaymentAccessTokens(): string[] {
  const tokens = [
    process.env.MERCADOPAGO_SUBSCRIPTION_ACCESS_TOKEN,
    process.env.MERCADOPAGO_FRONTEND_ACCESS_TOKEN,
    process.env.MERCADOPAGO_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_ACCESS_TOKEN,
  ].filter((token): token is string => Boolean(token?.trim()));

  return [...new Set(tokens)];
}

function getPixPaymentAccessToken(): string {
  const [token] = collectPixPaymentAccessTokens();
  if (!token) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
  }
  return token;
}

function toBRLUnitAmount(amountCentavos: number): number {
  return Number((amountCentavos / 100).toFixed(2));
}

export async function getMercadoPagoPixPayment(
  paymentId: string,
): Promise<MercadoPagoPixPaymentResponse | null> {
  for (const token of collectPixPaymentAccessTokens()) {
    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      },
    );

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      if (body.toLowerCase().includes("payment not found")) {
        continue;
      }
      throw new Error(body);
    }

    return (await response.json()) as MercadoPagoPixPaymentResponse;
  }

  return null;
}

/** Cancel a still-payable PIX and return the provider's authoritative state. */
export async function cancelMercadoPagoPixPayment(
  paymentId: string,
): Promise<MercadoPagoPixPaymentResponse> {
  const token = getPixPaymentAccessToken();
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "cancelled" }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Mercado Pago cancellation failed (HTTP ${response.status}).`);
  }

  return (await response.json()) as MercadoPagoPixPaymentResponse;
}

export async function createMercadoPagoPixPayment({
  linkId,
  userId,
  email,
  planType,
  amountCentavos,
  expiresAt,
  notificationUrl,
  idempotencySuffix,
  providerIdempotencyKey,
  retentionBenefitId,
  originalAmountCentavos,
  discountAmountCentavos,
}: {
  linkId: string;
  userId: string;
  email: string;
  planType: PlanType;
  amountCentavos: number;
  expiresAt: Date;
  notificationUrl: string;
  idempotencySuffix?: string;
  providerIdempotencyKey?: string;
  retentionBenefitId?: string;
  originalAmountCentavos?: number;
  discountAmountCentavos?: number;
}): Promise<PixCopyPasteDetails> {
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPixPaymentAccessToken()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": providerIdempotencyKey ?? (idempotencySuffix
        ? `pix-link:${linkId}:${idempotencySuffix}`
        : `pix-link:${linkId}`),
    },
    body: JSON.stringify({
      transaction_amount: toBRLUnitAmount(amountCentavos),
      description: `Automatize ${PLAN_DEFINITIONS[planType].name}`,
      payment_method_id: "pix",
      payer: { email },
      external_reference: linkId,
      // Vazia = não alcançável pela MP (localhost, http). Mandar assim faz a MP
      // recusar a cobrança inteira; omitir só custa o webhook, e o polling e o
      // cron continuam fechando o pagamento.
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      date_of_expiration: expiresAt.toISOString(),
      metadata: {
        payment_link_id: linkId,
        user_id: userId,
        plan_type: planType,
        amount_centavos: amountCentavos,
        source: "backoffice",
        ...(retentionBenefitId
          ? {
              retention_benefit_id: retentionBenefitId,
              original_amount_centavos: originalAmountCentavos ?? amountCentavos,
              discount_amount_centavos: discountAmountCentavos ?? 0,
              final_amount_centavos: amountCentavos,
            }
          : {}),
      },
    }),
  });

  if (!response.ok) {
    // A MP às vezes recusa com corpo vazio, e aí `new Error("")` chegava ao
    // formatador como mensagem em branco — que devolvia "Não foi possível gerar
    // o link Pix." e apagava a única pista de por quê. O status sempre existe.
    const body = (await response.text()).trim();
    throw new Error(
      body || `Mercado Pago recusou a cobrança (HTTP ${response.status}).`,
    );
  }

  const payment = (await response.json()) as MercadoPagoPixPaymentResponse;
  const paymentId = payment.id ? String(payment.id) : null;
  const pixCopyPasteCode = extractPixCopyPasteCode(payment);

  if (!paymentId || !pixCopyPasteCode) {
    throw new Error("Resposta do Mercado Pago não incluiu o código Pix.");
  }

  return { paymentId, pixCopyPasteCode };
}

export async function ensurePixCopyPasteCode({
  link,
  email,
  notificationUrl,
}: {
  link: MercadoPagoPaymentLink;
  email: string;
  notificationUrl: string;
}): Promise<PixCopyPasteDetails> {
  if (link.mercadopagoPaymentId) {
    const existingPayment = await getMercadoPagoPixPayment(
      link.mercadopagoPaymentId,
    );
    const pixCopyPasteCode = existingPayment
      ? extractPixCopyPasteCode(existingPayment)
      : null;

    if (
      existingPayment &&
      pixCopyPasteCode &&
      isPayableMercadoPagoPixStatus(existingPayment.status)
    ) {
      return {
        paymentId: link.mercadopagoPaymentId,
        pixCopyPasteCode,
      };
    }
  }

  return createMercadoPagoPixPayment({
    linkId: link.id,
    userId: link.userId,
    email,
    planType: link.planType,
    amountCentavos: link.amount,
    expiresAt: link.expiresAt,
    notificationUrl,
    idempotencySuffix: link.mercadopagoPaymentId ? "retry" : undefined,
  });
}
