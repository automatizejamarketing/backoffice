import "server-only";

import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import type { MercadoPagoPaymentLink, PlanType } from "@/lib/db/schema";
import { extractPixCopyPasteCode } from "@/lib/mercadopago/pix-payment-utils";

type MercadoPagoPixPaymentResponse = {
  id?: number | string;
  status?: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      ticket_url?: string;
    };
  };
};

export type PixCopyPasteDetails = {
  paymentId: string;
  pixCopyPasteCode: string;
};

function getPixPaymentAccessToken(): string {
  const token =
    process.env.MERCADOPAGO_ACCESS_TOKEN ??
    process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
  }
  return token;
}

function toBRLUnitAmount(amountCentavos: number): number {
  return Number((amountCentavos / 100).toFixed(2));
}

function isPendingPixPayment(status: string | undefined): boolean {
  return status === "pending" || status === "in_process";
}

async function fetchMercadoPagoPixPayment(
  paymentId: string,
): Promise<MercadoPagoPixPaymentResponse | null> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${getPixPaymentAccessToken()}`,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    if (body.toLowerCase().includes("payment not found")) {
      return null;
    }
    throw new Error(body);
  }

  return (await response.json()) as MercadoPagoPixPaymentResponse;
}

async function createMercadoPagoPixPayment({
  linkId,
  userId,
  email,
  planType,
  amountCentavos,
  expiresAt,
  notificationUrl,
  idempotencySuffix,
}: {
  linkId: string;
  userId: string;
  email: string;
  planType: PlanType;
  amountCentavos: number;
  expiresAt: Date;
  notificationUrl: string;
  idempotencySuffix?: string;
}): Promise<PixCopyPasteDetails> {
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPixPaymentAccessToken()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencySuffix
        ? `pix-link:${linkId}:${idempotencySuffix}`
        : `pix-link:${linkId}`,
    },
    body: JSON.stringify({
      transaction_amount: toBRLUnitAmount(amountCentavos),
      description: `Automatize ${PLAN_DEFINITIONS[planType].name}`,
      payment_method_id: "pix",
      payer: { email },
      external_reference: linkId,
      notification_url: notificationUrl,
      date_of_expiration: expiresAt.toISOString(),
      metadata: {
        payment_link_id: linkId,
        user_id: userId,
        plan_type: planType,
        amount_centavos: amountCentavos,
        source: "backoffice",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
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
    const existingPayment = await fetchMercadoPagoPixPayment(
      link.mercadopagoPaymentId,
    );
    const pixCopyPasteCode = existingPayment
      ? extractPixCopyPasteCode(existingPayment)
      : null;

    if (
      existingPayment &&
      pixCopyPasteCode &&
      isPendingPixPayment(existingPayment.status)
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
