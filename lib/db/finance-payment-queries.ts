import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import {
  summarizeAutomatizePayments,
  summarizeProductPayments,
  type FinanceAutomatizePaymentRow,
  type FinanceProductPaymentRow,
} from "@/lib/backoffice/finance-payments";
import { db } from "./index";
import {
  expertLedgerEntry,
  payment,
  product,
  productOrder,
  productPayment,
  user,
} from "./schema";

export async function listFinanceAutomatizePayments(window: DashboardDateWindow) {
  const { getStripeSettlements } = await import(
    "@/lib/backoffice/stripe-finance-settlement"
  );

  const rows = await db
    .select({
      id: payment.id,
      paidAt: payment.paidAt,
      userId: payment.userId,
      userEmail: user.email,
      planType: payment.planType,
      provider: payment.provider,
      amount: payment.amount,
      grossAmount: payment.grossAmount,
      netAmount: payment.netAmount,
      feeAmount: payment.feeAmount,
      currency: payment.currency,
      stripeInvoiceId: payment.stripeInvoiceId,
      mercadopagoPaymentId: payment.mercadopagoPaymentId,
      description: payment.description,
    })
    .from(payment)
    .innerJoin(user, eq(payment.userId, user.id))
    .where(
      and(
        eq(payment.status, "succeeded"),
        gte(payment.paidAt, window.gte),
        lt(payment.paidAt, window.lt),
      ),
    )
    .orderBy(desc(payment.paidAt));

  const stripeSettlements = await getStripeSettlements(
    rows.flatMap((item) =>
      item.provider === "stripe" && item.stripeInvoiceId
        ? [item.stripeInvoiceId]
        : [],
    ),
  );

  return {
    rows: rows satisfies FinanceAutomatizePaymentRow[],
    summary: summarizeAutomatizePayments(rows, stripeSettlements),
    stripeSettlements,
  };
}

export async function listFinanceProductPayments(window: DashboardDateWindow) {
  const rows = await db
    .select({
      id: productPayment.id,
      orderId: productOrder.id,
      productTitle: productOrder.productTitleSnapshot,
      buyerName: productOrder.buyerName,
      buyerEmail: productOrder.buyerEmail,
      approvedAt: productOrder.approvedAt,
      createdAt: productOrder.createdAt,
      providerPaymentId: productPayment.providerPaymentId,
      grossAmountCentavos: productPayment.grossAmountCentavos,
      netAmountCentavos: productPayment.netAmountCentavos,
      feeAmountCentavos: productPayment.feeAmountCentavos,
      priceCentavos: productOrder.priceCentavos,
      ownerType: product.ownerType,
      expertShareBasisPoints: productOrder.expertShareBasisPoints,
      expertRevenueCentavos: expertLedgerEntry.amountCentavos,
    })
    .from(productPayment)
    .innerJoin(productOrder, eq(productPayment.orderId, productOrder.id))
    .innerJoin(product, eq(productOrder.productId, product.id))
    .leftJoin(
      expertLedgerEntry,
      and(
        eq(expertLedgerEntry.orderId, productOrder.id),
        eq(expertLedgerEntry.type, "sale"),
      ),
    )
    .where(
      and(
        eq(productPayment.status, "approved"),
        isNotNull(productOrder.approvedAt),
        gte(productOrder.approvedAt, window.gte),
        lt(productOrder.approvedAt, window.lt),
      ),
    )
    .orderBy(desc(productOrder.approvedAt));

  return {
    rows: rows satisfies FinanceProductPaymentRow[],
    summary: summarizeProductPayments(rows),
  };
}
