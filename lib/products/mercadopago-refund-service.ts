import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  productOrder,
  productPayment,
  productRefundBalanceCase,
  productRefundOperation,
} from "@/lib/db/schema";
import { getMercadoPagoPayment } from "@/lib/mercadopago/fetch-payment";
import {
  getExpertMercadoPagoHistoricalAccount,
} from "@/lib/mercadopago/historical-account";
import {
  readMercadoPagoRefundedAmountCentavos,
} from "@/lib/mercadopago/reversal";
import { isMercadoPagoInsufficientBalanceError, refundMercadoPagoProductPayment } from "@/lib/mercadopago/product-refunds";
import { applyFullProductCheckoutRefund } from "@/lib/db/product-queries";
import { decideProductIntegralRefund } from "./mercadopago-refund";
import {
  getProductRefundBumpOrderIds,
  getProductRefundRootOrderId,
} from "./refund-scope";
import {
  REFUND_BALANCE_REGULARIZATION_MS,
  REFUND_BALANCE_RETRY_DELAY_MS,
  resolveRefundBalanceResponsibility,
} from "./refund-balance-policy";
import { notifyProductRefundBalanceCase } from "./refund-balance-notifications";

type OperatorInput = {
  operatorUserId?: string | null;
  operatorEmail: string;
  reason: string;
};

export async function executeProductIntegralRefund(input: OperatorInput & {
  orderId: string;
}) {
  const selectedOrder = await getOrder(input.orderId);
  if (!selectedOrder) throw new Error("product_order_not_found");
  const rootOrderId = getProductRefundRootOrderId(selectedOrder);
  const rootOrder =
    rootOrderId === selectedOrder.id
      ? selectedOrder
      : await getOrder(rootOrderId);
  if (!rootOrder) throw new Error("product_order_not_found");
  if (rootOrder.userId !== selectedOrder.userId || rootOrder.buyerEmail !== selectedOrder.buyerEmail) {
    throw new Error("invalid_product_checkout_group");
  }

  const bumpOrderIds = getProductRefundBumpOrderIds(rootOrder.attribution);
  const orderIds = [rootOrder.id, ...bumpOrderIds];
  const orders = await db
    .select()
    .from(productOrder)
    .where(inArray(productOrder.id, orderIds));
  if (orders.length !== orderIds.length) throw new Error("invalid_product_checkout_group");
  if (orders.some((order) => order.buyerEmail !== rootOrder.buyerEmail || order.currency !== rootOrder.currency)) {
    throw new Error("invalid_product_checkout_group");
  }

  const [payment] = await db
    .select()
    .from(productPayment)
    .where(eq(productPayment.orderId, rootOrder.id))
    .limit(1);
  if (!payment || payment.provider !== "mercadopago" || !payment.providerPaymentId) {
    throw new Error("refund_payment_not_found");
  }
  const [operation] = await db
    .select()
    .from(productRefundOperation)
    .where(eq(productRefundOperation.paymentId, payment.id))
    .limit(1);
  const refundedAmountCentavos = Math.max(
    payment.refundedAmountCentavos ?? 0,
    operation?.refundedAmountCentavos ?? 0,
  );
  const decision = decideProductIntegralRefund({
    orderStatuses: orders.map((order) => order.status),
    grossAmountCentavos: payment.grossAmountCentavos,
    refundedAmountCentavos,
    operationStatus: operation?.status,
  });
  if (decision.kind === "reject") throw new Error(decision.reason);
  if (decision.kind === "block_external_partial") {
    const row = await recordRefundOperation(payment.id, input, operation?.idempotencyKey, "external_partial", decision.amountCentavos);
    return result("external_partial", rootOrder.id, orderIds, decision.amountCentavos, row.id);
  }
  if (decision.kind === "reconcile_full") {
    return confirmWholeCheckout({
      rootOrderId: rootOrder.id,
      orderIds,
      paymentId: payment.id,
      operationId: operation?.id,
      amount: decision.amountCentavos,
    });
  }

  const pending = await recordRefundOperation(payment.id, input, operation?.idempotencyKey, "issuing", 0);
  let providerAttempted = decision.kind === "recover_uncertain";
  try {
    const credentials = rootOrder.expertIdSnapshot
      ? payment.mercadoPagoCollectorId
        ? await getExpertMercadoPagoHistoricalAccount(rootOrder.expertIdSnapshot, payment.mercadoPagoCollectorId)
        : (() => { throw new Error("refund_original_account_missing"); })()
      : { accessToken: platformAccessToken() };
    if (!credentials.accessToken) throw new Error("mercadopago_not_configured");

    if (decision.kind !== "recover_uncertain") {
      providerAttempted = true;
      const created = await refundMercadoPagoProductPayment(
        payment.providerPaymentId,
        pending.idempotencyKey,
        credentials.accessToken,
      );
      if (created.id !== undefined) {
        await db
          .update(productRefundOperation)
          .set({ providerRefundId: String(created.id), updatedAt: new Date() })
          .where(eq(productRefundOperation.id, pending.id));
      }
    }

    const providerPayment = await getMercadoPagoPayment(
      payment.providerPaymentId,
      credentials.accessToken,
    );
    const observedAmount = readMercadoPagoRefundedAmountCentavos(providerPayment);
    if (!observedAmount) return result("processing", rootOrder.id, orderIds, 0, pending.id);
    await db
      .update(productPayment)
      .set({ refundedAmountCentavos: observedAmount, updatedAt: new Date() })
      .where(eq(productPayment.id, payment.id));
    const confirmed = decideProductIntegralRefund({
      orderStatuses: orders.map((order) => order.status),
      grossAmountCentavos: payment.grossAmountCentavos,
      refundedAmountCentavos: observedAmount,
      operationStatus: "issuing",
    });
    if (confirmed.kind === "reconcile_full") {
      return confirmWholeCheckout({
        rootOrderId: rootOrder.id,
        orderIds,
        paymentId: payment.id,
        operationId: pending.id,
        amount: observedAmount,
      });
    }
    await db
      .update(productRefundOperation)
      .set({ status: "external_partial", refundedAmountCentavos: observedAmount, updatedAt: new Date() })
      .where(eq(productRefundOperation.id, pending.id));
    return result("external_partial", rootOrder.id, orderIds, observedAmount, pending.id);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "refund_failed";
    const uncertain = providerAttempted && !isDefinitiveProviderRejection(error);
    await db
      .update(productRefundOperation)
      .set({ status: uncertain ? "issuing" : "failed", failureReason, updatedAt: new Date() })
      .where(eq(productRefundOperation.id, pending.id));
    if (isMercadoPagoInsufficientBalanceError(error)) {
      const responsibility = resolveRefundBalanceResponsibility({
        expertId: rootOrder.expertIdSnapshot,
        receiverAccountId: payment.mercadoPagoCollectorId,
      });
      if (responsibility.kind !== "unknown") {
        const balanceCase = await recordProductRefundBalanceInsufficiency({
          paymentId: payment.id,
          expertId: responsibility.kind === "expert" ? responsibility.expertId : null,
          responsible: responsibility.kind,
          failureMessage: failureReason,
        });
        if (balanceCase) {
          try {
            await notifyProductRefundBalanceCase(balanceCase.id);
          } catch (notificationError) {
            console.error("product.refund_balance.notice_failed", notificationError);
          }
        }
        return {
          status: "balance_pending" as const,
          rootOrderId: rootOrder.id,
          orderIds,
          amountCentavos: payment.grossAmountCentavos ?? 0,
          caseId: balanceCase?.id ?? null,
          responsible: responsibility.kind,
        };
      }
    }
    throw error;
  }
}

async function getOrder(orderId: string) {
  const [order] = await db
    .select()
    .from(productOrder)
    .where(eq(productOrder.id, orderId))
    .limit(1);
  return order ?? null;
}

function platformAccessToken(): string {
  return (
    process.env.MERCADOPAGO_ACCESS_TOKEN ??
    process.env.MERCADO_PAGO_ACCESS_TOKEN ??
    ""
  );
}

function isDefinitiveProviderRejection(error: unknown): boolean {
  const status =
    typeof error === "object" && error !== null && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : typeof error === "object" && error !== null && "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? Number((error as { message: string }).message.match(/\((\d{3})\)/)?.[1] ?? NaN)
        : NaN;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function result(
  status: "processing" | "external_partial",
  rootOrderId: string,
  orderIds: string[],
  amountCentavos: number,
  operationId: string,
) {
  return { status, rootOrderId, orderIds, amountCentavos, operationId } as const;
}

async function recordRefundOperation(
  paymentId: string,
  input: OperatorInput,
  key: string | undefined,
  status: "issuing" | "external_partial",
  amountCentavos: number,
) {
  const idempotencyKey = key ?? `product-refund-${paymentId}`;
  const [row] = await db
    .insert(productRefundOperation)
    .values({
      paymentId,
      operatorUserId: input.operatorUserId ?? null,
      operatorEmail: input.operatorEmail,
      reason: input.reason,
      idempotencyKey,
      status,
      refundedAmountCentavos: amountCentavos,
    })
    .onConflictDoUpdate({
      target: productRefundOperation.paymentId,
      set: {
        operatorUserId: input.operatorUserId ?? null,
        operatorEmail: input.operatorEmail,
        reason: input.reason,
        status,
        refundedAmountCentavos: amountCentavos,
        failureReason: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("refund_operation_not_persisted");
  return row;
}

async function confirmWholeCheckout(input: {
  rootOrderId: string;
  orderIds: string[];
  paymentId: string;
  operationId?: string;
  amount: number;
}) {
  const confirmed = await applyFullProductCheckoutRefund({
    rootOrderId: input.rootOrderId,
    orderIds: input.orderIds,
    paymentId: input.paymentId,
    refundedAmountCentavos: input.amount,
    operationId: input.operationId,
    eventSuffix: `mp-refund-${input.paymentId}`,
  });
  return {
    status: "confirmed" as const,
    rootOrderId: input.rootOrderId,
    orderIds: confirmed.orders.map((order) => order.id),
    amountCentavos: input.amount,
    operationId: input.operationId ?? null,
  };
}

export async function recordProductRefundBalanceInsufficiency(input: {
  paymentId: string;
  expertId: string | null;
  responsible: "expert" | "automatize";
  failureMessage?: string;
  now?: Date;
}) {
  if (input.responsible === "expert" && !input.expertId) {
    throw new Error("refund_balance_expert_missing");
  }
  const now = input.now ?? new Date();
  const nextRetryAt = new Date(now.getTime() + REFUND_BALANCE_RETRY_DELAY_MS);
  const [caseRow] = await db
    .insert(productRefundBalanceCase)
    .values({
      paymentId: input.paymentId,
      expertId: input.responsible === "expert" ? input.expertId : null,
      responsible: input.responsible,
      firstFailedAt: now,
      lastFailedAt: now,
      regularizationDueAt: new Date(now.getTime() + REFUND_BALANCE_REGULARIZATION_MS),
      noticeSentAt: null,
      attemptCount: 1,
      lastFailureCode: "insufficient_money_for_refund",
      lastFailureMessage: input.failureMessage ?? null,
      nextRetryAt,
    })
    .onConflictDoUpdate({
      target: productRefundBalanceCase.paymentId,
      set: {
        lastFailedAt: now,
        lastFailureCode: "insufficient_money_for_refund",
        lastFailureMessage: input.failureMessage ?? null,
        nextRetryAt,
        attemptCount: sql`${productRefundBalanceCase.attemptCount} + 1`,
        updatedAt: now,
      },
    })
    .returning();
  return caseRow ?? null;
}

export async function releaseExpertSalesAfterRefundBalanceResolution(input: {
  caseId: string;
  operatorUserId?: string | null;
  operatorEmail: string;
  reason: string;
}) {
  return db.transaction(async (tx) => {
    const [caseRow] = await tx
      .select()
      .from(productRefundBalanceCase)
      .where(eq(productRefundBalanceCase.id, input.caseId))
      .limit(1)
      .for("update");
    if (!caseRow) throw new Error("refund_balance_case_not_found");
    const [operation] = await tx
      .select({ status: productRefundOperation.status })
      .from(productRefundOperation)
      .where(eq(productRefundOperation.paymentId, caseRow.paymentId))
      .limit(1);
    if (operation?.status !== "confirmed") {
      throw new Error("refund_balance_release_requires_confirmed_refund");
    }
    const [released] = await tx
      .update(productRefundBalanceCase)
      .set({
        status: "resolved",
        releasedByUserId: input.operatorUserId ?? null,
        releasedByEmail: input.operatorEmail,
        releaseReason: input.reason,
        releasedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(productRefundBalanceCase.id, input.caseId),
        eq(productRefundBalanceCase.responsible, "expert"),
        eq(productRefundBalanceCase.status, "pending"),
      ))
      .returning();
    if (!released) throw new Error("refund_balance_case_not_pending");
    return released;
  });
}
