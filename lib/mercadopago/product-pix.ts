import "server-only";

import { extractPixCopyPasteCode } from "@/lib/mercadopago/pix-payment-utils";
import { resolveProductPixAccessToken } from "@/lib/mercadopago/product-account";

type MercadoPagoPixPaymentResponse = {
  id?: number | string;
  status?: string;
  point_of_interaction?: {
    transaction_data?: { qr_code?: string; ticket_url?: string };
  };
};

export type ProductPixCharge = {
  paymentId: string;
  pixCopyPasteCode: string;
};

function toBRLUnitAmount(amountCentavos: number): number {
  return Number((amountCentavos / 100).toFixed(2));
}

/**
 * Cobrança Pix de infoproduto criada pelo backoffice.
 *
 * O `metadata` é o contrato que `parseProductPaymentMetadata` do app valida
 * (lib/products/payment.ts): sem `payment_context: "digital_product"` e
 * `product_order_id`, o webhook devolve `not_product` e cai no processador de
 * assinatura. É esse metadata — e só ele — que faz o pagamento voltar pelo
 * caminho normal de aprovação, com entitlement e e-mail de magic link.
 *
 * `attempt` entra na chave de idempotência de propósito. O app monta a dele
 * como `sha256(orderId:valor:bumps)`, então uma segunda cobrança do mesmo
 * pedido pelo mesmo valor devolveria a PRIMEIRA cobrança — a que venceu. Sem
 * discriminador, "gerar outro Pix" devolveria o código morto.
 */
export async function createProductRecoveryPixCharge({
  orderId,
  orderBumpOrderIds,
  productTitle,
  buyerEmail,
  amountCentavos,
  expiresAt,
  notificationUrl,
  attempt,
}: {
  orderId: string;
  orderBumpOrderIds: string[];
  productTitle: string;
  buyerEmail: string;
  amountCentavos: number;
  expiresAt: Date;
  notificationUrl: string | null;
  attempt: string;
}): Promise<ProductPixCharge> {
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await resolveProductPixAccessToken()}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `product-pix-recovery:${orderId}:${attempt}`,
    },
    body: JSON.stringify({
      transaction_amount: toBRLUnitAmount(amountCentavos),
      description: `Infoproduto: ${productTitle}`.slice(0, 255),
      payment_method_id: "pix",
      payer: { email: buyerEmail },
      external_reference: orderId,
      // Vazia = inalcançável pela MP (localhost/http), e mandar assim faz a MP
      // recusar a cobrança inteira. Omitir só custa o webhook; o polling do
      // checkout e o cron continuam fechando o pagamento.
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
      date_of_expiration: expiresAt.toISOString(),
      metadata: {
        payment_context: "digital_product",
        product_order_id: orderId,
        order_bump_order_ids: orderBumpOrderIds.join(","),
        product_title: productTitle,
        amount_centavos: amountCentavos,
        payment_method: "pix",
        source: "backoffice_recovery",
      },
    }),
  });

  if (!response.ok) {
    // A MP às vezes recusa com corpo vazio; o status é a única pista que sempre
    // existe. Sem isto o formatador recebia string em branco e apagava o motivo.
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

/**
 * Relê uma cobrança de produto na MP para recuperar o copia-e-cola.
 *
 * Necessário porque `product_payments` guarda o id do pagamento, não o código
 * EMV: quando o admin reabre o diálogo de um Pix que ele mesmo gerou há pouco,
 * o código tem que vir da MP. Mesma conta da criação, resolvida do mesmo jeito.
 */
export async function fetchProductPixCharge(
  paymentId: string,
): Promise<{ status: string | null; pixCopyPasteCode: string | null } | null> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${await resolveProductPixAccessToken()}` },
      cache: "no-store",
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await response.text()).trim());

  const payment = (await response.json()) as MercadoPagoPixPaymentResponse;
  return {
    status: payment.status ?? null,
    pixCopyPasteCode: extractPixCopyPasteCode(payment),
  };
}
