import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { productOrder, productPayment } from "@/lib/db/schema";
import { buyerHasOtherOpenProductOrder } from "@/lib/db/product-queries";
import {
  createProductRecoveryPixCharge,
  fetchProductPixCharge,
} from "@/lib/mercadopago/product-pix";
import { getPublicMercadoPagoWebhookUrl } from "@/lib/mercadopago/pix";
import {
  evaluateRecoveryPix,
  parseOrderBumpOrderIds,
  readRecoveryPixStamp,
  recoveryPixExpiresAt,
  writeRecoveryPixStamp,
  type RecoveryPixRefusal,
} from "./recovery-pix-policy";

export type RecoveryPixResult =
  | {
      ok: true;
      reused: boolean;
      pixCopyPasteCode: string;
      amountCentavos: number;
      currency: string;
      expiresAt: Date;
      generatedAt: Date;
      adminEmail: string;
      attempts: number;
      orderIds: string[];
    }
  | { ok: false; reason: RecoveryPixRefusal | "order_not_found" | "webhook_unreachable" };

/**
 * Gera (ou reaproveita) o Pix que o vendedor manda no WhatsApp.
 *
 * O ponto inteiro desta função é NÃO inventar um caminho de liberação. A
 * cobrança nasce com o mesmo `metadata` do checkout, então quando o cliente
 * paga é o webhook de sempre que roda: `processProductPayment` →
 * `settleApprovedProductCheckout` → entitlement + e-mail de magic link. Nada
 * aqui aprova pedido; aqui só se cria cobrança e se reabre o pedido para o
 * estado em que a aprovação sabe operar.
 */
export async function generateRecoveryPix({
  orderId,
  adminEmail,
  now = new Date(),
}: {
  orderId: string;
  adminEmail: string;
  now?: Date;
}): Promise<RecoveryPixResult> {
  const [row] = await db
    .select({
      order: productOrder,
      paymentStatus: productPayment.status,
      paymentRawStatus: productPayment.rawStatus,
      paymentMethodId: productPayment.paymentMethodId,
      providerPaymentId: productPayment.providerPaymentId,
    })
    .from(productOrder)
    .leftJoin(productPayment, eq(productPayment.orderId, productOrder.id))
    .where(eq(productOrder.id, orderId))
    .limit(1);

  if (!row) return { ok: false, reason: "order_not_found" };

  const { order } = row;
  const bumpOrderIds = parseOrderBumpOrderIds(
    order.attribution?.order_bump_order_ids,
  );

  const decision = evaluateRecoveryPix(
    {
      orderStatus: order.status,
      paymentStatus: row.paymentStatus,
      paymentRawStatus: row.paymentRawStatus,
      paymentMethodId: row.paymentMethodId,
      attribution: order.attribution,
    },
    {
      now,
      buyerHasOtherOpenOrder: await buyerHasOtherOpenProductOrder({
        orderId: order.id,
        productId: order.productId,
        buyerEmail: order.buyerEmail,
      }),
    },
  );

  if (!decision.ok) return { ok: false, reason: decision.reason };

  const groupOrders = await loadGroupOrders(order.id, bumpOrderIds);
  const amountCentavos = groupOrders.reduce(
    (total, groupOrder) => total + groupOrder.priceCentavos,
    0,
  );

  // Código ainda vivo: devolve o MESMO, não cria outra cobrança. Dois códigos
  // válidos para a mesma venda é convite para cobrar o cliente duas vezes.
  if (decision.action === "reuse" && row.providerPaymentId) {
    const existing = await fetchProductPixCharge(row.providerPaymentId);
    if (existing?.pixCopyPasteCode && isLivePixStatus(existing.status)) {
      return {
        ok: true,
        reused: true,
        pixCopyPasteCode: existing.pixCopyPasteCode,
        amountCentavos,
        currency: order.currency,
        expiresAt: decision.stamp.expiresAt,
        generatedAt: decision.stamp.generatedAt,
        adminEmail: decision.stamp.adminEmail ?? adminEmail,
        attempts: decision.stamp.attempts,
        orderIds: groupOrders.map((groupOrder) => groupOrder.id),
      };
    }
    // A MP derrubou o código antes da hora (ou ele sumiu). Cai para criar outro
    // em vez de devolver um carimbo que não corresponde a cobrança nenhuma.
  }

  /**
   * Sem webhook alcançável, NÃO se cria a cobrança.
   *
   * No checkout do site um webhook perdido é recuperável: a tela fica em
   * polling (`/api/products/checkout/status`) e fecha o pagamento sozinha. Aqui
   * não existe tela — o cliente recebe o código no WhatsApp, paga no app do
   * banco e nunca volta. O webhook é o ÚNICO caminho de liberação, então uma
   * cobrança sem `notification_url` é uma armadilha: leva o dinheiro do cliente
   * e não entrega o produto. Melhor o admin ver um erro agora.
   */
  const notificationUrl = getPublicMercadoPagoWebhookUrl();
  if (!notificationUrl) {
    return { ok: false, reason: "webhook_unreachable" };
  }

  const previousAttempts = readRecoveryPixStamp(order.attribution)?.attempts ?? 0;
  const attempts = previousAttempts + 1;
  const expiresAt = recoveryPixExpiresAt(now);

  // A cobrança na MP vem ANTES da escrita, igual ao Pix de assinatura: se a MP
  // recusar, o pedido continua exatamente como estava e a lista não mente.
  const charge = await createProductRecoveryPixCharge({
    orderId: order.id,
    orderBumpOrderIds: bumpOrderIds,
    productTitle: order.productTitleSnapshot,
    buyerEmail: order.buyerEmail,
    amountCentavos,
    expiresAt,
    notificationUrl,
    attempt: String(attempts),
  });

  await db.transaction(async (tx) => {
    // O grupo INTEIRO volta para `pending`. Se um bump ficasse `failed`,
    // `getProductCheckoutOrders` lançaria "Invalid product checkout group" na
    // hora da aprovação — o cliente pagaria e o produto não liberaria.
    await tx
      .update(productOrder)
      .set({ status: "pending", updatedAt: now })
      .where(
        inArray(
          productOrder.id,
          groupOrders.map((groupOrder) => groupOrder.id),
        ),
      );

    await tx
      .update(productOrder)
      .set({
        attribution: writeRecoveryPixStamp(order.attribution, {
          generatedAt: now,
          expiresAt,
          adminEmail,
          attempts,
        }),
        updatedAt: now,
      })
      .where(eq(productOrder.id, order.id));

    // Mesma limpeza que `setProductPendingPayment` faz no app: o resíduo da
    // tentativa que venceu (valores, método, raw_status) tem que sair, senão a
    // linha diz que entrou dinheiro numa cobrança que ninguém pagou.
    const pendingPayment = {
      provider: "mercadopago" as const,
      providerPreferenceId: null,
      providerPaymentId: charge.paymentId,
      status: "pending" as const,
      grossAmountCentavos: null,
      netAmountCentavos: null,
      feeAmountCentavos: null,
      paymentMethodId: null,
      paymentTypeId: null,
      providerReleaseAt: null,
      platformFeeGrossCentavos: null,
      platformGatewayNetRevenueCentavos: null,
      coproductionBaseCentavos: null,
      ownerExpertReceivableCentavos: null,
      coproducerExpertReceivableCentavos: null,
      automatizeCoproductionRevenueCentavos: null,
      automatizeProductRevenueCentavos: null,
      automatizeTotalNetRevenueCentavos: null,
      rawStatus: null,
      updatedAt: now,
    };

    await tx
      .insert(productPayment)
      .values({ orderId: order.id, ...pendingPayment })
      .onConflictDoUpdate({
        target: productPayment.orderId,
        set: pendingPayment,
      });
  });

  return {
    ok: true,
    reused: false,
    pixCopyPasteCode: charge.pixCopyPasteCode,
    amountCentavos,
    currency: order.currency,
    expiresAt,
    generatedAt: now,
    adminEmail,
    attempts,
    orderIds: groupOrders.map((groupOrder) => groupOrder.id),
  };
}

/** `pending`/`in_process` é código que o banco ainda aceita pagar. */
function isLivePixStatus(status: string | null): boolean {
  return status === "pending" || status === "in_process";
}

/**
 * Pedido primário + seus order bumps.
 *
 * Um bump que sumiu do banco é ignorado de propósito: o valor cobrado tem que
 * ser a soma dos pedidos que a aprovação vai encontrar, e `metadata.amount_
 * centavos` diferente do total leva o pagamento a `amount_mismatch` no webhook.
 */
async function loadGroupOrders(primaryOrderId: string, bumpOrderIds: string[]) {
  const ids = [primaryOrderId, ...bumpOrderIds];
  const rows = await db
    .select({
      id: productOrder.id,
      priceCentavos: productOrder.priceCentavos,
      status: productOrder.status,
    })
    .from(productOrder)
    .where(and(inArray(productOrder.id, ids)));

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}
